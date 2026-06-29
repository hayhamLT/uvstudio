"""
UV Studio Bridge — Cinema 4D plugin
===================================

A tiny dockable panel that LOSSLESSLY round-trips the SELECTED objects to UV
Studio. The geometry NEVER leaves C4D — only UV coordinates come back, written
straight onto each object's existing UVW tag. So normals, materials, hierarchy,
extra UV tags, point order — everything but the UVs — is preserved by construction.

    C4D  --(points+polys sidecar)-->  <link>/to_app/scene.json   -->  UV Studio
    C4D  <--(per-polygon-corner UVs)-- <link>/to_c4d/scene.json    <--  UV Studio

How it stays lossless:
  * FORWARD: we write the object's points (world) + polygons (corner point
    indices) + a stable guid to a JSON sidecar. UV Studio builds its mesh 1:1
    from this — every app vertex IS a C4D point, every app face IS a C4D polygon.
    No glTF, so no triangulation / welding / reordering and no exporter needed.
  * RETURN: UV Studio sends one UV row per ORIGINAL polygon (corners a,b,c,d).
    We SetSlow() those onto the object's UVW tag, addressed by polygon + corner.
    C4D UVW tags are per-corner, so a UV seam needs zero extra points.

The handshake stays the same: scene.json carries a `ts`; the receiver polls it.

Install:  Copy this whole `c4d-plugin` folder (renamed e.g. `UVStudioBridge`)
into your Cinema 4D `plugins/` directory, restart C4D, then
Extensions ▸ UV Studio Bridge.

Tested against the C4D Python (R23+ / 2024+) API.
"""

import os
import sys
import json
import time
import tempfile
import subprocess
import c4d
from c4d import gui, plugins, documents

APP_BUNDLE_ID = "link.preshow.uvstudio"  # macOS bundle id of the UV Studio desktop app
APP_NAME = "UV Studio"


def _open_app():
    """Launch the UV Studio desktop app, or bring it to the front if already
    running, so a Send pops it up. Best-effort — silent if not installed."""
    try:
        if sys.platform == "darwin":
            # `open -b` launches if not running, activates (raises) if it is
            if subprocess.call(["open", "-b", APP_BUNDLE_ID]) != 0:
                subprocess.call(["open", "-a", APP_NAME])
        elif sys.platform.startswith("win"):
            os.startfile(APP_NAME)  # noqa: needs the app on PATH / registered
    except Exception:
        pass

PLUGIN_ID = 1066001  # NOTE: register your own at https://plugincafe.maxon.net for release
PLUGIN_VERSION = "0.3.19"  # shown in the panel; bump together with the app version

# ---- folder protocol --------------------------------------------------------
TO_APP = "to_app"     # C4D -> UV Studio
TO_C4D = "to_c4d"     # UV Studio -> C4D
GLB = "scene.glb"
MANIFEST = "scene.json"

GUID_KEY = 1062500       # per-object stable id, stored in the object's container


# ---- helpers ----------------------------------------------------------------
def _ensure(path):
    if not os.path.isdir(path):
        os.makedirs(path)
    return path


def _default_link_dir():
    """Zero-config shared folder: a fixed name inside the OS per-user temp dir.
    The UV Studio desktop app computes the SAME path (Rust env::temp_dir() and
    Python tempfile.gettempdir() resolve to the same per-user location), so the
    two link up automatically — nothing to pick.

    If the user picked a CUSTOM folder in the app, the app drops a pointer
    (linkdir.txt) in this temp default naming it; we follow that so both ends
    stay in sync. Falls back to the temp folder if the pointer is missing/bad."""
    base = os.path.join(tempfile.gettempdir(), "UVStudioBridge")
    _ensure(base)
    ptr = os.path.join(base, "linkdir.txt")
    try:
        if os.path.isfile(ptr):
            with open(ptr, "r") as f:
                custom = f.read().strip()
            if custom:
                _ensure(os.path.join(custom, TO_APP))
                _ensure(os.path.join(custom, TO_C4D))
                return custom
    except Exception:
        pass  # unreadable / invalid path → fall back to the temp default
    _ensure(os.path.join(base, TO_APP))
    _ensure(os.path.join(base, TO_C4D))
    return base


