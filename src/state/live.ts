import type * as THREE from 'three'
import type { Distortion } from '../unwrap/distortion'

// ---------------------------------------------------------------------------
// Mutable, non-React store for the high-frequency relax animation. The worker
// writes UV frames here; the 2D viewport reads them every render frame and
// updates GPU buffers imperatively, so React never re-renders per iteration.
// ---------------------------------------------------------------------------

export const live = {
  /** current uv per shell id (interleaved, 2 per vertex) */
  uv: new Map<number, Float32Array>(),
  /** committed packed uv per shell, or null while editing/relaxing */
  packed: null as Map<number, Float32Array> | null,
  /** per-shell distortion, refreshed on relax completion */
  distortion: new Map<number, Distortion>(),
  /** layout offsets for the unpacked grid view (per shell) */
  layout: new Map<number, { ox: number; oy: number; scale: number }>(),
  /** bumped whenever geometry topology changes (new shells) */
  topoVersion: 0,
  /** bumped whenever uv frames change (drives 2D redraw) */
  dirty: true,

  // --- Screen Map mode ---
  /** the loaded map/atlas image as a GPU texture */
  atlasTexture: null as THREE.Texture | null,
  /** atlas width / height aspect ratio */
  atlasAspect: 1,

  /** which viewport the pointer is over — for context-aware number-key hotkeys */
  hoverPane: null as '3d' | '2d' | null,

  /** true when the last 3D pointer interaction was a drag (orbit), so a release
   *  over a screen doesn't get treated as a click-to-select */
  dragMoved3d: false,

  /** persisted 3D camera (so swapping views never re-frames / "flies") */
  cam3d: null as { pos: [number, number, number]; tgt: [number, number, number] } | null,

  // --- Layered (PSD) mode: one texture per screen ---
  layeredMode: false,
  /** per-screen layer texture (objName -> texture) */
  objTextures: new Map<string, THREE.Texture>(),
  /** per-screen layer aspect (objName -> w/h) */
  objAspect: new Map<string, number>(),
  /** per-screen OPAQUE content rect in its texture's UV space (alpha trimmed),
   *  so Auto-map fits each screen to its real content, not the transparent pad */
  objContentRect: new Map<string, { u0: number; v0: number; u1: number; v1: number }>(),
  /** when a screen's content is ONE LAYER of a larger PSD, the full composite +
   *  the layer's bounds within it (normalised, image y-down). Lets the 2D viewer
   *  show the WHOLE PSD and highlight just the chunk this screen uses. */
  objSource: new Map<
    string,
    { tex: THREE.Texture; aspect: number; rect: { x0: number; y0: number; x1: number; y1: number } }
  >(),
  /** all available named content layers (PSD layers / imported images) — lets
   *  Auto-match re-assign screens to layers by NAME (layer names take priority) */
  layerPool: [] as { name: string; image: CanvasImageSource; aspect: number }[],

  /** reference texel density (3D area ÷ pixel-space UV area) captured at each
   *  shell's MAPPED baseline. The distortion view shows the signed deviation from
   *  this: scaling a screen's UV up reads blue (under-sampled), down reads red. */
  refDensity: new Map<number, number>(),
}

export function resetLive() {
  live.uv.clear()
  live.packed = null
  live.distortion.clear()
  live.layout.clear()
  live.objTextures.clear()
  live.objAspect.clear()
  live.objContentRect.clear()
  for (const s of live.objSource.values()) s.tex.dispose()
  live.objSource.clear()
  live.layerPool = []
  live.refDensity.clear()
  live.layeredMode = false
  live.cam3d = null
  live.topoVersion++
  live.dirty = true
}
