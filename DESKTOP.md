# UV Studio — one codebase, two products

The **same** React/Vite app ships as both a website and a native desktop app.
You edit the code once; both targets pick it up.

| Target | Command | Output | Where it runs |
|---|---|---|---|
| **Web** (preshow.link) | `npm run build` | `dist/` | any modern browser |
| **Desktop** (Mac + Windows) | `npm run tauri:build` | installers in `src-tauri/target/release/bundle/` | native app |
| Desktop dev | `npm run tauri:dev` | — | hot-reloads like `npm run dev` |

Nothing is forked: `src-tauri/` is a thin native shell around `dist/`. All UI,
unwrapping, PSD handling, etc. live in `src/` and are shared verbatim.

## Web build → preshow.link

`npm run build` produces a static `dist/` you can host anywhere (or embed in
preshow.link). The C4D bridge there uses the browser **File System Access API**
(Chromium) — the user grants the shared folder once via a picker. If you embed
it where that API isn't available, everything except the C4D round-trip still
works; the **Link C4D** button simply hides (`linkSupported()` is false).

## Desktop build → Mac + Windows

Prereqs (one-time):

1. Install Rust: <https://rustup.rs>
2. Install the Tauri CLI: `npm i -D @tauri-apps/cli`
   (and `npm i @tauri-apps/api` if you later call Tauri APIs from JS)
3. App icons are already generated (`npm run make-icon`, committed). To use your
   own artwork: `npm run tauri icon app-icon.png` (or edit `scripts/make-icon.mjs`).

Then:

- `npm run tauri:dev` — develop the desktop app (same hot reload as web)
- `npm run tauri:build` — produce `.dmg`/`.app` (macOS) and `.msi`/`.exe`
  (Windows). Build each OS on that OS (or via CI).

> If the Tauri scaffold ever drifts from a new CLI version, regenerate the shell
> with `npm create tauri-app@latest` and copy `src-tauri/src/main.rs` (the bridge
> commands) over — that file is the only non-boilerplate part.

## The Cinema 4D bridge

Transport is a **shared link folder** (`to_app/`, `to_c4d/`), the most robust
local-IPC method — it survives restarts, needs no ports, and queues work if one
side is closed. The single protocol is implemented three times against the same
folder layout:

- **C4D plugin** — `c4d-plugin/UVStudioBridge.pyp` (Python)
- **Web app** — `src/bridge/link.ts` via the File System Access API
- **Desktop app** — `src/bridge/link.ts` → Tauri commands in
  `src-tauri/src/main.rs` (native `fs`, no permission prompts)

Each writer drops `scene.glb` then writes `scene.json` **last**; the reader polls
the manifest timestamp, so a half-written GLB is never read.

**Round-trip:** C4D *Send selection* → app auto-loads the model → you unwrap →
**Export ▸ Send to Cinema 4D** → the plugin copies the new UVs back onto your
objects by name.

## Per-screen LED resolution travels with the export

Every export carries each screen's **render size** (the manual `RES` override if
set, otherwise the chunk/media pixel size) two ways:

- **In the GLB** — written to each mesh node's `extras`:
  `extras.uvstudio = { resolution: [w, h], aspect }`.
- **As a sidecar** — `screen_map.json` next to the GLB (and inside the bridge
  manifest `scene.json`):

  ```json
  { "v": 1, "app": "UV Studio", "kind": "screen-map",
    "screens": [ { "name": "WALL_SCREEN_01", "w": 1150, "h": 359, "aspect": 3.2 } ] }
  ```

Point a render/playback pipeline at the sidecar to build each screen's media at
the exact pixel size.

## Native file flow (desktop)

In the desktop build, Import and Export use **native OS dialogs** (Tauri commands
in `main.rs`): Export shows a Save dialog and writes the GLB **plus the sidecar**
beside it; Import shows an Open dialog. The web build keeps the browser
picker / download. Same React code — it branches on `isDesktop()`.

## CI — automated installers

`.github/workflows/desktop.yml` builds **macOS (universal) + Windows** via
`tauri-apps/tauri-action` and attaches the installers to a draft GitHub Release.
Trigger it by pushing a tag:

```
git tag v0.1.0 && git push --tags
```

`.github/workflows/web.yml` builds `dist/` on every push to `main` and uploads
it as an artifact — wire its final step to your host (or preshow.link).

`.github/workflows/ci.yml` is the fast smoke test on every push/PR: type-check +
unit tests + a web build (so regressions surface before the heavier installer
build). `package-lock.json` and the icons are committed, so all three workflows
run as-is.
