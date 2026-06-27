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
import json
import time
import tempfile
import c4d
from c4d import gui, plugins, documents

PLUGIN_ID = 1066001  # NOTE: register your own at https://plugincafe.maxon.net for release

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
    two link up automatically — nothing to pick. Created on first use."""
    d = os.path.join(tempfile.gettempdir(), "UVStudioBridge")
    _ensure(os.path.join(d, TO_APP))
    _ensure(os.path.join(d, TO_C4D))
    return d


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
    """Flatten the selection to editable polygon objects (descend into children).
    Generators/SDS are skipped in this version — make them editable (C) first."""
    out = []
    seen = set()

    def walk(o):
        while o:
            if o.CheckType(c4d.Opolygon) and id(o) not in seen:
                seen.add(id(o))
                out.append(o)
            walk(o.GetDown())
            o = o.GetNext()

    for r in roots:
        walk(r)
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
        self.SetTitle("UV Studio Bridge")
        self.GroupBegin(0, c4d.BFH_SCALEFIT, 1, 0, "")
        self.GroupBorderSpace(8, 8, 8, 8)
        self.AddButton(BTN_SEND, c4d.BFH_SCALEFIT, initw=0, inith=34, name="Send selection to UV Studio")
        self.AddStaticText(TXT_STATUS, c4d.BFH_SCALEFIT, name="Select objects, then Send.")
        self.GroupEnd()
        return True

    def InitValues(self):
        self.SetTimer(1000)  # auto-receive: poll the inbox once a second
        return True

    def _status(self, msg):
        self.SetString(TXT_STATUS, msg)

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
            polys = []
            for poly in op.GetAllPolygons():
                if poly.c == poly.d:  # triangle
                    polys.append([poly.a, poly.b, poly.c])
                else:                 # quad
                    polys.append([poly.a, poly.b, poly.c, poly.d])
            out.append({"name": op.GetName(), "guid": _object_guid(op), "points": pts, "polys": polys})

        payload = {"v": 2, "ts": int(time.time() * 1000), "kind": "geo-forward", "objects": out}
        try:
            _write_json_atomic(os.path.join(self.link_dir, TO_APP), payload)
        except Exception as e:
            self._status("Send failed: %s" % e)
            return
        self._status("Sent %d object(s) to UV Studio." % len(out))

    # --- receive: to_c4d/scene.json -> write UVs onto the existing objects ---
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
        if man.get("kind") == "uv-return":
            self.apply_uvs(man)
        else:
            self._status("Ignored a non-UV payload (update UV Studio?).")

    def apply_uvs(self, payload):
        doc = documents.GetActiveDocument()
        doc.StartUndo()
        applied, missed = 0, []
        for obj in payload.get("objects", []):
            target = None
            guid = obj.get("guid")
            if guid:
                target = _find_by_guid(doc.GetFirstObject(), guid)
            if target is None:
                target = _find_by_name(doc.GetFirstObject(), obj.get("name", ""))
            if self._write_uvw(doc, target, obj):
                applied += 1
            else:
                missed.append(obj.get("name", "?"))
        doc.EndUndo()
        c4d.EventAdd()
        # ack back to the app so it can confirm the round-trip closed
        try:
            _write_json_named(
                os.path.join(self.link_dir, TO_APP), "ack.json",
                {"v": 1, "ts": int(time.time() * 1000), "kind": "uv-ack",
                 "applied": applied, "missed": missed},
            )
        except Exception:
            pass
        if missed:
            self._status("UVs applied to %d; could not match: %s" % (applied, ", ".join(missed)))
        else:
            self._status("UVs applied to %d object(s)." % applied)

    def _write_uvw(self, doc, target, obj):
        """Write per-polygon-corner UVs onto target's UVW tag. Geometry untouched."""
        if target is None or not target.CheckType(c4d.Opolygon):
            return False
        poly_count = target.GetPolygonCount()
        if poly_count != obj.get("polyCount"):
            return False  # mesh changed since send — refuse rather than mis-map
        rows = obj.get("uv") or []
        vflip = obj.get("vFlip", True)

        tag = target.GetTag(c4d.Tuvw)
        new_tag = tag is None
        if new_tag:
            tag = c4d.UVWTag(poly_count)
        else:
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, tag)

        for i in range(poly_count):
            row = rows[i] if i < len(rows) else None
            if not row or len(row) < 8:
                continue

            def corner(j):
                u = row[j * 2]
                v = row[j * 2 + 1]
                return c4d.Vector(u, 1.0 - v if vflip else v, 0.0)

            tag.SetSlow(i, corner(0), corner(1), corner(2), corner(3))

        if new_tag:
            target.InsertTag(tag)
            doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, tag)
        target.Message(c4d.MSG_UPDATE)
        return True


# ---- plugin registration ----------------------------------------------------
class BridgeCommand(plugins.CommandData):
    dlg = None

    def Execute(self, doc):
        if self.dlg is None:
            self.dlg = BridgeDialog()
        return self.dlg.Open(c4d.DLG_TYPE_ASYNC, pluginid=PLUGIN_ID, defaultw=300, defaulth=88)

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
