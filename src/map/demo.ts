import type { PolyMesh, SceneObject } from '../mesh/types'
import type { Region } from './types'

// ---------------------------------------------------------------------------
// A built-in demo "arena": named screen objects (flat + curved) plus a matching
// generated map image, so Screen Map mode works immediately and is testable.
// ---------------------------------------------------------------------------

type V3 = [number, number, number]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]

/** A subdivided flat quad screen from an origin + two edge vectors. */
function quadScreen(name: string, o: V3, du: V3, dv: V3, nu = 6, nv = 4): PolyMesh {
  const positions: number[] = []
  const faces: number[][] = []
  const idx = (i: number, j: number) => j * (nu + 1) + i
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = add(add(o, scale(du, i / nu)), scale(dv, j / nv))
      positions.push(p[0], p[1], p[2])
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++)
      faces.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)])
  return { name, positions: Float32Array.from(positions), faces }
}

/** A curved LED ribbon (partial cylinder), to exercise the flatten step. */
function ribbon(
  name: string,
  radius: number,
  y0: number,
  y1: number,
  a0: number,
  a1: number,
  nu = 28,
  nv = 3,
): PolyMesh {
  const positions: number[] = []
  const faces: number[][] = []
  const idx = (i: number, j: number) => j * (nu + 1) + i
  for (let j = 0; j <= nv; j++) {
    const y = y0 + (y1 - y0) * (j / nv)
    for (let i = 0; i <= nu; i++) {
      const a = a0 + (a1 - a0) * (i / nu)
      positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius)
    }
  }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++)
      faces.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)])
  return { name, positions: Float32Array.from(positions), faces }
}

export function demoArena(): SceneObject[] {
  const h = 1.2
  const r = 0.85
  const objs: SceneObject[] = []
  // Center-hung scoreboard: four vertical faces.
  objs.push({ name: 'NEZS', mesh: quadScreen('NEZS', [-r, 0, r], [2 * r, 0, 0], [0, h, 0], 8, 5) }) // front (+z)
  objs.push({ name: 'NEAX', mesh: quadScreen('NEAX', [r, 0, r], [0, 0, -2 * r], [0, h, 0], 6, 5) }) // right (+x)
  objs.push({ name: 'NWAX', mesh: quadScreen('NWAX', [-r, 0, -r], [0, 0, 2 * r], [0, h, 0], 6, 5) }) // left (-x)
  // A wide concourse panel out front.
  objs.push({
    name: 'Concourse',
    mesh: quadScreen('Concourse', [-2.4, -0.4, 2.6], [4.8, 0, 0], [0, 1.0, 0], 12, 4),
  })
  // A curved upper-ring board (front arc).
  objs.push({ name: 'URNE', mesh: ribbon('URNE', 2.6, 1.7, 2.0, Math.PI * 0.18, Math.PI * 0.82) })
  return objs
}

interface LayoutEntry {
  name: string
  color: string
  // normalized, origin top-left, y down
  x0: number
  y0: number
  x1: number
  y1: number
}

// Region aspects roughly match each screen's real aspect, so aspect-preserving
// fitting fills them cleanly (atlas is 1280×640).
const LAYOUT: LayoutEntry[] = [
  { name: 'URNE', color: '#ff7a1a', x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.13 },
  { name: 'NEZS', color: '#1faf4f', x0: 0.02, y0: 0.17, x1: 0.42, y1: 0.73 },
  { name: 'NEAX', color: '#2aa7e0', x0: 0.47, y0: 0.17, x1: 0.66, y1: 0.44 },
  { name: 'NWAX', color: '#8a2be2', x0: 0.69, y0: 0.17, x1: 0.88, y1: 0.44 },
  { name: 'Concourse', color: '#ef2b2b', x0: 0.02, y0: 0.78, x1: 0.5, y1: 0.98 },
]

export const DEMO_ATLAS_SIZE = { width: 1280, height: 640 }

/** Render the demo map image to a data URL. */
export function makeDemoAtlas(): string {
  const { width, height } = DEMO_ATLAS_SIZE
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  for (const e of LAYOUT) {
    const x = e.x0 * width
    const y = e.y0 * height
    const w = (e.x1 - e.x0) * width
    const hgt = (e.y1 - e.y0) * height
    ctx.fillStyle = e.color
    ctx.fillRect(x, y, w, hgt)
    // faint grid overlay
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    const step = 24
    for (let gx = x; gx < x + w; gx += step) {
      ctx.beginPath()
      ctx.moveTo(gx, y)
      ctx.lineTo(gx, y + hgt)
      ctx.stroke()
    }
    for (let gy = y; gy < y + hgt; gy += step) {
      ctx.beginPath()
      ctx.moveTo(x, gy)
      ctx.lineTo(x + w, gy)
      ctx.stroke()
    }
    // label
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.font = `bold ${Math.max(14, Math.min(w, hgt) * 0.18)}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(e.name, x + w / 2, y + hgt / 2)
  }
  return c.toDataURL('image/png')
}

/** Pre-labeled regions matching the demo layout (no detection/OCR needed). */
export function demoRegions(): Region[] {
  return LAYOUT.map((e, i) => ({
    id: i,
    x0: e.x0,
    y0: e.y0,
    x1: e.x1,
    y1: e.y1,
    color: hexToRgb(e.color),
    label: e.name,
    areaFrac: (e.x1 - e.x0) * (e.y1 - e.y0),
  }))
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
