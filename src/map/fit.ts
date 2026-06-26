import type { HEMesh, Shell } from '../mesh/types'
import { extractShells } from '../mesh/shells'
import { buildParamContext, lscm, arapIterate } from '../unwrap/param'
import { packIslands } from '../unwrap/pack'

// ---------------------------------------------------------------------------
// Map a screen object's UVs precisely onto a region of the atlas.
//
//  - Flat screens use an EXACT planar projection (no relaxation = no wobble),
//    so a multi-polygon panel keeps a perfectly regular, undistorted grid.
//  - Curved screens are unrolled (LSCM/ARAP) then oriented.
//  - Orientation is locked to world-up so screens are never sideways / upside
//    down. Per-object 90° rotation + flip overrides stack on top.
//  - The fit is uniform-scale (aspect preserving) so nothing is squished;
//    set `fill` to stretch edge-to-edge instead.
// ---------------------------------------------------------------------------

export interface RectUV {
  u0: number
  v0: number
  u1: number
  v1: number
}

export interface FitResult {
  shells: Shell[]
  uv: Float32Array[]
  /** aspect (w/h) of the oriented screen before fitting — for stretch warnings */
  srcAspect: number
}

/** How to unwrap a screen: auto (planar if flat, else relaxed unroll), or a
 *  forced projection like the standard ones in other UV tools. */
export type Projection = 'auto' | 'planar' | 'cylindrical' | 'spherical'

export interface FitOpts {
  rot?: number // extra 0|90|180|270 applied after auto-orient
  flipX?: boolean // mirror horizontally
  flipY?: boolean // mirror vertically
  relaxIters?: number
  margin?: number
  fill?: boolean // stretch to fill the rect (default: preserve aspect)
  planarTol?: number
  projection?: Projection
}

const WORLD_UP: [number, number, number] = [0, 1, 0]
const WORLD_ALT: [number, number, number] = [0, 0, 1]

function centroid(p: Float32Array): [number, number, number] {
  let x = 0,
    y = 0,
    z = 0
  const n = p.length / 3
  for (let i = 0; i < p.length; i += 3) {
    x += p[i]
    y += p[i + 1]
    z += p[i + 2]
  }
  return [x / n, y / n, z / n]
}

/** Area-weighted (Newell) face normal for the whole object — front-facing. */
function meshNormal(pos: Float32Array, faces: number[][]): [number, number, number] {
  let nx = 0,
    ny = 0,
    nz = 0
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const ax = pos[a * 3],
        ay = pos[a * 3 + 1],
        az = pos[a * 3 + 2]
      const bx = pos[b * 3],
        by = pos[b * 3 + 1],
        bz = pos[b * 3 + 2]
      nx += (ay - by) * (az + bz)
      ny += (az - bz) * (ax + bx)
      nz += (ax - bx) * (ay + by)
    }
  }
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

function dot3(a: number[], b: number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross3(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function norm3(a: [number, number, number]): [number, number, number] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** A right/up basis on the screen plane, with up aligned to world up. */
function planeBasis(n: [number, number, number]): {
  right: [number, number, number]
  up: [number, number, number]
} {
  const ref = Math.abs(dot3(n, WORLD_UP)) > 0.95 ? WORLD_ALT : WORLD_UP
  const up = norm3([
    ref[0] - n[0] * dot3(ref, n),
    ref[1] - n[1] * dot3(ref, n),
    ref[2] - n[2] * dot3(ref, n),
  ])
  // right = up × n  → looking at the front (from +n), +right is viewer-right
  const right = norm3(cross3(up, n))
  return { right, up }
}

function maxPlaneDeviation(
  pos: Float32Array,
  n: [number, number, number],
  c: [number, number, number],
): number {
  let maxDev = 0
  let diag = 0
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    const dx = pos[i] - c[0],
      dy = pos[i + 1] - c[1],
      dz = pos[i + 2] - c[2]
    maxDev = Math.max(maxDev, Math.abs(dx * n[0] + dy * n[1] + dz * n[2]))
    minX = Math.min(minX, pos[i])
    maxX = Math.max(maxX, pos[i])
    minY = Math.min(minY, pos[i + 1])
    maxY = Math.max(maxY, pos[i + 1])
    minZ = Math.min(minZ, pos[i + 2])
    maxZ = Math.max(maxZ, pos[i + 2])
  }
  diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1
  return maxDev / diag
}

/** Max out-of-plane deviation of a mesh, normalised by its bbox diagonal — 0 for
 *  a perfectly flat panel, growing with curvature/thickness. Used to tell flat
 *  LED screens apart from structural geometry. */
export function planeDeviation(positions: Float32Array, faces: number[][]): number {
  const c = centroid(positions)
  const n = meshNormal(positions, faces)
  return maxPlaneDeviation(positions, n, c)
}

function projectWithBasis(
  pos: Float32Array,
  c: [number, number, number],
  right: [number, number, number],
  up: [number, number, number],
): Float32Array {
  const out = new Float32Array((pos.length / 3) * 2)
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) {
    const dx = pos[i] - c[0],
      dy = pos[i + 1] - c[1],
      dz = pos[i + 2] - c[2]
    out[j] = dx * right[0] + dy * right[1] + dz * right[2]
    out[j + 1] = dx * up[0] + dy * up[1] + dz * up[2]
  }
  return out
}

