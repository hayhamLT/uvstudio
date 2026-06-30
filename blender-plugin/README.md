# UV Studio Bridge — Blender add-on

Round-trips the **selected mesh objects** to [UV Studio](../README.md) and back,
over the same shared-folder bridge the Cinema 4D plugin uses. Geometry never
leaves Blender — only UV coordinates come back, written onto each object's active
UV layer (lossless).

```
Blender --(points + polys + guid)--> <temp>/UVStudioBridge/to_app/scene.json --> UV Studio
Blender <--(UVs per face-corner)----- <temp>/UVStudioBridge/to_c4d/scene.json  <-- UV Studio
```

## Install

- **Easiest:** UV Studio ▸ **Preferences ▸ Blender ▸ Install** drops the add-on
  into every detected Blender version's addons folder. Then in Blender:
  **Edit ▸ Preferences ▸ Add-ons** → enable **UV Studio Bridge** (once).
- **Manual:** install `uvstudio_bridge.py` via Blender ▸ Preferences ▸ Add-ons ▸
  *Install from Disk*, then enable it.

Addons folder by OS:
- macOS `~/Library/Application Support/Blender/<ver>/scripts/addons/`
- Windows `%APPDATA%\Blender Foundation\Blender\<ver>\scripts\addons\`
- Linux `~/.config/blender/<ver>/scripts/addons/`

## Use

1. Select one or more mesh objects.
2. **View3D ▸ Sidebar (N) ▸ UV Studio ▸ Send** — they open in UV Studio.
3. Unwrap there, then **Send back** — the add-on auto-receives (1 s poll) and
   writes the UVs onto each object's active UV layer.

## Notes

- **Coordinates:** the add-on exports raw Blender world coords (Z-up,
  right-handed) tagged `app:"blender"`; UV Studio rotates to its Y-up space — a
  pure rotation, no mirror. UVs are V-up on both sides, so V is applied as-is.
- **Matching:** objects are re-found by a stable guid stored in
  `obj["uvstudio_guid"]` (falls back to name).
- **Limitation:** the UV-return addresses 4 corners (tri/quad). N-gons (>4 sides)
  aren't round-tripped — triangulate/quadify screens first if needed.
- Tested against Blender 3.6 – 5.x.
