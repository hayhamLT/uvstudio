// ---------------------------------------------------------------------------
// Texture-stretch / distortion metrics (Sander et al. 2001 singular values).
// Produces a per-vertex 0..1 distortion field for color-coded display and an
// overall RMS figure for the status bar.
// ---------------------------------------------------------------------------

export interface Distortion {
  perVertex: Float32Array // 0 = perfect, 1 = badly distorted
  overall: number // 0..1 RMS
  flippedTris: number
}

export function computeDistortion(
  positions: Float32Array, // 3D, 3 per vertex
  uv: Float32Array, // 2 per vertex
  triangles: Uint32Array,
  aspect = 1, // texture width/height — U is judged in PIXEL space, not raw UV
): Distortion {
  // Measure stretch in the texture's pixel space: a proportional mapping onto a
  // non-square (e.g. panorama) texture must read as ZERO distortion, so scale U
  // by the texture aspect before comparing UV triangles to their 3D shapes.
  if (aspect > 0 && isFinite(aspect) && Math.abs(aspect - 1) > 1e-6) {
    const scaled = new Float32Array(uv.length)
    for (let i = 0; i < uv.length; i += 2) {
      scaled[i] = uv[i] * aspect
      scaled[i + 1] = uv[i + 1]
    }
    uv = scaled
  }
  const vc = positions.length / 3
  const perVertex = new Float32Array(vc)
  const counts = new Float32Array(vc)
  const triCount = triangles.length / 3

  // Global area scale (Σ 3D area / Σ uv area) to judge relative scale.
  let area3DSum = 0
  let areaUVSum = 0
  const tri3D = new Float64Array(triCount)
  const triUV = new Float64Array(triCount)
  for (let t = 0; t < triCount; t++) {
    const i = triangles[t * 3],
      j = triangles[t * 3 + 1],
      k = triangles[t * 3 + 2]
    const a3 = triArea3D(positions, i, j, k)
    const aUV = triAreaUVsigned(uv, i, j, k)
    tri3D[t] = a3
    triUV[t] = aUV
    area3DSum += a3
    areaUVSum += Math.abs(aUV)
  }
  const globalScale = areaUVSum > 1e-12 ? area3DSum / areaUVSum : 1

  let flipped = 0
  let sumSq = 0
  for (let t = 0; t < triCount; t++) {
    const i = triangles[t * 3],
      j = triangles[t * 3 + 1],
      k = triangles[t * 3 + 2]
    const sv = singularValues(positions, uv, i, j, k)
    let d: number
    if (triUV[t] <= 0) {
      d = 1 // flipped or degenerate
      flipped++
    } else {
      const r = sv.max / Math.max(sv.min, 1e-9)
      const conf = 1 - 2 / (r + 1 / r) // shear/angle distortion, 0..1
      const scaleRatio = (sv.max * sv.min) / Math.max(globalScale, 1e-9)
      const areaD = 1 - Math.exp(-Math.abs(Math.log(Math.max(scaleRatio, 1e-6))))
      d = Math.min(1, Math.max(conf, areaD * 0.75))
    }
    sumSq += d * d
    for (const v of [i, j, k]) {
      perVertex[v] += d
      counts[v] += 1
    }
  }
  for (let v = 0; v < vc; v++) if (counts[v] > 0) perVertex[v] /= counts[v]

  return {
    perVertex,
    overall: triCount ? Math.sqrt(sumSq / triCount) : 0,
    flippedTris: flipped,
  }
}

function triArea3D(p: Float32Array, i: number, j: number, k: number): number {
  const ax = p[j * 3] - p[i * 3],
    ay = p[j * 3 + 1] - p[i * 3 + 1],
    az = p[j * 3 + 2] - p[i * 3 + 2]
  const bx = p[k * 3] - p[i * 3],
    by = p[k * 3 + 1] - p[i * 3 + 1],
    bz = p[k * 3 + 2] - p[i * 3 + 2]
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  return 0.5 * Math.hypot(cx, cy, cz)
}

function triAreaUVsigned(uv: Float32Array, i: number, j: number, k: number): number {
  const ax = uv[j * 2] - uv[i * 2],
    ay = uv[j * 2 + 1] - uv[i * 2 + 1]
  const bx = uv[k * 2] - uv[i * 2],
    by = uv[k * 2 + 1] - uv[i * 2 + 1]
  return 0.5 * (ax * by - ay * bx)
}

function singularValues(
  p: Float32Array,
  uv: Float32Array,
  i: number,
  j: number,
  k: number,
): { max: number; min: number } {
  const s1 = uv[i * 2],
    t1 = uv[i * 2 + 1]
  const s2 = uv[j * 2],
    t2 = uv[j * 2 + 1]
  const s3 = uv[k * 2],
    t3 = uv[k * 2 + 1]
  const A = (s2 - s1) * (t3 - t1) - (s3 - s1) * (t2 - t1)
  const denom = A || 1e-12
  // Ps and Pt are 3D vectors (∂3D/∂u, ∂3D/∂v)
  const Ps = [0, 0, 0]
  const Pt = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const q1 = p[i * 3 + c],
      q2 = p[j * 3 + c],
      q3 = p[k * 3 + c]
    Ps[c] = (q1 * (t2 - t3) + q2 * (t3 - t1) + q3 * (t1 - t2)) / denom
    Pt[c] = (q1 * (s3 - s2) + q2 * (s1 - s3) + q3 * (s2 - s1)) / denom
  }
  const a = Ps[0] * Ps[0] + Ps[1] * Ps[1] + Ps[2] * Ps[2]
  const b = Ps[0] * Pt[0] + Ps[1] * Pt[1] + Ps[2] * Pt[2]
  const c2 = Pt[0] * Pt[0] + Pt[1] * Pt[1] + Pt[2] * Pt[2]
  const disc = Math.sqrt(Math.max((a - c2) * (a - c2) + 4 * b * b, 0))
  const max = Math.sqrt(Math.max(0.5 * (a + c2 + disc), 0))
  const min = Math.sqrt(Math.max(0.5 * (a + c2 - disc), 0))
  return { max, min }
}