/** Unroll points around an axis (default world-up): u = arc length (radius·angle),
 *  v = height along the axis. The branch cut is placed in the widest angular gap,
 *  so partial arcs (curved walls) don't tear; a full cylinder seams at the back. */
function projectCylindrical(pos: Float32Array, c: [number, number, number]): Float32Array {
  const up = WORLD_UP
  const right = norm3(cross3(up, WORLD_ALT))
  const fwd = norm3(cross3(up, right))
  const n = pos.length / 3
  const ang = new Float32Array(n)
  const hgt = new Float32Array(n)
  let rsum = 0
  for (let i = 0, j = 0; i < pos.length; i += 3, j++) {
    const dx = pos[i] - c[0],
      dy = pos[i + 1] - c[1],
      dz = pos[i + 2] - c[2]
    hgt[j] = dx * up[0] + dy * up[1] + dz * up[2]
    const x = dx * right[0] + dy * right[1] + dz * right[2]
    const z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2]
    ang[j] = Math.atan2(z, x)
    rsum += Math.hypot(x, z)
  }
  const radius = rsum / Math.max(n, 1) || 1
  const sorted = Float32Array.from(ang).sort()
  const TAU = Math.PI * 2
  let maxGap = sorted[0] + TAU - sorted[n - 1]
  let cut = (sorted[n - 1] + sorted[0] + TAU) / 2
  for (let i = 1; i < n; i++) {
    const g = sorted[i] - sorted[i - 1]
    if (g > maxGap) {
      maxGap = g
      cut = (sorted[i] + sorted[i - 1]) / 2
    }
  }
  const out = new Float32Array(n * 2)
  for (let j = 0; j < n; j++) {
    let a = (((ang[j] - cut) % TAU) + TAU) % TAU
    out[j * 2] = a * radius // arc length → matches v's world units
    out[j * 2 + 1] = hgt[j]
  }
  return out
}

/** Sphere-unwrap: u = azimuth·R, v = elevation·R (R = mean radius). For domes. */
function projectSpherical(pos: Float32Array, c: [number, number, number]): Float32Array {
  const up = WORLD_UP
  const right = norm3(cross3(up, WORLD_ALT))
  const fwd = norm3(cross3(up, right))
  const n = pos.length / 3
  const az = new Float32Array(n)
  const el = new Float32Array(n)
  let rsum = 0
  for (let i = 0, j = 0; i < pos.length; i += 3, j++) {
    const dx = pos[i] - c[0],
      dy = pos[i + 1] - c[1],
      dz = pos[i + 2] - c[2]
    const x = dx * right[0] + dy * right[1] + dz * right[2]
    const y = dx * up[0] + dy * up[1] + dz * up[2]
    const z = dx * fwd[0] + dy * fwd[1] + dz * fwd[2]
    const r = Math.hypot(x, y, z) || 1
    az[j] = Math.atan2(z, x)
    el[j] = Math.asin(Math.max(-1, Math.min(1, y / r)))
    rsum += r
  }
  const radius = rsum / Math.max(n, 1) || 1
  const sorted = Float32Array.from(az).sort()
  const TAU = Math.PI * 2
  let maxGap = sorted[0] + TAU - sorted[n - 1]
  let cut = (sorted[n - 1] + sorted[0] + TAU) / 2
  for (let i = 1; i < n; i++) {
    const g = sorted[i] - sorted[i - 1]
    if (g > maxGap) {
      maxGap = g
      cut = (sorted[i] + sorted[i - 1]) / 2
    }
  }
  const out = new Float32Array(n * 2)
  for (let j = 0; j < n; j++) {
    out[j * 2] = ((((az[j] - cut) % TAU) + TAU) % TAU) * radius
    out[j * 2 + 1] = el[j] * radius
  }
  return out
}

