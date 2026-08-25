// ---------------------------------------------------------------------------
// The mapping engine: how a screen's UVs are derived from the content it is
// showing.
//
// Everything here is a pure-ish function over a MapSnapshot (an immutable view
// of the mapping-relevant store fields) plus the mutable `live` UV buffers, so
// it can be exercised without a store, a React tree or a GPU.
// ---------------------------------------------------------------------------
import type { Region } from '../map/types'
import type { Shell } from '../mesh/types'
import { flattenAndFit, type Projection, type RectUV } from '../map/fit'
import { packIslands } from '../unwrap/pack'
import { matchNamesToLabels } from '../map/ocr'
import { contentRectFromImage } from '../map/contentRect'
import { extractShells } from '../mesh/shells'
import * as THREE from 'three'
import { live } from './live'
import type { MapObject } from './types'

/** The mapping-relevant slice of app state, snapshotted so the mapping run
 *  sees one consistent view (and so this module never imports the store). */
export interface MapSnapshotSource {
  assignment: Record<string, number>
  regions: Region[]
  mapOrient: Record<string, { rot: number; flipX: boolean; flipY: boolean }>
  mapObjFit: Record<string, 'fill' | 'aspect'>
  mapProjection: Record<string, Projection>
  mapFill: boolean
  layeredMode: boolean
  atlas: { url: string; width: number; height: number } | null
  importedObjects: string[]
}

export interface MapSnapshot {
  assignment: Record<string, number>
  regById: Map<number, Region>
  mapOrient: Record<string, { rot: number; flipX: boolean; flipY: boolean }>
  mapObjFit: Record<string, 'fill' | 'aspect'>
  mapProjection: Record<string, Projection>
  mapFill: boolean
  layeredMode: boolean
  atlas: { url: string; width: number; height: number } | null
}

/** The target UV rect for an object: its layer ([0,1]) or its assigned region. */
export function rectFor(obj: MapObject, st: MapSnapshot): RectUV | null {
  if (st.layeredMode) {
    if (!live.objTextures.has(obj.name)) return null
    // fit to the OPAQUE content of the texture (alpha trimmed), not the full image
    return live.objContentRect.get(obj.name) ?? { u0: 0, v0: 0, u1: 1, v1: 1 }
  }
  const rid = st.assignment[obj.name]
  if (rid == null) return null
  const r = st.regById.get(rid)
  if (!r) return null
  return { u0: r.x0, v0: 1 - r.y1, u1: r.x1, v1: 1 - r.y0 }
}

/** Aspect of the target (layer or region, in pixels) — for stretch warnings. */
export function targetAspect(obj: MapObject, st: MapSnapshot): number {
  if (st.layeredMode) {
    const a = live.objAspect.get(obj.name) ?? 1
    const cr = live.objContentRect.get(obj.name)
    // aspect of the opaque content region, not the whole texture
    return cr ? (a * (cr.u1 - cr.u0)) / Math.max(cr.v1 - cr.v0, 1e-6) : a
  }
  const r = st.regById.get(st.assignment[obj.name])
  const a = st.atlas ? st.atlas.width / st.atlas.height : 1
  return r ? ((r.x1 - r.x0) * a) / (r.y1 - r.y0) : 1
}

/** Map one object's UVs to its target. Returns stretch% if mapped, else null. */
/** Keep a screen's IMPORTED UVs (the user's C4D unwrap — seam cuts, cylinder
 *  unrolls the app can't reproduce) and just normalise that layout to fill the
 *  matched content rect. Preserves the unwrap; only repositions/scales it. */
export function fitAuthoredUV(obj: MapObject, rect: RectUV) {
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity
  for (const id of obj.shellIds) {
    const a = authoredUV.get(id)
    if (!a) continue
    for (let i = 0; i < a.length; i += 2) {
      if (a[i] < u0) u0 = a[i]
      if (a[i] > u1) u1 = a[i]
      if (a[i + 1] < v0) v0 = a[i + 1]
      if (a[i + 1] > v1) v1 = a[i + 1]
    }
  }
  const sw = u1 - u0 || 1e-6
  const sh = v1 - v0 || 1e-6
  const rw = rect.u1 - rect.u0
  const rh = rect.v1 - rect.v0
  for (const id of obj.shellIds) {
    const a = authoredUV.get(id)
    if (!a) continue
    const out = new Float32Array(a.length)
    for (let i = 0; i < a.length; i += 2) {
      out[i] = rect.u0 + ((a[i] - u0) / sw) * rw
      out[i + 1] = rect.v0 + ((a[i + 1] - v0) / sh) * rh
    }
    live.uv.set(id, out)
  }
}