def _read_manifest(folder):
    p = os.path.join(folder, MANIFEST)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _write_json_named(folder, name, payload):
    """Write a JSON file atomically (temp + rename) — readers never see a partial."""
    p = os.path.join(_ensure(folder), name)
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, p)


def _write_json_atomic(folder, payload):
    _write_json_named(folder, MANIFEST, payload)


def _object_guid(op):
    """A stable id stored on the object so we can re-find it exactly on the way
    back (names can collide / change). Persists with the object in the session."""
    bc = op.GetDataInstance()
    g = bc.GetString(GUID_KEY)
    if not g:
        g = "uvs-%x-%x" % (int(time.time() * 1e6) & 0xFFFFFFFF, id(op) & 0xFFFFFF)
        bc.SetString(GUID_KEY, g)
    return g


def _collect_polys(roots):
    """Each selected object plus its descendants that are editable polygon objects.
    Only walks each root's OWN subtree (NOT its siblings). Generators/SDS are
    skipped in this version — make them editable (C) first."""
    out = []
    seen = set()

    def add(o):
        if o.CheckType(c4d.Opolygon) and id(o) not in seen:
            seen.add(id(o))
            out.append(o)

    def descend(o):
        c = o.GetDown()
        while c:
            add(c)
            descend(c)
            c = c.GetNext()

    for r in roots:
        add(r)        # the selected object itself
        descend(r)    # and any polygon objects nested under it
    return out


def _selected_roots(doc):
    """Top-level selected objects (skip children whose parent is also selected)."""
    sel = doc.GetActiveObjects(c4d.GETACTIVEOBJECTFLAGS_SELECTIONORDER)
    selset = set(id(o) for o in sel)
    roots = []
    for o in sel:
        p = o.GetUp()
        skip = False
        while p:
            if id(p) in selset:
                skip = True
                break
            p = p.GetUp()
        if not skip:
            roots.append(o)
    return roots


def _find_by_guid(node, guid):
    while node:
        if node.CheckType(c4d.Opolygon) and node.GetDataInstance().GetString(GUID_KEY) == guid:
            return node
        hit = _find_by_guid(node.GetDown(), guid)
        if hit:
            return hit
        node = node.GetNext()
    return None


def _find_by_name(node, name):
    while node:
        if node.GetName() == name:
            return node
        hit = _find_by_name(node.GetDown(), name)
        if hit:
            return hit
        node = node.GetNext()
    return None


# ---- the dock panel ---------------------------------------------------------
BTN_SEND = 2002
TXT_STATUS = 2004


