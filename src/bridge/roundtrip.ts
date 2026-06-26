import type { Shell } from '../mesh/types'

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
      for (const lv of loop) corners.push(uv[lv * 2], uv[lv * 2 + 1]) // raw V-up; plugin flips
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
