# Testing the Cinema 4D / Blender bridge

The bridge protocol is implemented four times against the same folder layout —
the C4D plugin and Blender add-on (Python), the web app (File System Access)
and the desktop app (Rust `fs`). Only the app's two halves live in this repo's
type system, so the forward payload is the part most likely to drift silently.

`src/bridge/fixtures/*-forward.json` are **captured from the real plugins**, and
`src/bridge/roundtrip.live.test.ts` runs the app pipeline over them on every CI
run. That catches protocol drift without needing a DCC installed.

Regenerate the fixtures whenever the plugins' forward payload changes.

## Both DCCs can be driven headlessly

```bash
BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
C4DPY="/Applications/Maxon Cinema 4D 2026/c4dpy.app/Contents/MacOS/c4dpy"
```

The add-on and the `.pyp` are both plain Python modules, so a test script can
import them and call the shipped code directly — no GUI, no clicking:

```python
# Blender: spec_from_file_location works as-is
# C4D: .pyp is not a recognised source suffix, so name the loader explicitly
loader = importlib.machinery.SourceFileLoader('uvstudio_bridge_c4d', PYP)
spec = importlib.util.spec_from_loader('uvstudio_bridge_c4d', loader)
```

Two things to stub in a test run:

- `mod._open_app = lambda: None` — otherwise the send launches the desktop app.
- C4D's send/apply live on `BridgeDialog`; instantiate it (its `__init__` sets
  `link_dir` on its own) and replace `_status` with a print. `main()` is
  `__main__`-guarded, so importing never registers the plugin.

## The round-trip that matters

1. **Send** — build a scene, select it, run the real operator
   (`bpy.ops.uvstudio.send()` / `BridgeDialog.send_selection()`). Writes
   `<link>/to_app/scene.json`.
2. **Map** — `sceneFromSidecar()` → `loadScene` → assign regions → `runMapping`
   → `sendToC4D()` with `./link` mocked to capture the payload. Write it to
   `<link>/to_c4d/scene.json`.
3. **Apply** — run the real apply (`mod._apply_uvs` / `BridgeDialog._write_uvw`)
   and compare every corner against what the app sent.

**Rename every object before step 3.** The apply falls back to name matching, so
a test that leaves names intact passes even if guid matching is broken — and
guid matching is the entire point of the lossless path.

Worth asserting: corner counts match per polygon, geometry is untouched (point
and polygon counts unchanged), UVs are non-degenerate, and — with two or more
objects — each occupies its own UV range. C4D's `_write_uvw` flips V on write,
so undo that before comparing.

## Last full manual run

2026-08-25, against Blender 5.2.0 LTS and Cinema 4D 2026 — both PASS.
Included a 1,200-tile single object (the shape of the shell-id collision bug):
4,800 corners applied, zero mismatches, no UV bleed into the second object.
