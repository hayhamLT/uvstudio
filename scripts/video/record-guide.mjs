// Record the landing-page guide video by driving the REAL app.
//
//   npx playwright install chromium     # once
//   npm run dev -- --port 5199          # (the script starts one if absent)
//   node scripts/video/record-guide.mjs
//
// Output: public/guide.mp4 + public/guide-poster.jpg.
//
// Everything on screen is the actual tool doing the actual work — the only
// synthetic element is the caption strip, which is injected into the page.
//
// Playwright records VP8/WebM; that gets transcoded to H.264 because the mp4
// comes out ~3x SMALLER at the same quality here and plays everywhere,
// Safari included. The webm is an intermediate and is not kept.
import { chromium } from '@playwright/test'
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:5199'
const OUT = resolve('public')
const TMP = resolve('.video-tmp')
const W = 1280
const H = 720

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- caption strip -----------------------------------------------------------
// Injected, not composited afterwards, so it survives the video encode and stays
// in sync with whatever the app is actually doing at that moment.
const CAPTION_CSS = `
#guide-cap {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
  display: flex; align-items: center; gap: 14px;
  /* bottom padding clears the browser's native video controls, which otherwise
     sit right on top of the captions whenever the player is paused or hovered */
  padding: 18px 26px 58px;
  font: 500 17px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #fafafa; letter-spacing: -0.01em;
  background: linear-gradient(to top, rgba(4,5,8,0.94) 40%, rgba(4,5,8,0));
  opacity: 0; transform: translateY(8px);
  transition: opacity .45s ease, transform .45s ease;
  pointer-events: none;
}
#guide-cap.on { opacity: 1; transform: none; }
#guide-cap .n {
  flex: none; width: 26px; height: 26px; border-radius: 999px;
  display: grid; place-items: center;
  background: #2da9f7; color: #04121f; font-size: 13px; font-weight: 700;
}
#guide-cap .t b { color: #8ad8ff; font-weight: 600; }
#guide-title {
  position: fixed; inset: 0; z-index: 2147483646;
  display: grid; place-content: center; justify-items: center; gap: 18px;
  background: #09090b; color: #fafafa; text-align: center;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  opacity: 1; transition: opacity .6s ease;
}
#guide-title.off { opacity: 0; }
#guide-title h1 { font-size: 46px; margin: 0; letter-spacing: -0.03em; font-weight: 600; }
#guide-title p { margin: 0; font-size: 18px; color: rgba(255,255,255,0.64); }
#guide-title .url { margin-top: 10px; font-size: 15px; color: #8ad8ff; }
`

async function install(page) {
  await page.addStyleTag({ content: CAPTION_CSS })
  await page.evaluate(() => {
    const cap = document.createElement('div')
    cap.id = 'guide-cap'
    cap.innerHTML = '<div class="n"></div><div class="t"></div>'
    document.body.appendChild(cap)
  })
}

async function caption(page, n, html, hold = 0) {
  await page.evaluate(
    ([n, html]) => {
      const c = document.getElementById('guide-cap')
      if (!c) return
      c.querySelector('.n').textContent = n
      c.querySelector('.t').innerHTML = html
      c.classList.add('on')
    },
    [String(n), html],
  )
  if (hold) await sleep(hold)
}

async function hideCaption(page) {
  await page.evaluate(() => document.getElementById('guide-cap')?.classList.remove('on'))
  await sleep(500)
}

async function card(page, title, sub, url, hold) {
  await page.evaluate(
    ([title, sub, url]) => {
      let t = document.getElementById('guide-title')
      if (!t) {
        t = document.createElement('div')
        t.id = 'guide-title'
        document.body.appendChild(t)
      }
      t.classList.remove('off')
      t.innerHTML = `<h1>${title}</h1><p>${sub}</p>` + (url ? `<div class="url">${url}</div>` : '')
    },
    [title, sub, url || ''],
  )
  await sleep(hold)
}

async function dropCard(page) {
  await page.evaluate(() => document.getElementById('guide-title')?.classList.add('off'))
  await sleep(700)
  await page.evaluate(() => document.getElementById('guide-title')?.remove())
}

/** Drag across the 3D canvas so OrbitControls swings the camera — the venue
 *  reading as a real 3D space is the whole point of the shot. */
/**
 * The PRIMARY viewport's canvas.
 *
 * Not "the biggest canvas": the docked secondary panel sits on the left and can
 * be wider than the primary, and the screens list renders a 56x40 canvas per
 * thumbnail. The primary is the right-hand one of the two full-height canvases.
 */
async function bigCanvas(page) {
  const boxes = await page.locator('canvas').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }),
  )
  const panes = boxes.filter((b) => b.height > 300)
  return panes.sort((a, b) => b.x - a.x)[0]
}

/** Dolly in on the 3D view. The venue model sits on a very large floor disc, so
 *  the default framing fits the floor and leaves the actual screens tiny. */
async function zoomIn(page, notches = 24) {
  const box = await bigCanvas(page)
  if (!box) return
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, -260)
    await sleep(70)
  }
  await sleep(500)
}

async function orbit(page, ms, dx = 190) {
  const box = await bigCanvas(page)
  if (!box) return
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const steps = Math.max(12, Math.round(ms / 45))
  for (let i = 1; i <= steps; i++) {
    // ease-in-out so the move starts and settles gently rather than snapping
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    await page.mouse.move(cx + dx * e, cy - 22 * e)
    await sleep(45)
  }
  await page.mouse.up()
  await sleep(400)
}

