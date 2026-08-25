#!/usr/bin/env node
// Capture the docs/help screenshots (docs/img/*.png) from the running dev
// server, using a VISIBLE real-GPU Chrome driven over CDP with real-time waits.
// The app signals readiness by setting document.title to 'SHOT-READY' (see the
// ?shot loader in src/app/App.tsx, dev-only). Close-ups use a CSS selector,
// evaluated in-page to a bounding rect, as the CDP screenshot clip region.
//
// Usage:
//   npm run dev            # or: npx vite --port 5173
//   npm run docs:shots     # or: node scripts/capture-docs.mjs [baseUrl]
//
// Requires the ZYN sample assets in public/ (zyn-test.glb + the three PSDs) —
// they're gitignored; copy them in before running.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
// The interactive tool lives at /app/ (root is the static marketing site).
const APP = `${BASE}/app`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9223
const OUT = resolve('docs/img')
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- boot a VISIBLE chrome with a debugging port -----------------------------
// Not headless: this machine renders WebGL blank under headless SwiftShader, so we
// use a real-GPU visible window (own profile, won't touch the user's Chrome) and
// capture via CDP Page.captureScreenshot, which composites DOM + WebGL correctly.
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    '--user-data-dir=/tmp/uvstudio-capture-profile',
    '--window-size=1440,940',
    '--force-device-scale-factor=2',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
process.on('exit', () => chrome.kill())

// wait for the devtools endpoint
let wsUrl = null
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const tabs = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())
    wsUrl = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch {
    await sleep(200)
  }
}
if (!wsUrl) throw new Error('Chrome devtools endpoint never came up')

// ---- tiny CDP client ----------------------------------------------------------
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)))
let msgId = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(m.error.message))
    else res(m.result)
  }
}
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })

// awaitPromise so `extra`/`readyExpr` can be async IIFEs (dynamic import, timers, …)
const evaluate = async (expr) =>
  (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value

await cdp('Page.enable')
await cdp('Runtime.enable')
// force a consistent 1440x900 @2x viewport regardless of the window's browser chrome
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
})

/**
 * Capture one screenshot.
 *   url          — navigate here first; omit to reuse the current page (chaining
 *                  several captures off one loaded state, e.g. two Preferences
 *                  sections without reloading the whole app).
 *   readyExpr    — polled (200ms) until truthy before capturing. Defaults to the
 *                  app's SHOT-READY title signal.
 *   extra        — one more expression run right before capture (click a button,
 *                  select a screen, push a toast, …). Awaited if it returns a Promise.
 *   clipSelector — a JS expression returning a DOM element (or null) whose
 *                  bounding box becomes the screenshot's clip region → a close-up
 *                  instead of the full window.
 *   clipRect     — an explicit {x,y,width,height} in CSS px, for when no single
 *                  element cleanly bounds the area (e.g. "top strip with toasts").
 *   pad          — px of breathing room added around clipSelector's rect.
 */