class BridgeDialog(gui.GeDialog):
    def __init__(self):
        super(BridgeDialog, self).__init__()
        # Link folder is automatic — a shared temp folder the UV Studio app also
        # uses. No picking, no setup: just select objects and Send.
        self.link_dir = _default_link_dir()
        self.last_in_ts = (_read_manifest(os.path.join(self.link_dir, TO_C4D)) or {}).get("ts")

    # --- layout ---
    def CreateLayout(self):
        # version lives in the title; the panel itself is just one big button
        self.SetTitle("UV Studio Bridge  ·  v%s" % PLUGIN_VERSION)
        self.GroupBegin(0, c4d.BFH_SCALEFIT | c4d.BFV_SCALEFIT, 1, 0, "")
        self.GroupBorderSpace(10, 10, 10, 10)
        self.AddButton(BTN_SEND, c4d.BFH_SCALEFIT | c4d.BFV_SCALEFIT, initw=0, inith=46,
                       name="Send to UV Studio")
        self.GroupEnd()
        return True

    def InitValues(self):
        self.SetTimer(1000)  # auto-receive: poll the inbox once a second
        return True

    def _status(self, msg):
        # status bar removed — feedback shows in the UV Studio app + the ack
        pass

    # --- events ---
    def Command(self, cid, msg):
        if cid == BTN_SEND:
            self.send_selection()
        return True

    def Timer(self, msg):
        self.poll_incoming()

    # --- send: selection -> to_app/scene.json (points + polys + guid) ---
    def send_selection(self):
        doc = documents.GetActiveDocument()
        objs = _collect_polys(_selected_roots(doc))
        if not objs:
            self._status("Select one or more editable polygon objects first.")
            return

        out = []
        for op in objs:
            mg = op.GetMg()
            pts = []
            for p in op.GetAllPoints():
                wp = mg * p  # world space, matches how UV Studio bakes geometry
                pts.extend([wp.x, wp.y, wp.z])
            allpolys = op.GetAllPolygons()
            polys = []
            for poly in allpolys:
                if poly.c == poly.d:  # triangle
                    polys.append([poly.a, poly.b, poly.c])
                else:                 # quad
                    polys.append([poly.a, poly.b, poly.c, poly.d])
            # existing UVs (so the app can SHOW the object's current UVs on import).
            # Per polygon, corners a,b,c(,d); V flipped to the app's V-up space.
            uvtag = op.GetTag(c4d.Tuvw)
            uv = None
            if uvtag:
                uv = []
                for i, poly in enumerate(allpolys):
                    s = uvtag.GetSlow(i)
                    row = [s['a'].x, 1.0 - s['a'].y,
                           s['b'].x, 1.0 - s['b'].y,
                           s['c'].x, 1.0 - s['c'].y]
                    if poly.c != poly.d:  # quad
                        row += [s['d'].x, 1.0 - s['d'].y]
                    uv.append(row)
            obj = {"name": op.GetName(), "guid": _object_guid(op), "points": pts, "polys": polys}
            if uv is not None:
                obj["uv"] = uv
            out.append(obj)

        payload = {"v": 2, "ts": int(time.time() * 1000), "kind": "geo-forward", "objects": out}
        try:
            _write_json_atomic(os.path.join(self.link_dir, TO_APP), payload)
        except Exception as e:
            self._status("Send failed: %s" % e)
            return
        _open_app()  # launch / bring the app forward so the send is visible
        self._status("Sent %d object(s) to UV Studio." % len(out))

    # --- receive: to_c4d/scene.json -> write UVs onto the existing objects ---
    def _write_ack(self, stage, applied, missed, error=None):
        """Report progress back to the app (and to the temp folder, for debugging):
        stage = 'received' | 'applied' | 'error'."""
        try:
            payload = {"v": 1, "ts": int(time.time() * 1000), "kind": "uv-ack",
                       "stage": stage, "applied": applied, "missed": missed}
            if error:
                payload["error"] = error
            _write_json_named(os.path.join(self.link_dir, TO_APP), "ack.json", payload)
        except Exception:
            pass

    def poll_incoming(self):
        if not self.link_dir:
            return
        inbox = os.path.join(self.link_dir, TO_C4D)
        man = _read_manifest(inbox)
        if not man:
            return
        ts = man.get("ts")
        if ts is None or ts == self.last_in_ts:
            return  # nothing new
        self.last_in_ts = ts
        if man.get("kind") != "uv-return":
            self._status("Ignored a non-UV payload (update UV Studio?).")
            return
        self._write_ack("received", 0, [])  # prove the plugin saw the return
        try:
            self.apply_uvs(man)
        except Exception as e:
            import traceback
            self._write_ack("error", 0, [], traceback.format_exc())
            self._status("Apply error: %s" % e)

    def apply_uvs(self, payload):
        doc = documents.GetActiveDocument()
        doc.StartUndo()
        applied, missed, errors, diag = 0, [], [], []
        for obj in payload.get("objects", []):
            name = obj.get("name", "?")
            try:
                target = None
                guid = obj.get("guid")
                if guid:
                    target = _find_by_guid(doc.GetFirstObject(), guid)
                if target is None:
                    target = _find_by_name(doc.GetFirstObject(), name)
                # capture C4D-side state BEFORE we touch it, to diagnose look mismatches
                if target is not None:
                    texs = [t for t in target.GetTags() if t.GetType() == c4d.Ttexture]
                    diag.append({
                        "name": name,
                        "hadUVW": target.GetTag(c4d.Tuvw) is not None,
                        "texTags": len(texs),
                        "proj": [t[c4d.TEXTURETAG_PROJECTION] for t in texs],
                        "mats": [(t.GetMaterial().GetName() if t.GetMaterial() else None) for t in texs],
                    })
                if self._write_uvw(doc, target, obj):
                    applied += 1
                else:
                    missed.append(name)
            except Exception as e:
                errors.append("%s: %s" % (name, e))
        doc.EndUndo()
        c4d.EventAdd()
        # include the diagnostics in the ack so the app/temp folder captures them
        try:
            _write_json_named(os.path.join(self.link_dir, TO_APP), "ack.json",
                              {"v": 1, "ts": int(time.time() * 1000), "kind": "uv-ack",
                               "stage": "applied", "applied": applied, "missed": missed,
                               "error": ("; ".join(errors) if errors else None), "diag": diag})
        except Exception:
            pass
        if errors:
            self._status("Applied %d; errors: %s" % (applied, ("; ".join(errors))[:90]))
        elif missed:
            self._status("UVs applied to %d; could not match: %s" % (applied, ", ".join(missed)))
        else:
            self._status("UVs applied to %d object(s)." % applied)

    def _write_uvw(self, doc, target, obj):
        """Write per-polygon-corner UVs onto target's UVW tag. Geometry untouched.
        Raises on a real problem (recorded per-object) so failures are visible."""
        if target is None:
            raise ValueError("object not found in scene")
        if not target.CheckType(c4d.Opolygon):
            raise ValueError("target is not an editable polygon object")
        poly_count = target.GetPolygonCount()
        want = obj.get("polyCount")
        if poly_count != want:
            raise ValueError("polygon count %s != sent %s (re-send)" % (poly_count, want))
        rows = obj.get("uv") or []
        vflip = obj.get("vFlip", True)

        # Industry-standard: remove the old UV set(s) and add a brand-new one,
        # rather than editing in place. Avoids any stale/partial UV state.
        old = target.GetTag(c4d.Tuvw)
        while old:
            doc.AddUndo(c4d.UNDOTYPE_DELETE, old)
            old.Remove()
            old = target.GetTag(c4d.Tuvw)
        tag = c4d.UVWTag(poly_count)

        for i in range(poly_count):
            row = rows[i] if i < len(rows) else None
            if not row or len(row) < 8:
                continue
            u = row
            tag.SetSlow(
                i,
                c4d.Vector(u[0], 1.0 - u[1] if vflip else u[1], 0.0),
                c4d.Vector(u[2], 1.0 - u[3] if vflip else u[3], 0.0),
                c4d.Vector(u[4], 1.0 - u[5] if vflip else u[5], 0.0),
                c4d.Vector(u[6], 1.0 - u[7] if vflip else u[7], 0.0),
            )

        target.InsertTag(tag)
        doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, tag)
        tag.SetDirty(c4d.DIRTYFLAGS_DATA)

        # Make the UVs actually drive the texture: set every texture tag on the
        # object to UVW Mapping. Otherwise a Flat/Cubic projection ignores our
        # UVW tag and the result looks smeared (esp. on curved screens).
        for t in target.GetTags():
            if t.GetType() == c4d.Ttexture:
                doc.AddUndo(c4d.UNDOTYPE_CHANGE, t)
                t[c4d.TEXTURETAG_PROJECTION] = c4d.TEXTURETAG_PROJECTION_UVW

        target.Message(c4d.MSG_UPDATE)
        return True


# ---- plugin registration ----------------------------------------------------
class BridgeCommand(plugins.CommandData):
    dlg = None

    def Execute(self, doc):
        if self.dlg is None:
            self.dlg = BridgeDialog()
        return self.dlg.Open(c4d.DLG_TYPE_ASYNC, pluginid=PLUGIN_ID, defaultw=260, defaulth=74)

    def RestoreLayout(self, sec_ref):
        if self.dlg is None:
            self.dlg = BridgeDialog()
        return self.dlg.Restore(pluginid=PLUGIN_ID, secret=sec_ref)


def main():
    plugins.RegisterCommandPlugin(
        id=PLUGIN_ID,
        str="UV Studio Bridge",
        info=0,
        icon=None,
        help="Round-trip the selection to UV Studio (lossless UVs)",
        dat=BridgeCommand(),
    )


if __name__ == "__main__":
    main()
