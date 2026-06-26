"""
UV Studio Bridge — Cinema 4D plugin
===================================

A tiny dockable panel that round-trips the SELECTED objects to UV Studio:

    C4D  --(GLB)-->  <link folder>/to_app/    -->  UV Studio   (unwrap / edit)
    C4D  <--(GLB)--  <link folder>/to_c4d/     <--  UV Studio   (Send back)

It is deliberately minimal and uses a *shared folder* as the transport — the
most robust, firewall-free way for two local apps to talk. No servers, no ports.

How the handshake works (both directions are symmetric):
  * the SENDER writes `scene.glb`, then writes `scene.json` LAST. Writing the
    small manifest last guarantees the reader never sees a half-written GLB.
  * the RECEIVER polls the manifest's timestamp; when it changes it loads the GLB.

Install:  Copy this whole `c4d-plugin` folder (renamed e.g. `UVStudioBridge`)
into your Cinema 4D `plugins/` directory, restart C4D, then
Extensions ▸ UV Studio Bridge.

Tested against the C4D Python (R23+/2024+) API. The glTF im/exporter is found
dynamically by name, so no version-specific format IDs are hardcoded.
"""

import os
import json
import time
import c4d
from c4d import gui, plugins, documents, storage

PLUGIN_ID = 1066001  # NOTE: register your own at https://plugincafe.maxon.net for release

# ---- folder protocol --------------------------------------------------------
TO_APP = "to_app"     # C4D -> UV Studio
TO_C4D = "to_c4d"     # UV Studio -> C4D
GLB = "scene.glb"
MANIFEST = "scene.json"

PREF_KEY = "uvstudio_link_dir"  # remembered between sessions via World Container


# ---- helpers ----------------------------------------------------------------
def _find_format(keyword, plugin_type):
    """Find a scene saver/loader plugin id by a substring of its name
    (e.g. 'gltf'), so we don't depend on version-specific format constants."""
    for p in plugins.FilterPluginList(plugin_type, True):
        if keyword.lower() in p.GetName().lower():
            return p.GetID()
    return None


def _gltf_export_id():
    return _find_format("gltf", c4d.PLUGINTYPE_SCENESAVER) or _find_format("glb", c4d.PLUGINTYPE_SCENESAVER)


def _gltf_import_id():
    return _find_format("gltf", c4d.PLUGINTYPE_SCENELOADER) or _find_format("glb", c4d.PLUGINTYPE_SCENELOADER)


def _ensure(path):
    if not os.path.isdir(path):
        os.makedirs(path)
    return path


def _read_manifest(folder):
    p = os.path.join(folder, MANIFEST)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _write_manifest(folder, objects):
    # written LAST so the GLB is guaranteed complete before the reader reacts
    p = os.path.join(folder, MANIFEST)
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"v": 1, "ts": int(time.time() * 1000), "objects": objects}, f)
    os.replace(tmp, p)  # atomic


def _get_pref():
    bc = c4d.plugins.GetWorldPluginData(PLUGIN_ID)
    if bc is not None and bc[1000]:
        return bc[1000]
    return ""


def _set_pref(path):
    bc = c4d.BaseContainer()
    bc[1000] = path
    c4d.plugins.SetWorldPluginData(PLUGIN_ID, bc, add=True)


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


# ---- the dock panel ---------------------------------------------------------
BTN_FOLDER = 2001
BTN_SEND = 2002
TXT_FOLDER = 2003
TXT_STATUS = 2004
CHK_WATCH = 2005