async function capture(name, { url, readyExpr, extra, clipSelector, clipRect, pad = 20 } = {}) {
  if (url) {
    await cdp('Page.navigate', { url })
    const expr = readyExpr ?? `document.title === 'SHOT-READY'`
    let ok = false
    for (let i = 0; i < 300 && !ok; i++) {
      await sleep(200)
      ok = await evaluate(expr).catch(() => false)
    }
    if (!ok) console.warn(`  ! ${name}: readiness signal never fired — capturing anyway`)
  }
  if (extra) {
    await evaluate(extra)
    await sleep(500)
  }
  let clip = clipRect ? { ...clipRect, scale: 1 } : undefined
  if (clipSelector) {
    const rect = await evaluate(
      `(() => { const el = ${clipSelector}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    )
    if (rect) {
      clip = {
        x: Math.max(0, rect.x - pad),
        y: Math.max(0, rect.y - pad),
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        scale: 1,
      }
    } else {
      console.warn(`  ! ${name}: clipSelector matched nothing — capturing full page`)
    }
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
  console.log(`  ✓ ${name}.png${clip ? ' (close-up)' : ''}`)
}

// ---- shared JS snippets ---------------------------------------------------
const selectFloor = `(async () => {
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().selectObject('FLOOR_SCREEN')
  await new Promise(r => setTimeout(r, 250))
})()`

console.log(`capturing from ${BASE} (app at ${APP}) …`)

// ---- 1. quick-start flow: full-window shots --------------------------------
await capture('landing', {
  url: `${APP}/`,
  readyExpr: `!!document.querySelector('.animate-orb-breathe')`,
})
await capture('import-dialog', { url: `${APP}/?shot=import` })
await capture('wizard', {
  url: `${APP}/?shot=wizard`,
  // expand one screen's media picker so the thumbnail list is visible
  extra: `[...document.querySelectorAll('li .row-lift')].find(r => r.textContent.includes('WALL_SCREEN_03'))?.click()`,
})
// NB: the ?shot loader ghosts reference geometry to 35% for every scene shot,
// so venue3d/workspace/docked all show the translucent-walls look.
await capture('workspace', { url: `${APP}/?shot=zyn` })
await capture('venue3d', { url: `${APP}/?shot=zyn&view=3d` }) // also the marketing/README hero
// docked split view — click the floating window's "Dock" button
await capture('docked', {
  url: `${APP}/?shot=zyn`,
  extra: `document.querySelector('[title^="Dock"]')?.click()`,
})

// ---- 2. 3D view modes: close-ups of the 3D pane only -----------------------
const view3dPane = `document.querySelector('[title*="Checker"]')?.closest('.relative.h-full.w-full')`
await capture('view-checker', {
  url: `${APP}/?shot=zyn&view=3d`,
  extra: `document.querySelector('[title*="Checker"]')?.click()`,
  clipSelector: view3dPane,
  pad: 4,
})
await capture('view-distortion', {
  extra: `document.querySelector('[title*="Distortion"]')?.click()`,
  clipSelector: `document.querySelector('[title*="Distortion"]')?.closest('.relative.h-full.w-full')`,
  pad: 4,
})

// ---- 3. free transform: gizmo on a selected screen -------------------------
await capture('free-transform', {
  url: `${APP}/?shot=zyn`,
  extra: `(async () => {
    const s = (await import('/src/state/store.ts')).useStore
    s.getState().selectObject('FLOOR_SCREEN')
    s.getState().setEditMode('transform')
    await new Promise(r => setTimeout(r, 300))
  })()`,
  clipSelector: `document.querySelector('[title*="Auto-map this screen"]')?.closest('.relative.h-full.w-full')`,
  pad: 4,
})

// ---- 4. 2D transform bar: rotate / flip / free-transform / projection ------
await capture('transform-bar', {
  extra: selectFloor,
  clipSelector: `document.querySelector('[title*="Auto-map this screen"]')?.closest('.absolute.bottom-3')`,
  pad: 10,
})

// ---- 5. screens panel: a selected row (thumbnail, actions, RES override) ---
await capture('screen-row', {
  clipSelector: `[...document.querySelectorAll('div')].find(el => el.className.includes('row-lift') && el.textContent.includes('FLOOR_SCREEN'))`,
  pad: 10,
})

// ---- 6. reference geometry section -----------------------------------------
await capture('reference-geometry', {
  clipSelector: `[...document.querySelectorAll('span')].find(s => s.textContent === 'Reference geometry')?.closest('.border-t.border-line.px-3')`,
  pad: 10,
})

// ---- 7. Auto-map + a live toast (full window — button top-left, toast bottom-right)
await capture('automap-toast', {
  extra: `(async () => {
    const s = (await import('/src/state/store.ts')).useStore
    s.getState().runMapping({ announce: true })
    await new Promise(r => setTimeout(r, 350))
  })()`,
})

// ---- 8. toast variants (good / warn / bad) ---------------------------------
await capture('toasts', {
  url: `${APP}/`,
  readyExpr: `!!document.querySelector('.animate-orb-breathe')`,
  extra: `(async () => {
    const s = (await import('/src/state/store.ts')).useStore
    s.getState().pushToast('good', 'Cinema 4D applied UVs to 6 objects')
    s.getState().pushToast('warn', "Blender applied 4 objects — couldn't find: WALL_SCREEN_04, PILLAR_B")
    s.getState().pushToast('bad', 'Send failed — check the link folder in Preferences')
    await new Promise(r => setTimeout(r, 200))
  })()`,
  clipSelector: `document.querySelector('.fixed.bottom-3.right-3')`,
  pad: 8,
})

// ---- 9. source-aware action button: Export vs Send back --------------------
await capture('export-button', {
  url: `${APP}/?shot=zyn`,
  clipSelector: `document.querySelector('header')`,
  pad: 0,
})
await capture('sendback-button', {
  url: `${APP}/`,
  readyExpr: `!!document.querySelector('.animate-orb-breathe')`,
  extra: `(async () => {
    const rt = await import('/src/bridge/roundtrip.ts')
    const s = (await import('/src/state/store.ts')).useStore
    const sidecar = { v: 2, ts: 1, kind: 'geo-forward', app: 'c4d', objects: [
      { name: 'FLOOR_SCREEN', guid: 'doc-floor', points: [0,0,0, 4,0,0, 4,3,0, 0,3,0], polys: [[0,1,2,3]] },
    ]}
    const objs = rt.sceneFromSidecar(sidecar)
    s.getState().loadScene(objs, { screenNames: objs.map(o => o.name) })
    await new Promise(r => setTimeout(r, 200))
    s.getState().runMapping()
    await new Promise(r => setTimeout(r, 200))
  })()`,
  clipSelector: `document.querySelector('header')`,
  pad: 0,
})

// ---- 10. Preferences — Cinema 4D & Blender sections (desktop layout) -------
await capture('preferences-c4d', {
  url: `${APP}/?shot=prefs-desktop`,
  readyExpr: `!!document.querySelector('.animate-orb-breathe')`,
  extra: `(async () => {
    document.querySelector('[title="Preferences"]')?.click()
    for (let i = 0; i < 50; i++) {
      if ([...document.querySelectorAll('h2')].some(h => h.textContent === 'Preferences')) break
      await new Promise(r => setTimeout(r, 100))
    }
  })()`,
  clipSelector: `[...document.querySelectorAll('div')].find(d => d.className.includes('mb-2') && d.textContent === 'Cinema 4D')?.closest('.mb-5')`,
  pad: 14,
})
await capture('preferences-blender', {
  // reuse the still-open Preferences modal — no navigation
  clipSelector: `[...document.querySelectorAll('div')].find(d => d.className.includes('mb-2') && d.textContent === 'Blender')?.closest('.mb-5')`,
  pad: 14,
})

ws.close()
chrome.kill()
console.log('done → docs/img/')
process.exit(0)