// ---- the walkthrough ---------------------------------------------------------
async function main() {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(TMP, { recursive: true })

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'],
  })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: TMP, size: { width: W, height: H } },
  })
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && console.error('  page error:', m.text()))

  // Dock the two viewports before first paint. The app defaults the 3D view to
  // a small floating window, which reads as an afterthought on a landing page —
  // for a venue tool the 3D IS the shot.
  await page.addInitScript(() => {
    localStorage.setItem('uvstudio.docked', '1')
    // `split` is the SECONDARY pane's fraction — keep it small so the primary
    // (the 3D venue, after the swap) gets the room
    localStorage.setItem('uvstudio.split', '0.3')
  })

  await page.goto(`${BASE}/app/`)
  await page.getByLabel('Import model').waitFor()
  await install(page)

  await card(page, 'UV&nbsp;Studio', 'Map artwork onto every screen in your venue', '', 2600)
  await dropCard(page)
  await sleep(900)

  // 1 — import a real venue GLB through the real import path
  await caption(
    page,
    1,
    'Drop a venue model — or <b>Send</b> a selection straight from Cinema&nbsp;4D or Blender',
    2600,
  )
  await page.evaluate(async () => {
    const im = await import('/src/ui/importMap.ts')
    const buf = await (await fetch('/landing-venue.glb')).arrayBuffer()
    const f = new File([buf], 'Venue.glb', { type: 'model/gltf-binary' })
    await im.importModelFile(f, null, [])
  })
  await page.waitForFunction(() => !!window.uvStore?.getState().pendingImport, null, { timeout: 20000 })
  await sleep(1200)

  // 2 — the auto-detected screen selection
  await caption(
    page,
    2,
    'Screens are <b>auto-detected by name</b> — everything else comes in as reference geometry',
    3400,
  )
  await page.evaluate(() => {
    const s = window.uvStore.getState()
    s.confirmImport((s.pendingImport?.objects ?? []).filter((o) => /LED/i.test(o.name)).map((o) => o.name))
  })
  await page.waitForFunction(() => window.uvStore.getState().mapObjects.length > 0, null, { timeout: 20000 })
  await sleep(2200)

  // 3 — attach artwork
  await caption(page, 3, 'Link your artwork — a PSD layer or image per screen, matched by name', 2600)
  await page.evaluate(async () => {
    const s = window.uvStore.getState()
    const buf = await (await fetch('/show-content.png')).arrayBuffer()
    for (const o of s.mapObjects) {
      await window.uvStore
        .getState()
        .setObjectImage(o.name, new File([buf], `${o.name}.png`, { type: 'image/png' }), {
          remap: false,
        })
    }
  })
  await sleep(1800)

  // 4 — one click maps everything
  await caption(page, 4, '<b>Auto-map</b> fits every screen to its content in one click', 2200)
  await page.evaluate(() => window.uvStore.getState().runMapping({ announce: true }))
  await sleep(2600)

  // put the venue itself on the big pane, ghosted the way the docs shoot it
  await page.evaluate(() => window.uvStore.getState().setContextOpacity(0.35))
  // Click the real swap control rather than pressing Tab: the hotkey handler
  // bails when focus sits in an input (the per-screen RES fields), which is
  // exactly where it lands after selecting a screen.
  await page.getByLabel('Swap the two views (Tab)').click()
  await sleep(900)
  const primary = await page.evaluate(() => localStorage.getItem('uvstudio.primary'))
  if (primary !== '3d') throw new Error(`3D did not become the primary pane (got ${primary})`)
  await zoomIn(page, 24)
  await orbit(page, 2000)

  // 5 — per-screen control
  await caption(
    page,
    5,
    'Tweak any screen on its own — rotate, flip, free-transform, set the real LED size',
    2000,
  )
  await page.evaluate(() => {
    const s = window.uvStore.getState()
    const main = s.mapObjects.find((o) => /Main/i.test(o.name)) ?? s.mapObjects[0]
    s.selectObject(main.name)
  })
  await sleep(1600)
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const s = window.uvStore.getState()
      s.rotateObject(s.selectedObject, 'cw')
    })
    await sleep(1100)
  }
  await page.evaluate(() => {
    const s = window.uvStore.getState()
    s.rotateObject(s.selectedObject, 'ccw')
    s.rotateObject(s.selectedObject, 'ccw')
  })
  await sleep(1400)

  // 6 — the way back out
  await caption(
    page,
    6,
    'Send the UVs back to Cinema&nbsp;4D or Blender — <b>losslessly</b> — or export a textured GLB',
    3400,
  )
  await hideCaption(page)

  await card(
    page,
    'Free. Mac, Windows, and the browser.',
    'Part of the Toy Robot Media family',
    'uv.preshow.link',
    3200,
  )
  await sleep(400)

  await ctx.close()
  await browser.close()

  const file = readdirSync(TMP).find((f) => f.endsWith('.webm'))
  if (!file) throw new Error('playwright produced no video')
  const raw = resolve(TMP, file)

  const mp4 = resolve(OUT, 'guide.mp4')
  const poster = resolve(OUT, 'guide-poster.jpg')
  try {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      raw,
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '24',
      '-preset',
      'slow',
      '-movflags',
      '+faststart',
      '-an',
      mp4,
      '-y',
    ])
    // poster: a frame from the 3D orbit, i.e. the shot worth showing at rest
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '39',
      '-i',
      raw,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      poster,
      '-y',
    ])
    rmSync(TMP, { recursive: true, force: true })
    console.log('wrote', mp4, '+', poster)
  } catch (e) {
    // no ffmpeg on PATH — keep the raw capture so the run is not wasted
    const fallback = resolve(OUT, 'guide.webm')
    if (existsSync(fallback)) rmSync(fallback)
    renameSync(raw, fallback)
    rmSync(TMP, { recursive: true, force: true })
    console.warn('ffmpeg unavailable (%s) — kept %s; install ffmpeg for the mp4', e.message, fallback)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