/** Copy a shell's data into an existing shell object in place, so the references
 *  held by mapShells (and used by the renderer) pick up a re-projected topology
 *  (e.g. cylindrical seam-split adds vertices). */
export function replaceShell(dst: Shell, src: Shell) {
  dst.positions = src.positions
  dst.triangles = src.triangles
  dst.toOrigVertex = src.toOrigVertex
  dst.vertCount = src.vertCount
  dst.triCount = src.triCount
  dst.polygons = src.polygons
  dst.faceIds = src.faceIds
}

/** Undo any prior seam-split so the rendered shell matches the original topology
 *  (needed before fitting authored UVs, which are keyed to the original verts). */
export function restoreOriginalShells(obj: MapObject, shellById: Map<number, Shell>) {
  const split = obj.shellIds.some((id) => {
    const sh = shellById.get(id)
    const a = authoredUV.get(id)
    return sh && a && sh.vertCount !== a.length / 2
  })
  if (!split) return
  const orig = extractShells(obj.he).shells
  obj.shellIds.forEach((id, k) => {
    const sh = shellById.get(id)
    if (sh && orig[k]) replaceShell(sh, orig[k])
  })
}

export function mapObjectUV(obj: MapObject, st: MapSnapshot, shellById: Map<number, Shell>): number | null {
  const rect = rectFor(obj, st)
  if (!rect) return null
  const proj = st.mapProjection[obj.name] ?? 'auto'
  // PRESERVE imported UVs: in 'auto', a screen that came in with authored UVs
  // keeps that exact unwrap (seams/cuts from C4D) — we only normalise it onto the
  // content. A chosen projection (planar/cylindrical/spherical) OVERRIDES that and
  // re-unwraps. Screens with no authored UVs always unwrap from geometry.
  if (proj === 'auto' && obj.shellIds.some((id) => authoredUV.has(id))) {
    restoreOriginalShells(obj, shellById)
    fitAuthoredUV(obj, rect)
    return 0
  }
  const o = st.mapOrient[obj.name] ?? { rot: 0, flipX: false, flipY: false }
  const fit = st.mapObjFit[obj.name] ? st.mapObjFit[obj.name] === 'fill' : st.mapFill
  const result = flattenAndFit(obj.he, rect, {
    relaxIters: 24,
    rot: o.rot,
    // C4D objects had Z negated on import (a mirror), which flips the unwrap's U.
    // Bake in the horizontal flip so auto-map comes out correct without the user
    // flipping every screen by hand (XOR with any manual flip). Blender objects
    // arrive via a pure rotation (no mirror), so they need no compensation.
    flipX: o.flipX !== (obj.source === 'c4d'),
    flipY: o.flipY,
    fill: fit,
    projection: proj,
  })
  obj.shellIds.forEach((id, k) => {
    if (result.uv[k]) live.uv.set(id, result.uv[k])
    const sh = shellById.get(id)
    if (sh && result.shells[k]) replaceShell(sh, result.shells[k]) // pick up seam-split topology
  })
  return Math.abs(targetAspect(obj, st) / result.srcAspect - 1) * 100
}

/**
 * Rotate/flip an object's CURRENT uv island IN PLACE — a RIGID spin/mirror about
 * its centre, NO re-flatten, so authored (imported) UVs and manual edits stay
 * intact. The spin happens in ASPECT-SCALED space (u·aspect, v) — the same space
 * the 2D editor and the textured screen are seen in — so the image rotates
 * rigidly with NO stretch or squish: a wide rectangle becomes a clean vertical
 * one. (Rotating raw u,v instead shears it, because the texture isn't square.)
 */
