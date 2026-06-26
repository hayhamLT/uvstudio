// ---------------------------------------------------------------------------
// Per-shell UV parameterization.
//
//   1. LSCM (Least-Squares Conformal Maps) gives a fast, low-angle-distortion
//      initial flatten.
//   2. ARAP (As-Rigid-As-Possible, local/global) relaxes it toward an
//      isometric (low area + angle distortion) layout. Each ARAP iteration is
//      one "frame" of UVLayout's signature relax animation.
// ---------------------------------------------------------------------------
import type { Shell } from '../mesh/types'
import { COO, cgls, cgSPD } from './solve'

/** Precomputed per-triangle data shared by LSCM and ARAP. */
export interface ParamContext {
  shell: Shell
  triCount: number
  /** isometric local 2D coords per triangle: [x0,y0,x1,y1,x2,y2] × triCount */
  local: Float64Array
  /** cotan edge weights per triangle: [w01, w12, w20] × triCount */
  weights: Float64Array
  /** vertex index of the pinned vertex (fixed at origin for ARAP) */
  pin: number
  /** free-vertex remap: origIndex -> freeIndex (or -1 if pinned) */
  freeOf: Int32Array
  freeCount: number
  /** assembled, pinned cotan Laplacian over free vertices */
  L: COO
}

function flattenTriangle(
  px: Float64Array,
  i: number,
  j: number,
  k: number,
): [number, number, number, number, number, number, number] {
  const ax = px[i * 3],
    ay = px[i * 3 + 1],
    az = px[i * 3 + 2]
  const bx = px[j * 3],
    by = px[j * 3 + 1],
    bz = px[j * 3 + 2]
  const cx = px[k * 3],
    cy = px[k * 3 + 1],
    cz = px[k * 3 + 2]
  let e1x = bx - ax,
    e1y = by - ay,
    e1z = bz - az
  const len = Math.hypot(e1x, e1y, e1z) || 1e-9
  e1x /= len
  e1y /= len
  e1z /= len
  const vx = cx - ax,
    vy = cy - ay,
    vz = cz - az
  const projX = vx * e1x + vy * e1y + vz * e1z
  // perpendicular component length via cross product magnitude
  const crX = e1y * vz - e1z * vy
  const crY = e1z * vx - e1x * vz
  const crZ = e1x * vy - e1y * vx
  const projY = Math.hypot(crX, crY, crZ)
  const area = 0.5 * len * projY
  // local coords: a=(0,0) b=(len,0) c=(projX,projY)
  return [0, 0, len, 0, projX, projY, area]
}

export function buildParamContext(shell: Shell): ParamContext {
  const tc = shell.triCount
  const tris = shell.triangles
  const px = Float64Array.from(shell.positions)
  const local = new Float64Array(tc * 6)
  const weights = new Float64Array(tc * 3)

  for (let t = 0; t < tc; t++) {
    const i = tris[t * 3],
      j = tris[t * 3 + 1],
      k = tris[t * 3 + 2]
    const [x0, y0, x1, y1, x2, y2, area] = flattenTriangle(px, i, j, k)
    const o = t * 6
    local[o] = x0
    local[o + 1] = y0
    local[o + 2] = x1
    local[o + 3] = y1
    local[o + 4] = x2
    local[o + 5] = y2
    const a2 = Math.max(area, 1e-9) * 2
    // cotangent at a vertex = dot(otherTwoEdges) / (2*area); weight = 0.5*cot
    const cot = (ux: number, uy: number, vx: number, vy: number) =>
      (ux * vx + uy * vy) / a2
    // edge (0,1) opposite vertex 2; edge (1,2) opp 0; edge (2,0) opp 1.
    // Clamp to a small positive value: obtuse triangles give negative
    // cotangents that can make the ARAP Laplacian indefinite and stall CG.
    const EPS = 1e-4
    weights[t * 3] = Math.max(0.5 * cot(x0 - x2, y0 - y2, x1 - x2, y1 - y2), EPS)
    weights[t * 3 + 1] = Math.max(0.5 * cot(x1 - x0, y1 - y0, x2 - x0, y2 - y0), EPS)
    weights[t * 3 + 2] = Math.max(0.5 * cot(x2 - x1, y2 - y1, x0 - x1, y0 - y1), EPS)
  }

  // Pin vertex 0 (fixed at origin) to remove the translation DOF for ARAP.
  const pin = 0
  const vc = shell.vertCount
  const freeOf = new Int32Array(vc).fill(-1)
  let fc = 0
  for (let v = 0; v < vc; v++) if (v !== pin) freeOf[v] = fc++

  // Assemble the pinned cotan Laplacian over free vertices.
  const L = new COO(fc, fc)
  const triEdges: [number, number, number][] = [
    [0, 1, 0],
    [1, 2, 1],
    [2, 0, 2],
  ]
  for (let t = 0; t < tc; t++) {
    for (const [a, b, wslot] of triEdges) {
      const vi = tris[t * 3 + a]
      const vj = tris[t * 3 + b]
      const w = weights[t * 3 + wslot]
      const fi = freeOf[vi]
      const fj = freeOf[vj]
      if (fi >= 0) L.add(fi, fi, w)
      if (fj >= 0) L.add(fj, fj, w)
      if (fi >= 0 && fj >= 0) {
        L.add(fi, fj, -w)
        L.add(fj, fi, -w)
      }
    }
  }

  return { shell, triCount: tc, local, weights, pin, freeOf, freeCount: fc, L }
}

