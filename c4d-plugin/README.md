# UV Studio Bridge — Cinema 4D plugin

**Losslessly** round-trips the **selected objects** between Cinema 4D and UV
Studio through a **shared folder** — no servers, no ports, works offline. The
geometry never leaves C4D; only UV coordinates come back, so normals, materials,
hierarchy, point order — everything but the UVs — is preserved.

```
C4D  ──(points + polys)──▶  <link>/to_app/scene.json   ──▶  UV Studio   (unwrap / edit)
C4D  ◀──(per-corner UVs)──  <link>/to_c4d/scene.json    ◀──  UV Studio   (Send back)
```

UV Studio builds its mesh **1:1** from the points+polys sidecar — every app
vertex is a C4D point, every app face a C4D polygon — so the UVs it sends back
land on your objects' UVW tags addressed by polygon + corner. No glTF, no
welding/triangulation, no exporter required.

## Install

**Easiest (desktop app):** click **Install plugin** in UV Studio's top bar and pick
your Cinema 4D `plugins/` folder — it copies the plugin in for you. Then restart
C4D. (Manual steps below if you prefer, or you're on the web version.)

1. Copy the `c4d-plugin` folder into your Cinema 4D **`plugins/`** directory
   (rename it `UVStudioBridge` if you like). Typical locations:
   - macOS: `~/Library/Preferences/Maxon/<version>/plugins/`
   - Windows: `%APPDATA%\Maxon\<version>\plugins\`
2. Restart Cinema 4D.
3. Open it from **Extensions ▸ UV Studio Bridge**. Dock the panel anywhere.

## One-time setup

Pick a **shared link folder** that both apps point at (e.g.
`~/UVStudioLink`). In the panel click **Link folder…** and choose it. UV Studio
will point at the *same* folder (Link C4D button → choose the same directory).

The plugin creates `to_app/` and `to_c4d/` inside it automatically.

## Use

- **Send:** select **editable polygon** object(s) in C4D → click **Send selection
  to UV Studio**. UV Studio (if its Link folder is connected) auto-loads them.
- **Receive:** in UV Studio, unwrap, then **Export ▸ Send to Cinema 4D**.
  With *Auto-receive* ticked, the plugin writes the new UVs onto your original
  objects within a second — matched by a stable id (then by name) — leaving the
  geometry, materials, and hierarchy untouched. Re-projecting a cylinder adds a
  UV seam with **no** geometry change (C4D UVW tags are per-corner).

## Notes

- **Editable polygons only** in this version: make generators/SDS editable (press
  **C**) before sending. UVs land on the object's existing UVW tag (created if
  absent) — never as a new object.
- If you edit an object's topology between Send and Receive, the plugin refuses
  that object's UVs (count mismatch) rather than mis-mapping — just re-send.
- No glTF needed at all: the forward trip reads points/polygons directly, the
  return trip writes UV coordinates directly.
- `PLUGIN_ID = 1066001` is a placeholder. For distribution, register a unique ID
  at <https://plugincafe.maxon.net> and replace it.
