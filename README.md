# UV Studio — screen mapping

A modern, browser-based tool for mapping artwork onto **screens** in venue / event
3D models — LED walls, floors, pillars, ribbon boards. Think of it as a focused,
maximally-automatic reimagining of headus UVLayout, tailored for screen content.

Same React codebase ships **three ways**:

```
            ┌─────────────────────────────────────────────┐
 Cinema 4D  │                  UV Studio                   │   preshow.link
  plugin ◀──┼─▶  desktop app (Tauri, Mac + Win)            │   (web embed)
  (.pyp)    │    web app (Vite/React, any browser) ────────┼──▶
            └─────────────────────────────────────────────┘
                 shared "link folder"  (GLB interchange)
```

- **Web** (`npm run build`) → a static `dist/` you host or embed in preshow.link.
- **Desktop** (`npm run tauri:build`) → native Mac/Windows apps with file access.
- **Cinema 4D plugin** → round-trips the selection in and out for unwrapping.

## What it does

- Import a multi-object **GLB/glTF** (each screen = a named object) + its **PSDs /
  images**; a wizard links each layer/image to its screen by name.
- **Auto-maps on import**, preserving each screen's authored UVs and fitting its
  content. Per-screen rotate / flip / free-transform / unwrap projection
  (Auto / Planar / Cylindrical / Spherical, with auto seam-split for cylinders).
- The 2D view shows the **whole PSD with each screen's chunk** outlined; set the
  real **LED resolution** per screen.
- Export a **textured GLB** carrying each screen's render size (in node `extras`
  and a `screen_map.json` sidecar), or **Send to Cinema 4D**.

## Quickstart

```bash
npm install

npm run dev          # web app at http://localhost:5173
npm test             # unit tests
npm run typecheck    # tsc

npm run tauri:dev    # desktop app (needs Rust — https://rustup.rs)
npm run tauri:build  # → installers in src-tauri/target/release/bundle/
```

> Use a real Chromium browser (not an embedded webview) for the web app — the
> import file-pickers and the C4D link folder need the File System Access API.

### Cinema 4D round-trip

1. Copy `c4d-plugin/` into Cinema 4D's `plugins/` folder, restart, open
   **Extensions ▸ UV Studio Bridge**.
2. Point the plugin **and** the app's **Link C4D** button at the *same* shared
   folder (e.g. `~/UVStudioLink`).
3. In C4D: select objects → **Send selection to UV Studio** → the app loads them.
4. Unwrap, then **Export ▸ Send to Cinema 4D** → the plugin copies the new UVs
   back onto your objects by name.

See [`c4d-plugin/README.md`](c4d-plugin/README.md) and [`DESKTOP.md`](DESKTOP.md).

## How the bridge works

Transport is a **shared folder** — the most robust local-IPC method (no servers,
no ports, survives restarts, queues if one side is closed):

```
<link>/to_app/scene.glb + scene.json   C4D → UV Studio
<link>/to_c4d/scene.glb + scene.json   UV Studio → C4D
```

Each writer drops `scene.glb` then writes the small `scene.json` manifest **last**,
so a reader (polling the manifest timestamp) never sees a half-written GLB. The
manifest also carries every screen's LED render size. The protocol is implemented
three times against the same layout: the C4D plugin (Python), the web app
(File System Access API), and the desktop app (native Rust `fs`).

## Repo layout

```
src/                   React/Vite app (UI, unwrap engine, PSD handling)
  bridge/link.ts       C4D link-folder bridge (web + desktop backends)
src-tauri/             Tauri v2 desktop shell (Rust bridge commands)
c4d-plugin/            Cinema 4D plugin (.pyp) + README
scripts/make-icon.mjs  zero-dep app-icon generator
.github/workflows/     ci.yml (smoke test) · web.yml · desktop.yml (installers)
DESKTOP.md             web vs desktop builds, bridge, CI details
```

## Tech

Vite · React 18 · TypeScript · Three.js / react-three-fiber · Zustand ·
Tailwind v4 · ag-psd · Tauri v2. Unwrapping: half-edge mesh, LSCM + ARAP relax,
planar / cylindrical / spherical projections.
