#!/usr/bin/env node
// Capture the docs/README screenshots (docs/img/*.png) from the running dev
// server, using headless Chrome driven over CDP with REAL-time waits — the app
// signals readiness by setting document.title to 'SHOT-READY' (see the ?shot
// loader in src/app/App.tsx, dev-only).
//
// Usage:
//   npm run dev            # or: npx vite --port 5173
//   node scripts/capture-docs.mjs [baseUrl]
//
// Requires the ZYN sample assets in public/ (zyn-test.glb + the three PSDs) —
// they're gitignored; copy them in before running.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
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
    m.error ? rej(new Error(m.error.message)) : res(m.result)
  }
}
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expr) =>
  (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value

await cdp('Page.enable')
await cdp('Runtime.enable')
// force a consistent 1440x900 @2x viewport regardless of the window's browser chrome
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
})

async function capture(name, url, { readyExpr, extra } = {}) {
  await cdp('Page.navigate', { url })
  // real-time wait for the app's readiness signal (or a custom expression)
  const expr = readyExpr ?? `document.title === 'SHOT-READY'`
  let ok = false
  for (let i = 0; i < 300 && !ok; i++) {
    await sleep(200)
    ok = await evaluate(expr).catch(() => false)
  }
  if (!ok) console.warn(`  ! ${name}: readiness signal never fired — capturing anyway`)
  if (extra) {
    await evaluate(extra)
    await sleep(600)
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' })
  writeFileSync(resolve(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'))
  console.log(`  ✓ ${name}.png`)
}

console.log(`capturing from ${BASE} …`)
await capture('landing', `${BASE}/`, {
  // landing has no loader — ready when the orb is in the DOM
  readyExpr: `!!document.querySelector('.animate-orb-breathe')`,
})
await capture('import-dialog', `${BASE}/?shot=import`)
await capture('wizard', `${BASE}/?shot=wizard`, {
  // expand one screen's media picker so the thumbnail list is visible
  extra: `[...document.querySelectorAll('li .row-lift')].find(r => r.textContent.includes('WALL_SCREEN_03'))?.click()`,
})
await capture('workspace', `${BASE}/?shot=zyn`)
await capture('venue3d', `${BASE}/?shot=zyn&view=3d`)

ws.close()
chrome.kill()
console.log('done → docs/img/')
process.exit(0)