/**
 * LSCM initial flatten. Pins two well-separated vertices and solves the
 * conformal least-squares system. Returns interleaved uv (length 2*vertCount).
 */
export function lscm(ctx: ParamContext): Float64Array {
  const { shell, triCount, local } = ctx
  const vc = shell.vertCount
  const tris = shell.triangles

  // Choose two pins: vertex 0 and the farthest vertex from it in 3D.
  const px = shell.positions
  const p0 = 0
  let p1 = 1 % vc
  let best = -1
  for (let v = 1; v < vc; v++) {
    const dx = px[v * 3] - px[0]
    const dy = px[v * 3 + 1] - px[1]
    const dz = px[v * 3 + 2] - px[2]
    const d = dx * dx + dy * dy + dz * dz
    if (d > best) {
      best = d
      p1 = v
    }
  }
  const pinDist = Math.sqrt(Math.max(best, 1e-12))
  const pinned = new Map<number, [number, number]>()
  pinned.set(p0, [0, 0])
  pinned.set(p1, [pinDist, 0])

  // Unknown layout: free vertices get 2 columns (u, v).
  const colOf = new Int32Array(vc).fill(-1)
  let nFree = 0
  for (let v = 0; v < vc; v++) if (!pinned.has(v)) colOf[v] = nFree++
  const nCols = nFree * 2
  const A = new COO(triCount * 2, nCols)
  const b = new Float64Array(triCount * 2)

  for (let t = 0; t < triCount; t++) {
    const o = t * 6
    // Local coords -> W_j complex coefficients (Lévy LSCM).
    const x = [local[o], local[o + 2], local[o + 4]]
    const y = [local[o + 1], local[o + 3], local[o + 5]]
    const dT =
      x[0] * (y[1] - y[2]) + x[1] * (y[2] - y[0]) + x[2] * (y[0] - y[1])
    const s = 1 / Math.sqrt(Math.max(Math.abs(dT), 1e-12))
    // W_0 = (x2-x1)+i(y2-y1), W_1=(x0-x2)+i(y0-y2), W_2=(x1-x0)+i(y1-y0)
    const Wx = [x[2] - x[1], x[0] - x[2], x[1] - x[0]]
    const Wy = [y[2] - y[1], y[0] - y[2], y[1] - y[0]]
    const rRe = t * 2
    const rIm = t * 2 + 1
    const verts = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]]
    for (let j = 0; j < 3; j++) {
      const a = Wx[j] * s
      const bb = Wy[j] * s
      const v = verts[j]
      if (pinned.has(v)) {
        const [pu, pv] = pinned.get(v)!
        // move known terms to RHS (equation sums to 0)
        b[rRe] -= a * pu - bb * pv
        b[rIm] -= bb * pu + a * pv
      } else {
        const cu = colOf[v] * 2
        const cv = cu + 1
        // Real: a*u - bb*v ; Imag: bb*u + a*v
        A.add(rRe, cu, a)
        A.add(rRe, cv, -bb)
        A.add(rIm, cu, bb)
        A.add(rIm, cv, a)
      }
    }
  }

  const sol = cgls(A, b, 600, 1e-8)
  const uv = new Float64Array(vc * 2)
  for (const [v, [pu, pv]] of pinned) {
    uv[v * 2] = pu
    uv[v * 2 + 1] = pv
  }
  for (let v = 0; v < vc; v++) {
    if (colOf[v] >= 0) {
      uv[v * 2] = sol[colOf[v] * 2]
      uv[v * 2 + 1] = sol[colOf[v] * 2 + 1]
    }
  }

  // LSCM is free to return a mirrored solution; flip it so the atlas keeps the
  // mesh's orientation (otherwise every triangle reads as "flipped").
  let signed = 0
  for (let t = 0; t < triCount; t++) {
    const a = tris[t * 3],
      b = tris[t * 3 + 1],
      c = tris[t * 3 + 2]
    const ux = uv[b * 2] - uv[a * 2]
    const uy = uv[b * 2 + 1] - uv[a * 2 + 1]
    const vx = uv[c * 2] - uv[a * 2]
    const vy = uv[c * 2 + 1] - uv[a * 2 + 1]
    signed += ux * vy - uy * vx
  }
  if (signed < 0) for (let v = 0; v < vc; v++) uv[v * 2] = -uv[v * 2]

  return uv
}