/** Split the wrap seam of a projected (cylindrical/spherical) shell: triangles
 *  that bridge the branch cut span the whole U; duplicate their low-U vertices
 *  and lift them by one period so each triangle stays contiguous. Closed loops
 *  then unwrap with NO smeared "bridge" polygons. No-op for open arcs. */
function splitSeam(shell: Shell, uv: Float32Array): { shell: Shell; uv: Float32Array } {
  const tris = shell.triangles
  let u0 = Infinity,
    u1 = -Infinity
  for (let i = 0; i < uv.length; i += 2) {
    if (uv[i] < u0) u0 = uv[i]
    if (uv[i] > u1) u1 = uv[i]
  }
  const range = u1 - u0
  if (range <= 1e-6) return { shell, uv }
  const half = u0 + range / 2
  const dup = new Map<number, number>()
  const pos = Array.from(shell.positions)
  const orig = Array.from(shell.toOrigVertex)
  const nuv = Array.from(uv)
  const newTris = Uint32Array.from(tris)
  let vc = shell.vertCount
  for (let t = 0; t < tris.length; t += 3) {
    const idx = [tris[t], tris[t + 1], tris[t + 2]]
    const us = [uv[idx[0] * 2], uv[idx[1] * 2], uv[idx[2] * 2]]
    if (Math.max(...us) - Math.min(...us) <= range / 2) continue // not a bridge triangle
    for (let k = 0; k < 3; k++) {
      const vi = idx[k]
      if (uv[vi * 2] < half) {
        let d = dup.get(vi)
        if (d === undefined) {
          d = vc++
          dup.set(vi, d)
          pos.push(shell.positions[vi * 3], shell.positions[vi * 3 + 1], shell.positions[vi * 3 + 2])
          orig.push(shell.toOrigVertex[vi])
          nuv.push(uv[vi * 2] + range, uv[vi * 2 + 1])
        }
        newTris[t + k] = d
      }
    }
  }
  if (vc === shell.vertCount) return { shell, uv }
  // Rebuild polygon loops from the (remapped) fan triangles so shell.polygons
  // stays consistent with the split topology — the per-corner UV export reads
  // these loops, so a stale loop would send pre-split (wrong) UVs at the seam.
  // Triangles are fan-ordered per face: poly [l0..l(D-1)] -> tris [l0,l1,l2],
  // [l0,l2,l3]... so loop = tri0[0],tri0[1],tri0[2], then each next tri's 3rd.
  const newPolys: number[][] = []
  let ti = 0
  for (const oldLoop of shell.polygons) {
    const nt = oldLoop.length - 2 // fan triangles for this face
    if (nt < 1) {
      newPolys.push(oldLoop.slice())
      continue
    }
    const loop = [newTris[ti * 3], newTris[ti * 3 + 1], newTris[ti * 3 + 2]]
    for (let j = 1; j < nt; j++) loop.push(newTris[(ti + j) * 3 + 2])
    newPolys.push(loop)
    ti += nt
  }
  return {
    shell: {
      ...shell,
      positions: Float32Array.from(pos),
      toOrigVertex: Int32Array.from(orig),
      triangles: newTris,
      polygons: newPolys,
      vertCount: vc,
    },
    uv: Float32Array.from(nuv),
  }
}

function flattenShell(shell: Shell, iters: number): Float32Array {
  const ctx = buildParamContext(shell)
  const uv = lscm(ctx)
  for (let i = 0; i < iters; i++) arapIterate(ctx, uv)
  return Float32Array.from(uv)
}

function rotateUV(uv: Float32Array, ang: number): Float32Array {
  const c = Math.cos(ang),
    s = Math.sin(ang)
  const out = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    out[i] = c * uv[i] - s * uv[i + 1]
    out[i + 1] = s * uv[i] + c * uv[i + 1]
  }
  return out
}

/** Rotate a flattened (curved) shell so its world-up direction points +v. */
function orientFlatToWorld(pos: Float32Array, uv: Float32Array): Float32Array {
  const n = uv.length / 2
  // centered u, v, and world height h
  let mu = 0,
    mv = 0,
    mh = 0
  const h = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    mu += uv[i * 2]
    mv += uv[i * 2 + 1]
    h[i] = pos[i * 3 + 1] // world Y
    mh += h[i]
  }
  mu /= n
  mv /= n
  mh /= n
  let Suu = 0,
    Suv = 0,
    Svv = 0,
    Suh = 0,
    Svh = 0
  for (let i = 0; i < n; i++) {
    const u = uv[i * 2] - mu
    const v = uv[i * 2 + 1] - mv
    const hh = h[i] - mh
    Suu += u * u
    Suv += u * v
    Svv += v * v
    Suh += u * hh
    Svh += v * hh
  }
  const det = Suu * Svv - Suv * Suv
  if (Math.abs(det) < 1e-9) return uv // no height signal (horizontal screen)
  const a = (Svv * Suh - Suv * Svh) / det
  const b = (Suu * Svh - Suv * Suh) / det
  if (Math.hypot(a, b) < 1e-9) return uv
  const phi = Math.atan2(b, a) // direction of increasing height in uv
  return rotateUV(uv, Math.PI / 2 - phi) // rotate that direction to +v
}

