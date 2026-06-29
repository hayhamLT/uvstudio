import type { Shell, SceneObject } from '../mesh/types'

// ---------------------------------------------------------------------------
// Lossless C4D <-> UV Studio round-trip payloads.
//
// The bridge does NOT round-trip geometry. The DCC's original objects stay put;
// only UV coordinates flow back, applied to the existing per-polygon UVW tags.
//
//  FORWARD  (C4D -> app):  the plugin writes to_app/scene.json (this sidecar)
//    alongside scene.glb. The app builds each object's mesh DIRECTLY from the
//    sidecar's points + polys, so app vertex i === C4D point i and app face i ===
//    C4D polygon i (provenance is identity — no welding/position-matching, and
//    quads survive). scene.glb is used only for the texture (by name) + as a
//    manual-import fallback.
//
//  RETURN   (app -> C4D):  the app writes to_c4d/scene.json (ReturnPayload) — UV
//    only, one row per ORIGINAL C4D polygon, UVs per corner. C4D UVW tags are
//    per-polygon-corner, so a UV seam needs ZERO extra points: weld/reorder and
//    the app's seam-split become irrelevant. The plugin SetSlow()s these onto the
//    existing object's UVW tag; geometry / normals / materials / hierarchy /
//    extra UV sets are preserved by construction.
// ---------------------------------------------------------------------------

export const ROUNDTRIP_V = 2

/** FORWARD: per-object geometry the plugin hands the app (world-space). */
export interface ForwardObject {
  name: string
  /** stable id stamped on the C4D object so the plugin can re-find it exactly */
  guid: string
  /** xyz per point, world space, length = 3 * pointCount */
  points: number[]
  /** each polygon's C4D point indices — length 3 (tri) or 4 (quad) */
  polys: number[][]
  /** OPTIONAL existing UVs from the object's UVW tag, per polygon: a flat
   *  [u,v, u,v, …] of the polygon's corners (already V-flipped to the app's
   *  space). Lets the app show the object's current UVs on import. */
  uv?: number[][]
}
export interface ForwardSidecar {
  v: number
  ts: number
  kind: 'geo-forward'
  objects: ForwardObject[]
}

/** RETURN: UVs only, addressed by (polygon, corner). */
export interface ReturnObject {
  name: string
  guid: string
  /** MUST equal the live C4D object's polygon count */
  polyCount: number
  /** app stores UVs V-up (OpenGL); the plugin writes 1-v to land upright in C4D */
  vFlip: boolean
  /**
   * One entry per ORIGINAL C4D polygon index. Each is 8 floats — corners
   * a,b,c,d as (u,v). A triangle repeats its 3rd corner into d. A polygon the
   * app didn't map is left null/undefined (plugin skips it).
   */
  uv: (number[] | null)[]
}
export interface ReturnPayload {
  v: number
  ts: number
  kind: 'uv-return'
  objects: ReturnObject[]
  /** per-screen LED render specs, carried alongside for reference (optional) */
  screens?: { name: string; w: number; h: number; aspect: number }[]
}

/** Inputs to build one object's return UVs from its mapped shells. */
export interface ReturnObjectInput {
  name: string
  guid: string
  /** C4D polygon count (sets the payload length, 1:1 with faceIds) */
  polyCount: number
  /** the object's shells (filtered) */
  shells: Shell[]
  /** live UVs for a shell id (interleaved u,v per local vertex), or undefined */
  uv: (shellId: number) => Float32Array | undefined
}

/**
 * Build the per-polygon-corner UV payload for one object. Relies on the bridge
 * 1:1 build: a shell's `faceIds[k]` is the C4D polygon index and `polygons[k]`'s
 * corner order matches C4D's, so we emit each corner's UV straight across.
 * `toOrigVertex` is not needed here because the bridge build makes app vertices
 * identical to C4D points.
 */
