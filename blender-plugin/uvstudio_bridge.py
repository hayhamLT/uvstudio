"""
UV Studio Bridge — Blender add-on
=================================

Losslessly round-trips the SELECTED mesh objects to UV Studio over the same
shared-folder bridge the Cinema 4D plugin uses. Geometry never leaves Blender —
only UV coordinates come back, written onto each object's active UV layer.

    Blender --(points+polys sidecar)--> <link>/to_app/scene.json --> UV Studio
    Blender <--(per-face-corner UVs)--- <link>/to_c4d/scene.json   <-- UV Studio

How it stays lossless:
  * FORWARD: we write each object's world-space points + polygons (corner vertex
    indices) + a stable guid. UV Studio builds its mesh 1:1 from this. We export
    RAW Blender world coords (Z-up, right-handed) and tag the payload app="blender";
    UV Studio rotates Z-up -> its Y-up space (a pure rotation, no mirror).
  * RETURN: UV Studio sends one UV row per ORIGINAL polygon (corners a,b,c,d). We
    write them onto the active UV layer by (polygon, loop). Blender UVs are V-up
    (bottom-left origin) like UV Studio's, so V is applied as-is (no flip).

Install: dropped into Blender's addons folder by the UV Studio app (or install the
zip via Preferences > Add-ons). Enable "UV Studio Bridge", then use the N-panel
(View3D > Sidebar > UV Studio) — Send.

Tested against Blender 3.6+ / 4.x.
"""

bl_info = {
    "name": "UV Studio Bridge",
    "author": "Toy Robot Media",
    "version": (0, 3, 25),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar (N) > UV Studio",
    "description": "Round-trip selected meshes to UV Studio (UV-only, lossless).",
    "category": "Import-Export",
}

import bpy
import os
import json
import time
import tempfile
import subprocess
import sys

APP_BUNDLE_ID = "link.preshow.uvstudio"  # macOS bundle id of the UV Studio app
APP_NAME = "UV Studio"

# ---- folder protocol (must match the app + the C4D plugin) ------------------
TO_APP = "to_app"     # Blender/C4D -> UV Studio
TO_C4D = "to_c4d"     # UV Studio -> Blender/C4D (name kept for protocol parity)
MANIFEST = "scene.json"
ACK = "ack.json"
GUID_PROP = "uvstudio_guid"  # stable per-object id (custom property)
POLL_SECONDS = 1.0


# ---- helpers ----------------------------------------------------------------
def _ensure(path):
    if not os.path.isdir(path):
        os.makedirs(path)
    return path


def _link_dir():
    """Zero-config shared folder: a fixed name in the OS temp dir. The UV Studio
    app computes the same path. If the user picked a CUSTOM folder in the app, it
    drops a pointer (linkdir.txt) here naming it — we follow that to stay in sync."""
    base = os.path.join(tempfile.gettempdir(), "UVStudioBridge")
    _ensure(base)
    try:
        ptr = os.path.join(base, "linkdir.txt")
        if os.path.isfile(ptr):
            with open(ptr, "r") as f:
                custom = f.read().strip()
            if custom:
                _ensure(os.path.join(custom, TO_APP))
                _ensure(os.path.join(custom, TO_C4D))
                return custom
    except Exception:
        pass
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


def _write_json_atomic(folder, name, payload):
    p = os.path.join(_ensure(folder), name)
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(payload, f)
    os.replace(tmp, p)


def _object_guid(obj):
    g = obj.get(GUID_PROP)
    if not g:
        g = "uvs-%x-%x" % (int(time.time() * 1e6) & 0xFFFFFFFF, abs(hash(obj.name)) & 0xFFFFFF)
        obj[GUID_PROP] = g
    return g


def _open_app():
    """Bring the UV Studio app to the front (launch if needed). Best-effort."""
    try:
        if sys.platform == "darwin":
            if subprocess.call(["open", "-b", APP_BUNDLE_ID]) != 0:
                subprocess.call(["open", "-a", APP_NAME])
        elif sys.platform.startswith("win"):
            os.startfile(APP_NAME)  # noqa
    except Exception:
        pass


def _selected_meshes(context):
    return [o for o in context.selected_objects if o.type == 'MESH']


