// ---------------------------------------------------------------------------
// UV island packing into the unit [0,1]² square.
//
// Each island keeps its relative scale (uniform texel density). We optionally
// rotate each island to its tightest bounding box, then NFDH shelf-pack and
// binary-search the global scale that best fills the square.
// ---------------------------------------------------------------------------

export interface PackIsland {
  /** interleaved uv, length 2*n */
  uv: Float32Array
}

export interface PackResult {
  /** transformed uv per island, all within [0,1] */
  uv: Float32Array[]
  fill: number // fraction of the unit square covered by island bounding boxes
}

interface Prepared {
  uv: Float32Array // rotated + origin-shifted
  w: number
  h: number
}

function prepare(island: PackIsland, angleSteps: number): Prepared {
  const src = island.uv
  const n = src.length / 2
  let bestArea = Infinity
  let bestAngle = 0
  for (let s = 0; s < angleSteps; s++) {
    const ang = (Math.PI * s) / angleSteps
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = src[i * 2]
      const y = src[i * 2 + 1]
      const rx = ca * x - sa * y
      const ry = sa * x + ca * y
      if (rx < minX) minX = rx
      if (rx > maxX) maxX = rx
      if (ry < minY) minY = ry
      if (ry > maxY) maxY = ry
    }
    const area = (maxX - minX) * (maxY - minY)
    if (area < bestArea) {
      bestArea = area
      bestAngle = ang
    }
  }
  const ca = Math.cos(bestAngle)
  const sa = Math.sin(bestAngle)
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  const out = new Float32Array(src.length)
  for (let i = 0; i < n; i++) {
    const x = src[i * 2]
    const y = src[i * 2 + 1]
    out[i * 2] = ca * x - sa * y
    out[i * 2 + 1] = sa * x + ca * y
    if (out[i * 2] < minX) minX = out[i * 2]
    if (out[i * 2] > maxX) maxX = out[i * 2]
    if (out[i * 2 + 1] < minY) minY = out[i * 2 + 1]
    if (out[i * 2 + 1] > maxY) maxY = out[i * 2 + 1]
  }
  for (let i = 0; i < n; i++) {
    out[i * 2] -= minX
    out[i * 2 + 1] -= minY
  }
  return { uv: out, w: maxX - minX || 1e-6, h: maxY - minY || 1e-6 }
}

function shelf(
  prepared: Prepared[],
  order: number[],
  scale: number,
  margin: number,
): { height: number; pos: [number, number][] } {
  const pos: [number, number][] = new Array(prepared.length)
  let x = margin
  let y = margin
  let rowH = 0
  for (const idx of order) {
    const w = prepared[idx].w * scale
    const h = prepared[idx].h * scale
    if (x + w + margin > 1 && x > margin) {
      x = margin
      y += rowH + margin
      rowH = 0
    }
    pos[idx] = [x, y]
    x += w + margin
    rowH = Math.max(rowH, h)
  }
  return { height: y + rowH + margin, pos }
}

export function packIslands(
  islands: PackIsland[],
  opts: { margin?: number; angleSteps?: number } = {},
): PackResult {
  const margin = opts.margin ?? 0.008
  const angleSteps = opts.angleSteps ?? 24
  if (islands.length === 0) return { uv: [], fill: 0 }

  const prepared = islands.map((i) => prepare(i, angleSteps))
  const order = prepared
    .map((_, i) => i)
    .sort((a, b) => prepared[b].h - prepared[a].h)

  // Binary search the largest scale whose shelf packing fits height ≤ 1.
  let lo = 0
  let hi = 1 / Math.max(...prepared.map((p) => Math.max(p.w, p.h)))
  hi *= 4
  for (let it = 0; it < 48; it++) {
    const mid = (lo + hi) / 2
    const { height } = shelf(prepared, order, mid, margin)
    const widthOk = prepared.every((p) => p.w * mid + 2 * margin <= 1)
    if (height <= 1 && widthOk) lo = mid
    else hi = mid
  }
  const scale = lo
  const { pos } = shelf(prepared, order, scale, margin)

  let boxArea = 0
  const uv = prepared.map((p, i) => {
    const out = new Float32Array(p.uv.length)
    const [ox, oy] = pos[i]
    for (let k = 0; k < p.uv.length; k += 2) {
      out[k] = p.uv[k] * scale + ox
      out[k + 1] = p.uv[k + 1] * scale + oy
    }
    boxArea += p.w * scale * (p.h * scale)
    return out
  })

  return { uv, fill: boxArea }
}