export function buildReturnObject(o: ReturnObjectInput): ReturnObject {
  const uvByPoly: (number[] | null)[] = new Array(o.polyCount).fill(null)
  for (const sh of o.shells) {
    const uv = o.uv(sh.id)
    if (!uv) continue
    sh.faceIds.forEach((faceId, k) => {
      if (faceId < 0 || faceId >= o.polyCount) return
      const loop = sh.polygons[k]
      if (!loop || loop.length < 3) return
      const corners: number[] = []
      let bad = false
      for (const lv of loop) {
        const u = uv[lv * 2]
        const v = uv[lv * 2 + 1]
        if (!Number.isFinite(u) || !Number.isFinite(v)) {
          bad = true // a corner with no/NaN UV — never emit null to the plugin
          break
        }
        corners.push(u, v) // raw V-up; plugin flips
      }
      // Skip a polygon with any missing corner: leave it null so the plugin keeps
      // that polygon's existing UV rather than crashing or writing garbage.
      if (bad || corners.length < 6) return
      // C4D SetSlow always wants a,b,c,d — repeat the last corner for a triangle.
      while (corners.length < 8) corners.push(corners[corners.length - 2], corners[corners.length - 1])
      uvByPoly[faceId] = corners.slice(0, 8)
    })
  }
  return { name: o.name, guid: o.guid, polyCount: o.polyCount, vFlip: true, uv: uvByPoly }
}

export function buildReturnPayload(objects: ReturnObjectInput[], ts: number): ReturnPayload {
  return { v: ROUNDTRIP_V, ts, kind: 'uv-return', objects: objects.map(buildReturnObject) }
}

/**
 * Build geometry-only SceneObjects from a forward sidecar.
 *
 * Vertices are WELDED by position: many C4D meshes arrive as an unwelded
 * "triangle soup" (every triangle has its own 3 points, nothing shared), which
 * leaves the half-edge/shell builder seeing hundreds of disconnected triangles
 * and wrecks auto-map. Welding rebuilds a connected manifold.
 *
 * This stays LOSSLESS: the return maps UVs by ORIGINAL polygon index + corner
 * ORDER (see buildReturnObject), and welding preserves both — it only collapses
 * duplicate vertex INDICES, never reorders faces or corners. Texture/media is
 * applied later in the app.
 */
export function sceneFromSidecar(sidecar: ForwardSidecar): SceneObject[] {
  return sidecar.objects.map((o) => {
    const { positions, faces, uvs } = weldFromCorners(o.points, o.polys, o.uv)
    return { name: o.name, c4dGuid: o.guid, mesh: { name: o.name, positions, faces }, uvs }
  })
}

/**
 * Build a welded mesh from polygon corners, merging coincident points (rounded
 * to 1e-5) into ONE vertex — always by POSITION, never by UV.
 *
 * Welding by position+UV would split a mesh whose imported UVs are per-triangle
 * (a "wrong"/unwelded UV set) back into a triangle soup → auto-map then scatters
 * each triangle. Position-only welding always yields a clean connected manifold,
 * which is what the unwrap needs. Imported UVs (if any) are still carried per
 * welded vertex (first corner wins) for display; the round-trip replaces them.
 * Face count and corner order are preserved (the return maps by polygon + corner).
 */
function weldFromCorners(
  points: number[],
  polys: number[][],
  uvPerPoly?: number[][],
): { positions: Float32Array; faces: number[][]; uvs?: Float32Array } {
  const hasUV = !!uvPerPoly
  const key = new Map<string, number>()
  const pos: number[] = []
  const uvOut: number[] = []
  const faces: number[][] = polys.map((poly, k) => {
    const cornerUV = uvPerPoly?.[k]
    return poly.map((pi, j) => {
      const x = points[pi * 3],
        y = points[pi * 3 + 1],
        z = points[pi * 3 + 2]
      const u = cornerUV ? cornerUV[j * 2] : 0
      const v = cornerUV ? cornerUV[j * 2 + 1] : 0
      const k2 = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
      let idx = key.get(k2)
      if (idx === undefined) {
        idx = pos.length / 3
        pos.push(x, y, z)
        if (hasUV) uvOut.push(u, v)
        key.set(k2, idx)
      }
      return idx
    })
  })
  return {
    positions: Float32Array.from(pos),
    faces,
    uvs: hasUV ? Float32Array.from(uvOut) : undefined,
  }
}