export function transformObjectUV(
  obj: MapObject,
  st: MapSnapshot,
  op: { rot?: number; flipX?: boolean; flipY?: boolean },
): boolean {
  // only transform a screen that actually has UVs / a target
  if (!rectFor(obj, st)) return false
  const arrays = obj.shellIds.map((id) => live.uv.get(id)).filter(Boolean) as Float32Array[]
  if (!arrays.length) return false

  // aspect (w/h, in pixels) of the texture this screen samples — the same factor
  // the views apply to U, so we rotate in that visually-square space.
  const aspect = st.layeredMode
    ? (live.objAspect.get(obj.name) ?? 1)
    : st.atlas
      ? st.atlas.width / Math.max(st.atlas.height, 1)
      : 1
  const A = aspect > 0 ? aspect : 1

  // centre of the whole island in aspect-scaled space (multi-shell spins as one)
  let mnx = Infinity,
    mxx = -Infinity,
    mny = Infinity,
    mxy = -Infinity
  for (const a of arrays)
    for (let i = 0; i < a.length; i += 2) {
      const x = a[i] * A
      if (x < mnx) mnx = x
      if (x > mxx) mxx = x
      if (a[i + 1] < mny) mny = a[i + 1]
      if (a[i + 1] > mxy) mxy = a[i + 1]
    }
  const cx = (mnx + mxx) / 2
  const cy = (mny + mxy) / 2
  const rot = (((op.rot ?? 0) % 360) + 360) % 360

  // rigid rotation/flip about the island's OWN centre (pivot stays put), then
  // un-scale U back to raw UV space. No post-shift — the screen spins in place.
  for (const a of arrays)
    for (let i = 0; i < a.length; i += 2) {
      let x = a[i] * A - cx
      let y = a[i + 1] - cy
      if (op.flipX) x = -x
      if (op.flipY) y = -y
      if (rot === 90) [x, y] = [-y, x]
      else if (rot === 180) [x, y] = [-x, -y]
      else if (rot === 270) [x, y] = [y, -x]
      a[i] = (cx + x) / A
      a[i + 1] = cy + y
    }
  return true
}

/**
 * Assign each named screen its best content layer from `live.layerPool` by NAME
 * similarity (layer names take priority over any image/region matching). Returns
 * how many screens got a layer. Replaces existing textures.
 */
export function matchLayerPool(names: string[]): number {
  // exact-first, one-to-one — each layer goes to the single screen that names it
  const assign = matchNamesToLabels(
    names,
    live.layerPool.map((l, i) => ({ id: i, label: l.name })),
  )
  let matched = 0
  for (const name of names) {
    const idx = assign[name]
    if (idx == null) continue
    const l = live.layerPool[idx]
    live.objTextures.get(name)?.dispose()
    const tex = new THREE.Texture(l.image as unknown as HTMLImageElement)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    live.objTextures.set(name, tex)
    live.objAspect.set(name, l.aspect)
    live.objContentRect.set(name, contentRectFromImage(l.image))
    matched++
  }
  return matched
}

export function snapshot(g: MapSnapshotSource): MapSnapshot {
  return {
    assignment: g.assignment,
    regById: new Map(g.regions.map((r) => [r.id, r])),
    mapOrient: g.mapOrient,
    mapObjFit: g.mapObjFit,
    mapProjection: g.mapProjection,
    mapFill: g.mapFill,
    layeredMode: g.layeredMode,
    atlas: g.atlas,
  }
}

export function computePacked(shells: Shell[], uvMap: Map<number, Float32Array>): Map<number, Float32Array> {
  const ids = shells.map((s) => s.id).filter((id) => uvMap.has(id))
  const islands = ids.map((id) => ({ uv: uvMap.get(id)! }))
  const result = packIslands(islands)
  const out = new Map<number, Float32Array>()
  ids.forEach((id, i) => out.set(id, result.uv[i]))
  return out
}

// Manual per-screen texture overrides (add/replace), kept by name so they
// survive a Refresh of the underlying model file.
export const screenOverrides = new Map<
  string,
  {
    image: CanvasImageSource
    aspect: number
    // a chunk screen samples the WHOLE image and sits in its slice via UVs; this
    // is that slice in the texture's UV space (y-up), re-applied on Refresh so the
    // fit lands in the right place
    contentRect?: RectUV
  }
>()

// The UVs each imported screen came in with (per shell id). Lets "M" snap an
// imported screen back to its authored mapping after a manual move/rotate,
// instead of re-projecting it onto a shared texture.
export const authoredUV = new Map<number, Float32Array>()
