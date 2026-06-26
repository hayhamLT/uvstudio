# App icons

These are **generated** — a white isometric cube on the brand gradient. The set
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`,
`icon.icns`) is produced with zero dependencies by:

```
npm run make-icon          # scripts/make-icon.mjs → fills this folder + app-icon.png
```

Re-run it any time. To swap in your own artwork, either edit the logo drawing in
`scripts/make-icon.mjs`, or replace `app-icon.png` (a 1024² source) and run the
official generator for the full platform set:

```
npm run tauri icon app-icon.png
```