# ---- forward: Blender -> UV Studio -----------------------------------------
def _export_object(obj, depsgraph):
    """One forward object: world-space points + polygon corner indices + existing
    UVs (per corner, V-up). RAW Blender coords; the app rotates Z-up -> Y-up."""
    eval_obj = obj.evaluated_get(depsgraph)
    mesh = eval_obj.to_mesh()
    try:
        mw = obj.matrix_world
        points = []
        for v in mesh.vertices:
            co = mw @ v.co
            points.extend((co.x, co.y, co.z))  # raw Blender world (Z-up)

        polys = [list(p.vertices) for p in mesh.polygons]

        uv = None
        uv_layer = mesh.uv_layers.active
        if uv_layer:
            uv = []
            for p in mesh.polygons:
                corners = []
                for li in range(p.loop_start, p.loop_start + p.loop_total):
                    u, w = uv_layer.data[li].uv
                    corners.extend((u, w))  # V-up, as-is
                uv.append(corners)

        return {
            "name": obj.name,
            "guid": _object_guid(obj),
            "points": points,
            "polys": polys,
            **({"uv": uv} if uv is not None else {}),
        }
    finally:
        eval_obj.to_mesh_clear()


class UVSTUDIO_OT_send(bpy.types.Operator):
    bl_idname = "uvstudio.send"
    bl_label = "Send to UV Studio"
    bl_description = "Send the selected mesh objects to UV Studio for unwrapping"

    def execute(self, context):
        objs = _selected_meshes(context)
        if not objs:
            self.report({'WARNING'}, "Select one or more mesh objects first")
            return {'CANCELLED'}
        depsgraph = context.evaluated_depsgraph_get()
        out = [_export_object(o, depsgraph) for o in objs]
        payload = {
            "v": 2,
            "ts": int(time.time() * 1000),
            "kind": "geo-forward",
            "app": "blender",
            "objects": out,
        }
        link = _link_dir()
        _write_json_atomic(os.path.join(link, TO_APP), MANIFEST, payload)
        _open_app()
        self.report({'INFO'}, "Sent %d object(s) to UV Studio" % len(out))
        return {'FINISHED'}


# ---- return: UV Studio -> Blender ------------------------------------------
def _find_by_guid(guid):
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.get(GUID_PROP) == guid:
            return o
    return None


def _apply_uvs(payload):
    applied, missed = 0, []
    for ob in payload.get("objects", []):
        guid = ob.get("guid")
        obj = _find_by_guid(guid) or bpy.data.objects.get(ob.get("name", ""))
        if not obj or obj.type != 'MESH':
            missed.append(ob.get("name", guid))
            continue
        mesh = obj.data
        uv_layer = mesh.uv_layers.active or mesh.uv_layers.new(name="UVStudio")
        rows = ob.get("uv", [])
        for p in mesh.polygons:
            if p.index >= len(rows):
                continue
            row = rows[p.index]
            if not row:
                continue  # polygon the app didn't map — leave its UVs
            n = p.loop_total
            for c in range(n):
                # rows are 4 corners (a,b,c,d) = 8 floats, V-up (apply as-is)
                u = row[c * 2] if c * 2 < len(row) else row[-2]
                w = row[c * 2 + 1] if c * 2 + 1 < len(row) else row[-1]
                uv_layer.data[p.loop_start + c].uv = (u, w)
        mesh.update()
        applied += 1
    return applied, missed


class _Poller:
    last_ts = None
    timer_on = False


def _poll():
    try:
        link = _link_dir()
        man = _read_manifest(os.path.join(link, TO_C4D))
        if man and man.get("ts") != _Poller.last_ts:
            _Poller.last_ts = man.get("ts")
            if man.get("kind") == "uv-return":
                applied, missed = _apply_uvs(man)
                _write_json_atomic(
                    os.path.join(link, TO_C4D), ACK,
                    {"v": 1, "ts": int(time.time() * 1000), "kind": "uv-ack",
                     "stage": "applied", "applied": applied, "missed": missed},
                )
                # redraw any 3D views so the new UVs show immediately
                for win in bpy.context.window_manager.windows:
                    for area in win.screen.areas:
                        if area.type in {'VIEW_3D', 'IMAGE_EDITOR'}:
                            area.tag_redraw()
    except Exception:
        pass
    return POLL_SECONDS  # reschedule


# ---- UI ---------------------------------------------------------------------
class UVSTUDIO_PT_panel(bpy.types.Panel):
    bl_label = "UV Studio"
    bl_idname = "UVSTUDIO_PT_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "UV Studio"

    def draw(self, context):
        col = self.layout.column()
        col.scale_y = 1.6
        col.operator("uvstudio.send", icon='EXPORT')
        v = ".".join(str(x) for x in bl_info["version"])
        self.layout.label(text="v%s · auto-receives UVs" % v, icon='FILE_REFRESH')


_classes = (UVSTUDIO_OT_send, UVSTUDIO_PT_panel)


def register():
    for c in _classes:
        bpy.utils.register_class(c)
    if not _Poller.timer_on:
        bpy.app.timers.register(_poll, first_interval=POLL_SECONDS, persistent=True)
        _Poller.timer_on = True


def unregister():
    if _Poller.timer_on:
        try:
            bpy.app.timers.unregister(_poll)
        except Exception:
            pass
        _Poller.timer_on = False
    for c in reversed(_classes):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