class BridgeDialog(gui.GeDialog):
    def __init__(self):
        super(BridgeDialog, self).__init__()
        self.link_dir = _get_pref()
        self.last_in_ts = None  # last to_c4d manifest ts we imported

    # --- layout ---
    def CreateLayout(self):
        self.SetTitle("UV Studio Bridge")
        self.GroupBegin(0, c4d.BFH_SCALEFIT, 1, 0, "")
        self.GroupBorderSpace(8, 8, 8, 8)

        self.GroupBegin(0, c4d.BFH_SCALEFIT, 2, 0, "")
        self.AddButton(BTN_FOLDER, c4d.BFH_LEFT, name="Link folder…")
        self.AddStaticText(TXT_FOLDER, c4d.BFH_SCALEFIT, name=self.link_dir or "— not set —")
        self.GroupEnd()

        self.AddButton(BTN_SEND, c4d.BFH_SCALEFIT, initw=0, inith=30, name="Send selection to UV Studio")
        self.AddCheckbox(CHK_WATCH, c4d.BFH_LEFT, initw=0, inith=0, name="Auto-receive edits from UV Studio")
        self.AddStaticText(TXT_STATUS, c4d.BFH_SCALEFIT, name="Ready.")
        self.GroupEnd()
        return True

    def InitValues(self):
        self.SetBool(CHK_WATCH, True)
        self.SetTimer(1000)  # poll the inbox once a second
        if self.link_dir:
            self.last_in_ts = (_read_manifest(os.path.join(self.link_dir, TO_C4D)) or {}).get("ts")
        return True

    def _status(self, msg):
        self.SetString(TXT_STATUS, msg)

    # --- events ---
    def Command(self, cid, msg):
        if cid == BTN_FOLDER:
            path = storage.LoadDialog(type=c4d.FILESELECTTYPE_ANYTHING,
                                      title="Choose the shared UV Studio link folder",
                                      flags=c4d.FILESELECT_DIRECTORY)
            if path:
                self.link_dir = path
                _set_pref(path)
                self.SetString(TXT_FOLDER, path)
                self.last_in_ts = (_read_manifest(os.path.join(path, TO_C4D)) or {}).get("ts")
                self._status("Link folder set.")
        elif cid == BTN_SEND:
            self.send_selection()
        return True

    def Timer(self, msg):
        if self.GetBool(CHK_WATCH):
            self.poll_incoming()

    # --- send: selection -> to_app/scene.glb ---
    def send_selection(self):
        if not self.link_dir:
            self._status("Set the link folder first.")
            return
        doc = documents.GetActiveDocument()
        roots = _selected_roots(doc)
        if not roots:
            self._status("Select one or more objects first.")
            return
        fmt = _gltf_export_id()
        if not fmt:
            self._status("No glTF exporter found in this C4D install.")
            return

        # build a temp doc containing clones of the selection (names preserved)
        tmp = documents.BaseDocument()
        names = []
        for o in roots:
            clone = o.GetClone(c4d.COPYFLAGS_NONE)
            tmp.InsertObject(clone)
            names.append(o.GetName())

        out = _ensure(os.path.join(self.link_dir, TO_APP))
        glb = os.path.join(out, GLB)
        ok = documents.SaveDocument(tmp, glb, c4d.SAVEDOCUMENTFLAGS_DONTADDTORECENTLIST, fmt)
        if not ok:
            self._status("glTF export failed.")
            return
        _write_manifest(out, names)  # manifest last = GLB ready
        self._status("Sent %d object(s) to UV Studio." % len(names))

    # --- receive: to_c4d/scene.glb -> merge UVs back by name ---
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
        self.import_back(os.path.join(inbox, GLB))

    def import_back(self, glb):
        if not os.path.isfile(glb):
            return
        fmt = _gltf_import_id()
        if not fmt:
            self._status("No glTF importer found.")
            return
        doc = documents.GetActiveDocument()
        incoming = documents.LoadDocument(glb, c4d.SCENEFILTER_OBJECTS, None, fmt)
        if incoming is None:
            self._status("Couldn't read the returned GLB.")
            return

        doc.StartUndo()
        updated, added = 0, 0
        ret = incoming.GetFirstObject()
        ret_objs = []
        while ret:
            ret_objs.append(ret)
            ret = ret.GetNext()

        for ro in ret_objs:
            target = self._find_by_name(doc.GetFirstObject(), ro.GetName())
            if target and self._copy_uvs(doc, ro, target):
                updated += 1
            else:
                # topology differs (or no match) → drop in the returned object so
                # the user can swap it in manually
                clone = ro.GetClone(c4d.COPYFLAGS_NONE)
                doc.InsertObject(clone)
                doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, clone)
                added += 1

        doc.EndUndo()
        c4d.EventAdd()
        self._status("Received: %d UV update(s), %d new object(s)." % (updated, added))

    def _find_by_name(self, node, name):
        while node:
            if node.GetName() == name:
                return node
            hit = self._find_by_name(node.GetDown(), name)
            if hit:
                return hit
            node = node.GetNext()
        return None

    def _copy_uvs(self, doc, src, dst):
        """Copy the UVW tag from src onto dst when point counts match (the common
        case — UV Studio preserves topology unless you re-project a cylinder)."""
        if not src.CheckType(c4d.Opolygon) or not dst.CheckType(c4d.Opolygon):
            return False
        if src.GetPointCount() != dst.GetPointCount() or src.GetPolygonCount() != dst.GetPolygonCount():
            return False
        suv = src.GetTag(c4d.Tuvw)
        if not suv:
            return False
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, dst)
        old = dst.GetTag(c4d.Tuvw)
        if old:
            old.Remove()
        dst.InsertTag(suv.GetClone(c4d.COPYFLAGS_NONE))
        dst.Message(c4d.MSG_UPDATE)
        return True


# ---- plugin registration ----------------------------------------------------
class BridgeCommand(plugins.CommandData):
    dlg = None

    def Execute(self, doc):
        if self.dlg is None:
            self.dlg = BridgeDialog()
        return self.dlg.Open(c4d.DLG_TYPE_ASYNC, pluginid=PLUGIN_ID, defaultw=320, defaulth=140)

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
        help="Round-trip the selection to UV Studio",
        dat=BridgeCommand(),
    )


if __name__ == "__main__":
    main()
