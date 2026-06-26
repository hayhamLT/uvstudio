# UV Studio Bridge — Cinema 4D plugin

Round-trips the **selected objects** between Cinema 4D and UV Studio through a
**shared folder** — no servers, no ports, works offline.

```
C4D  ──(GLB)──▶  <link folder>/to_app/   ──▶  UV Studio   (unwrap / edit)
C4D  ◀──(GLB)──  <link folder>/to_c4d/    ◀──  UV Studio   (Send back)
```

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

- **Send:** select object(s) in C4D → click **Send selection to UV Studio**.
  UV Studio (if its Link folder is connected) auto-loads them.
- **Receive:** in UV Studio, unwrap, then **Export ▸ Send to Cinema 4D**.
  With *Auto-receive* ticked, the plugin imports it within a second:
  - same point/polygon count → it **copies the new UVs onto your original
    objects** by name (your scene is untouched otherwise);
  - different topology (e.g. you re-projected a cylinder, which adds a seam) →
    it drops the returned object into the scene so you can swap it in.

## Notes

- The glTF im/exporter is discovered by name at runtime — no version-specific
  IDs hardcoded. Requires a C4D build that ships glTF I/O (R23+/2024+).
- `PLUGIN_ID = 1066001` is a placeholder. For distribution, register a unique ID
  at <https://plugincafe.maxon.net> and replace it.
- GLB is the single interchange format end-to-end (C4D ⇄ UV Studio ⇄ web).
