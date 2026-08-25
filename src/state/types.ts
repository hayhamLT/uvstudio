// ---------------------------------------------------------------------------
// Shared data types for the app store.
//
// Split out of store.ts so the helper modules (mapping, glb, media, history)
// can name these without importing the store itself — which would be a cycle,
// since the store imports every one of those helpers. `store.ts` re-exports
// everything here, so `import { MapObject } from '../state/store'` keeps
// working everywhere it is already used.
// ---------------------------------------------------------------------------
import type { HEMesh, PolyMesh, Shell } from '../mesh/types'

export type AppMode = 'unwrap' | 'map'

export interface MapObject {
  name: string
  mesh: PolyMesh
  he: HEMesh
  shellIds: number[]
  /** when bridge-sourced: stable DCC object id; mesh faces are 1:1 with DCC
   *  polygons, so UVs can be written back losslessly per polygon-corner */
  c4dGuid?: string
  /** which DCC sent it (bridge): 'c4d' (mirrored) or 'blender' (rotation). */
  source?: 'c4d' | 'blender'
}

export interface MapShell {
  id: number
  shell: Shell
  objName: string
}

export type Tool = 'orbit' | 'cut' | 'loop' | 'ring' | 'weld' | 'select'

/** One linkable piece of media in the import wizard: a single image/PSD, or one
 *  named layer of a grouped PSD. */
export interface MediaItem {
  id: number
  label: string // layer name, or file stem
  file: File
  layerName?: string // set when this is one layer of a multi-layer PSD
  group?: string // the source PSD file name, for grouping in the UI
  thumb?: string // small dataURL preview (wizard tiles)
}

/** A transient notification card (stacked bottom-right, auto-dismissed). */
export interface Toast {
  id: number
  kind: 'good' | 'warn' | 'bad' | 'info'
  msg: string
}

export interface Display {
  wireframe: boolean
  checker: boolean
  distortion: boolean
  grid: boolean
  flatShade: boolean
  uvWireframe: boolean
}

/** Per-screen render spec carried in the GLB (node extras) + sidecar manifest. */
export interface ScreenSpec {
  name: string
  w: number // render width  (px)
  h: number // render height (px)
  aspect: number
}

export const DEFAULT_DISPLAY: Display = {
  wireframe: true,
  checker: true,
  distortion: false,
  grid: true,
  flatShade: false,
  uvWireframe: true,
}

// default reference-geometry brightness (a dim grey that reads without distracting)
export const DEFAULT_CONTEXT_SHADE = 0.3