/**
 * One ARAP local/global iteration. Mutates `uv` in place (interleaved,
 * length 2*vertCount) and returns it. `scratch` solutions are warm-started.
 */
export function arapIterate(ctx: ParamContext, uv: Float64Array): Float64Array {
  const { shell, triCount, local, weights, freeOf, freeCount, L, pin } = ctx
  const tris = shell.triangles
  const bu = new Float64Array(freeCount)
  const bv = new Float64Array(freeCount)

  const triEdges: [number, number, number][] = [
    [0, 1, 0],
    [1, 2, 1],
    [2, 0, 2],
  ]

  for (let t = 0; t < triCount; t++) {
    const o = t * 6
    const lx = [local[o], local[o + 2], local[o + 4]]
    const ly = [local[o + 1], local[o + 3], local[o + 5]]
    const vi = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]]

    // Local step: best-fit rotation from ideal edges to current uv edges.
    // C = Σ w · u_edge · x_edgeᵀ ; optimal θ = atan2(C10 - C01, C00 + C11)
    let c00 = 0,
      c01 = 0,
      c10 = 0,
      c11 = 0
    for (const [a, bb, wslot] of triEdges) {
      const w = weights[t * 3 + wslot]
      const ex = lx[a] - lx[bb]
      const ey = ly[a] - ly[bb]
      const ua = uv[vi[a] * 2] - uv[vi[bb] * 2]
      const va = uv[vi[a] * 2 + 1] - uv[vi[bb] * 2 + 1]
      c00 += w * ua * ex
      c01 += w * ua * ey
      c10 += w * va * ex
      c11 += w * va * ey
    }
    const theta = Math.atan2(c10 - c01, c00 + c11)
    const ct = Math.cos(theta)
    const st = Math.sin(theta)

    // Global step RHS: Σ w · R · (x_i - x_j)
    for (const [a, bb, wslot] of triEdges) {
      const w = weights[t * 3 + wslot]
      const ex = lx[a] - lx[bb]
      const ey = ly[a] - ly[bb]
      const rx = ct * ex - st * ey
      const ry = st * ex + ct * ey
      const fa = freeOf[vi[a]]
      const fb = freeOf[vi[bb]]
      if (fa >= 0) {
        bu[fa] += w * rx
        bv[fa] += w * ry
      }
      if (fb >= 0) {
        bu[fb] -= w * rx
        bv[fb] -= w * ry
      }
    }
  }

  // Warm-start solves from current uv (minus pin).
  const x0u = new Float64Array(freeCount)
  const x0v = new Float64Array(freeCount)
  for (let v = 0; v < shell.vertCount; v++) {
    const f = freeOf[v]
    if (f >= 0) {
      x0u[f] = uv[v * 2]
      x0v[f] = uv[v * 2 + 1]
    }
  }
  const su = cgSPD(L, bu, x0u, 200, 1e-8)
  const sv = cgSPD(L, bv, x0v, 200, 1e-8)

  uv[pin * 2] = 0
  uv[pin * 2 + 1] = 0
  for (let v = 0; v < shell.vertCount; v++) {
    const f = freeOf[v]
    if (f >= 0) {
      uv[v * 2] = su[f]
      uv[v * 2 + 1] = sv[f]
    }
  }
  return uv
}
