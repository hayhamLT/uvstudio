# Developing UV Studio

## Setup

```bash
npm install
npm run dev          # dev server → the tool is at http://localhost:5173/app/
```

`/` is the static marketing site and `/help/` is the docs site — both plain
HTML, no dev server needed to edit (see `index.html` / `public/help/`).

Use a real Chromium browser — the import pickers and the C4D link folder need the
File System Access API (an embedded webview blocks file dialogs).

## Checks (what CI runs)

```bash
npm run typecheck    # tsc -b --noEmit
npm test             # lint + format check (pretest), then vitest
npm run build        # production web build — also asserts the app page's CSP
npm run test:e2e     # Playwright smoke tests (see below)
```

Two of those do more than their names suggest, on purpose:

- **`npm test` runs a `pretest` hook** — `eslint .` then `prettier --check .`.
  Hanging the static checks off the hook rather than listing them as separate
  CI steps means they gate anything that runs the tests, including a local run
  before you push. `npm run lint` / `npm run format` if you want them alone.
- **`npm run build` fails if the app page loses its Content-Security-Policy.**
  The tag is injected by a Vite plugin (`emitAppCsp` in `vite.config.ts`) and
  verified before the bundle closes. A security header that silently disappears
  — plugin order, an upgrade, a renamed entry — looks identical on the page, so
  it is worth a hard failure rather than a warning.

E2E is separate because it needs a browser: `npx playwright install chromium`
once, then `npm run test:e2e`. It boots the real tool, drives the demo scene
through the actual store and checks the mapping pipeline and undo/redo — the
layer that catches what a type-check cannot (see `tests/e2e/`).

Bridge changes want `docs/BRIDGE-TESTING.md` too: both Cinema 4D and Blender can
be driven headlessly, so a C4D/Blender round-trip is testable without clicking.

Keep them green before pushing — `ci.yml` runs typecheck, test and build on
every push/PR.

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