function orient(uv: Float32Array, rot: number, flipX: boolean, flipY: boolean): Float32Array {
  const steps = ((rot % 360) + 360) % 360
  const out = new Float32Array(uv.length)
  for (let i = 0; i < uv.length; i += 2) {
    let x = uv[i],
      y = uv[i + 1]
    if (flipX) x = -x
    if (flipY) y = -y
    if (steps === 90) [x, y] = [-y, x]
    else if (steps === 180) [x, y] = [-x, -y]
    else if (steps === 270) [x, y] = [y, -x]
    out[i] = x
    out[i + 1] = y
  }
  return out
}

function bbox(arrays: Float32Array[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const a of arrays)
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < minX) minX = a[i]
      if (a[i] > maxX) maxX = a[i]
      if (a[i + 1] < minY) minY = a[i + 1]
      if (a[i + 1] > maxY) maxY = a[i + 1]
    }
  return { minX, minY, maxX, maxY, w: maxX - minX || 1e-6, h: maxY - minY || 1e-6 }
}

export function flattenAndFit(he: HEMesh, rect: RectUV, opts: FitOpts = {}): FitResult {
  const iters = opts.relaxIters ?? 24
  const margin = opts.margin ?? 0
  const planarTol = opts.planarTol ?? 2e-3

  let shells = extractShells(he).shells
  const c = centroid(he.mesh.positions)
  const n = meshNormal(he.mesh.positions, he.mesh.faces)
  const planar = maxPlaneDeviation(he.mesh.positions, n, c) < planarTol
  const proj = opts.projection ?? 'auto'

  const packMulti = (flat: Float32Array[]) =>
    flat.length > 1 ? packIslands(flat.map((uv) => ({ uv })), { margin: 0.01, angleSteps: 1 }).uv : flat

  let flat: Float32Array[]
  if (proj === 'cylindrical' || proj === 'spherical') {
    // project, then split the wrap seam so closed loops have no bridge polygons
    const projFn = proj === 'cylindrical' ? projectCylindrical : projectSpherical
    const split = shells.map((s) => splitSeam(s, projFn(s.positions, c)))
    shells = split.map((x) => x.shell)
    flat = packMulti(split.map((x) => x.uv))
  } else if (proj === 'planar' || (proj === 'auto' && planar)) {
    // Exact, shared-basis projection: precise + relative layout preserved.
    const { right, up } = planeBasis(n)
    flat = shells.map((s) => projectWithBasis(s.positions, c, right, up))
  } else {
    // Auto + curved: relax-unroll, then orient each piece to world up.
    flat = packMulti(shells.map((s) => orientFlatToWorld(s.positions, flattenShell(s, iters))))
  }

  // user override
  flat = flat.map((uv) => orient(uv, opts.rot ?? 0, opts.flipX ?? false, opts.flipY ?? false))

  // fit
  const b = bbox(flat)
  const u0 = rect.u0 + margin,
    v0 = rect.v0 + margin
  const u1 = rect.u1 - margin,
    v1 = rect.v1 - margin
  const availW = u1 - u0,
    availH = v1 - v0

  let sx: number, sy: number, offU: number, offV: number
  if (opts.fill) {
    sx = availW / b.w
    sy = availH / b.h
    offU = u0
    offV = v0
  } else {
    const s = Math.min(availW / b.w, availH / b.h) // uniform, preserve aspect
    sx = sy = s
    offU = u0 + (availW - b.w * s) / 2
    offV = v0 + (availH - b.h * s) / 2
  }

  const uv = flat.map((src) => {
    const out = new Float32Array(src.length)
    for (let i = 0; i < src.length; i += 2) {
      out[i] = offU + (src[i] - b.minX) * sx
      out[i + 1] = offV + (src[i + 1] - b.minY) * sy
    }
    return out
  })

  return { shells, uv, srcAspect: b.w / b.h }
}
