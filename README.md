# UV Studio — screen mapping

A modern, browser-based tool for mapping artwork onto **screens** in venue / event
3D models — LED walls, floors, pillars, ribbon boards. Think of it as a focused,
maximally-automatic reimagining of headus UVLayout, tailored for screen content.

Same React codebase ships **three ways**, with DCC bridges into both **Cinema 4D**
and **Blender**:

```
 Cinema 4D plugin ┐        ┌──────────────────────────────┐
 Blender add-on   ┴──────▶ │          UV Studio           │ ──▶ preshow.link
                           │  desktop app (Tauri Mac/Win) │     (web embed)
                           │  web app (Vite / React)      │
                           └──────────────────────────────┘
                            shared "link folder" bridge
```

- **Web** (`npm run build`) → a static `dist/` you host or embed in preshow.link.
- **Desktop** (`npm run tauri:build`) → native Mac/Windows apps with file access.
- **Cinema 4D plugin & Blender add-on** → round-trip the selection in and out for
  unwrapping (lossless, UV-only return).

## What it does

- Import a multi-object **GLB/glTF** (each screen = a named object) + its **PSDs /
  images**; a wizard links each layer/image to its screen by name.
- Imports keep their **own UVs**; **auto-map is opt-in** (Auto-map ALL or
  per-screen) and preserves authored UVs while fitting content. Per-screen
  rotate / flip / free-transform / unwrap projection (Auto / Planar / Cylindrical
  / Spherical, with auto seam-split for cylinders).
- The 2D view shows the **whole PSD with each screen's chunk** outlined; set the
  real **LED resolution** per screen.
- Export a **textured GLB** carrying each screen's render size (in node `extras`
  and a `screen_map.json` sidecar), or **Send back to Cinema 4D / Blender**.

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

### Cinema 4D / Blender round-trip

The bridge is **zero-config** — both ends use a shared folder in the OS temp dir
(no folder to pick). Install the plugin / add-on from the app's **Preferences**.

- **Cinema 4D** — Extensions ▸ UV Studio Bridge ▸ **Send** (selected objects).
  Unwrap here, then **Send back** → UVs write onto the original objects' UVW tags.
- **Blender** — enable the add-on once in Preferences ▸ Add-ons, then View3D ▸
  Sidebar (N) ▸ UV Studio ▸ **Send** (selected meshes). Unwrap, then **Send back**
  → UVs land on each object's active UV layer. (Blender is Z-up/right-handed; the
  app rotates to its Y-up space — a pure rotation, no mirror.)

See [`c4d-plugin/`](c4d-plugin/), [`blender-plugin/`](blender-plugin/), and
[`DESKTOP.md`](DESKTOP.md).

## How the bridge works

Transport is a **shared folder** — the most robust local-IPC method (no servers,
no ports, survives restarts, queues if one side is closed):

```
<link>/to_app/scene.json   C4D / Blender → UV Studio   (points + polys + guid)
<link>/to_c4d/scene.json   UV Studio → C4D / Blender   (UV only, per corner)
```

The forward sidecar carries each object's points + polygons + a stable guid (and
which DCC sent it, for the coordinate convention); the return is **UV-only**,
applied back onto the original object by guid — geometry never round-trips. Each
writer writes its `scene.json` manifest atomically (temp + rename), so a reader
(polling the timestamp) never sees a half-written file. The protocol is
implemented four times against the same layout: the **C4D plugin** & **Blender
add-on** (Python), the **web app** (File System Access API), and the **desktop
app** (native Rust `fs`).

## Repo layout

```
src/                   React/Vite app (UI, unwrap engine, PSD handling)
  bridge/link.ts       link-folder bridge (web + desktop backends)
src-tauri/             Tauri v2 desktop shell (Rust bridge + plugin install)
c4d-plugin/            Cinema 4D plugin (.pyp) + README + IDS
blender-plugin/        Blender add-on (uvstudio_bridge.py)
scripts/make-icon.mjs  zero-dep app-icon generator
.github/workflows/     ci.yml (smoke test) · web.yml · desktop.yml (installers)
DESKTOP.md             web vs desktop builds, bridge, CI details
```

## Tech

Vite · React 18 · TypeScript · Three.js / react-three-fiber · Zustand ·
Tailwind v4 · ag-psd · Tauri v2. Unwrapping: half-edge mesh, LSCM + ARAP relax,
planar / cylindrical / spherical projections.
