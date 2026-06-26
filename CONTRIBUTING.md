# Developing UV Studio

## Setup

```bash
npm install
npm run dev          # web app → http://localhost:5173
```

Use a real Chromium browser — the import pickers and the C4D link folder need the
File System Access API (an embedded webview blocks file dialogs).

## Checks (what CI runs)

```bash
npm run typecheck    # tsc -b --noEmit
npm test             # vitest (half-edge, LSCM, packer)
npm run build        # production web build
```

Keep all three green before pushing — `ci.yml` runs them on every push/PR.

## Desktop (Tauri)

```bash
# one-time: install Rust (https://rustup.rs) and the Tauri CLI
npm i -D @tauri-apps/cli

npm run tauri:dev    # desktop app with hot reload
npm run tauri:build  # installers in src-tauri/target/release/bundle/
npm run make-icon    # regenerate app icons (scripts/make-icon.mjs)
```

The desktop shell is `src-tauri/` — a thin Rust wrapper around the same web build.
The only non-boilerplate file is `src-tauri/src/main.rs` (the C4D bridge commands);
if the Tauri scaffold ever drifts, regenerate with `npm create tauri-app@latest`
and copy `main.rs` back.

## Layout & conventions

- `src/` — all UI + the unwrap engine + PSD handling (shared by web and desktop).
- `src/state/store.ts` — the Zustand store; most app logic lives here.
- `src/bridge/link.ts` — the C4D link-folder bridge (web + desktop backends).
- `c4d-plugin/` — the Cinema 4D plugin (Python).
- Match the surrounding code style; TypeScript strict, no `any` where avoidable.
- Conventional, present-tense commit summaries.

## Releasing

```bash
git tag v0.1.0 && git push --tags
```

triggers `desktop.yml` → builds macOS (universal) + Windows installers and attaches
them to a draft GitHub Release. See [DESKTOP.md](DESKTOP.md) for the full picture.
