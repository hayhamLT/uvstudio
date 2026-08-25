import { create } from 'zustand'
import * as THREE from 'three'
import type { HEMesh, PolyMesh, SceneObject, Shell } from '../mesh/types'
import { type ShellSet } from '../mesh/shells'
import { live } from './live'
import type { Region } from '../map/types'
import { type Projection } from '../map/fit'
import * as linkBridge from '../bridge/link'
import { createUiSlice } from './slices/uiSlice'
import { createHistorySlice } from './slices/historySlice'
import { createSceneSlice } from './slices/sceneSlice'
import { createMediaSlice } from './slices/mediaSlice'
import { createMapSlice } from './slices/mapSlice'
import { createBridgeSlice } from './slices/bridgeSlice'
import { createUnwrapSlice } from './slices/unwrapSlice'
import {
  type AppMode,
  type Display,
  type MapObject,
  type MapShell,
  type MediaItem,
  type ScreenSpec,
  type Tool,
  type Toast,
} from './types'

// re-exported so existing `from '../state/store'` imports keep working
export type { AppMode, Display, MapObject, MapShell, MediaItem, ScreenSpec, Tool, Toast }

export interface AppState {
  mesh: PolyMesh | null
  he: HEMesh | null
  modelName: string
  shells: Shell[]
  shellSet: ShellSet | null

  tool: Tool
  display: Display

  isRelaxing: boolean
  relaxProgress: number
  hasUV: boolean
  isPacked: boolean
  overallDistortion: number
  uvVersion: number

  selectedShells: Set<number>
  status: string

  // --- Screen Map mode ---
  mode: AppMode
  mapObjects: MapObject[]
  mapShells: MapShell[]
  atlas: { url: string; width: number; height: number } | null
  regions: Region[]
  /** layered (PSD) mode: each screen samples its own layer texture */
  layeredMode: boolean
  psdLayerCount: number
  /** number of name-matchable content layers (PSD layers / imported images);
   *  0 for GLB imports (their UVs/textures come baked in, nothing to match) */
  layerPoolCount: number
  assignment: Record<string, number> // objectName -> regionId
  mapOrient: Record<string, { rot: number; flipX: boolean; flipY: boolean }>
  /** per-screen unwrap projection override ('auto' keeps imported UVs / relaxes) */
  mapProjection: Record<string, Projection>
  /** per-screen render resolution override (real LED pixel size); when unset the
   *  app uses the applied media's pixel dimensions */
  screenRes: Record<string, { w: number; h: number }>
  mapFill: boolean
  /** preference: auto-map screens right after import (persisted) */
  autoMapOnImport: boolean
  /** preference: extra comma-separated words (beyond the built-in screen/led/
   *  display/…) that mark an object as an auto-detected screen (persisted) */
  screenKeywords: string
  setScreenKeywords: (v: string) => void
  /** per-object fit override; falls back to the global mapFill */
  mapObjFit: Record<string, 'fill' | 'aspect'>
  /** per-object stretch when filling: % the region differs from the screen aspect */
  mapFitInfo: Record<string, { stretch: number }>
  mappedObjects: string[]
  selectedObject: string | null
  ocrBusy: boolean
  /** draw / list order of screens (object names); later = drawn on top */
  screenOrder: string[]
  /** screens temporarily hidden in the 3D view */
  hiddenScreens: string[]
  /** when set, only this screen is shown (solo) */
  soloScreen: string | null
  /** screens whose UVs came from the imported file — keep them, don't re-project */
  importedObjects: string[]
  /** objects parsed from a file, awaiting the user's screen selection. `media`
   *  holds any image/PSD files imported alongside the model, to auto-apply to
   *  the matching screens once the selection is confirmed. */
  pendingImport: { objects: SceneObject[]; fileName: string; media?: File[] } | null
  /** the import-link wizard: screen names, parsed media items, and the current
   *  object→item assignment (auto-suggested by name, editable by the user). */
  pendingLink: { objects: string[]; items: MediaItem[]; links: Record<string, number> } | null
  /** non-screen geometry imported as dimmable reference (the "other objects") */
  contextShells: MapShell[]
  contextCount: number
  /** brightness of the reference geometry group, 0 (black) … 1 (white) */
  contextShade: number
  /** opacity of the reference geometry group, 0.15 (ghost) … 1 (solid) */
  contextOpacity: number
  /** whether the reference geometry group is shown */
  contextVisible: boolean
  /** the file this scene came from, for one-click Refresh */
  lastImportName: string | null

  // 3D viewport display mode
  view3d: 'shaded' | 'distortion' | 'checker'
  setView3d: (m: 'shaded' | 'distortion' | 'checker') => void
  /** cull back faces in the 3D view (screens visible only from their front) */
  cullBackface: boolean
  setCullBackface: (v: boolean) => void

  // UV component editing
  editMode: 'none' | 'object' | 'vertex' | 'edge' | 'face' | 'transform'
  mapSelection: Set<string> // "shellId:localVertexIndex"

  // undo / redo
  undoCount: number
  redoCount: number
  pushUndo: () => void
  undo: () => void
  redo: () => void

  setMode: (m: AppMode) => void
  loadScene: (objects: SceneObject[], opts?: { screenNames?: string[]; keepOverrides?: boolean }) => void
  beginImport: (objects: SceneObject[], fileName: string, media?: File[]) => void
  confirmImport: (screenNames: string[]) => void
  cancelImport: () => void
  /** Distribute image/PSD files to screens by name (PSD layer name → screen, or
   *  file name → screen). Returns how many screens got media. Used to auto-apply
   *  media imported with a model, and by the "+ images" button. */
  applyMediaFiles: (files: File[] | FileList) => Promise<number>
  /** Parse media files into linkable items and open the link wizard with names
   *  auto-suggested. */
  beginLink: (files: File[] | FileList) => Promise<void>
  /** Open the link wizard for the current screens with no media yet. */
  openLinkWizard: () => void
  /** Add media files into the already-open link wizard. */
  addLinkMedia: (files: File[] | FileList) => Promise<void>
  /** Apply the wizard's object→item links (each linked layer/file to its screen). */
  confirmLink: (links: Record<string, number>) => Promise<void>
  cancelLink: () => void
  setContextShade: (v: number) => void
  setContextOpacity: (v: number) => void
  setContextVisible: (v: boolean) => void
  loadDemoArena: () => void
  loadDemoPsd: () => Promise<void>
  loadAtlasUrl: (url: string, detect: boolean) => Promise<void>
  loadPsd: (file: File) => Promise<void>
  loadImages: (files: File[], merge?: boolean) => Promise<void>
  setObjectImage: (
    objName: string,
    file: File,
    opts?: { remap?: boolean; layerName?: string },
  ) => Promise<void>
  removeObjectTexture: (objName: string) => void
  moveScreen: (objName: string, dir: 'up' | 'down') => void
  toggleHidden: (objName: string) => void
  toggleSolo: (objName: string) => void
  autoMatch: () => Promise<void>
  assign: (objName: string, regionId: number | null) => void
  rotateObject: (objName: string, dir: 'cw' | 'ccw') => void
  flipObject: (objName: string, axis: 'x' | 'y') => void
  scaleSelection: (factor: number) => void
  scaleObject: (objName: string, factor: number) => void
  scaleMode: boolean
  setScaleMode: (on: boolean) => void
  resetObjectOrient: (objName: string) => void
  /** set a screen's unwrap projection (auto / planar / cylindrical / spherical) */
  setObjectProjection: (objName: string, p: Projection) => void
  /** override a screen's render resolution (real LED pixels); 0×0 clears it */
  setScreenRes: (objName: string, w: number, h: number) => void
  setMapFill: (fill: boolean) => void
  setAutoMapOnImport: (v: boolean) => void
  setObjectFit: (objName: string, fit: 'fill' | 'aspect' | 'default') => void
  runMapping: (opts?: { announce?: boolean }) => void
  runMappingFor: (objName: string, opts?: { noUndo?: boolean }) => void
  selectObject: (name: string | null) => void
  exportGltf: () => void
  /** Send the mapped GLB back to Cinema 4D via the local UV Studio plugin bridge. */
  sendToC4D: () => void
  /** Handle a uv-ack from a DCC plugin: quit on clean success (post-send), stay
   *  open and warn (with the missed names) on partial failure or error. */
  handleUvAck: (ack: linkBridge.UvAck) => void
  setEditMode: (m: 'none' | 'object' | 'vertex' | 'edge' | 'face' | 'transform') => void
  setMapSelection: (s: Set<string>) => void
  clearMapSelection: () => void

  // actions
  loadMesh: (mesh: PolyMesh) => void
  loadSample: (key: string) => void
  setTool: (t: Tool) => void
  setDisplay: (key: keyof Display, value: boolean) => void
  flatten: () => void
  cancelRelax: () => void
  pack: () => void
  unpack: () => void
  selectShell: (id: number, additive: boolean) => void
  clearSelection: () => void
  setStatus: (s: string) => void

  // transient notification cards (Toasts component renders + auto-dismisses)
  toasts: Toast[]
  pushToast: (kind: Toast['kind'], msg: string) => void
  dismissToast: (id: number) => void
}

// ---------------------------------------------------------------------------
// The store is assembled from slices (src/state/slices/*). Each slice owns one
// area of the app and receives the FULL set/get, so cross-slice calls — an
// import kicking off a mapping run, auto-map pushing an undo step — keep
// working exactly as they did when this was one 2,300-line object literal.
// ---------------------------------------------------------------------------
export const useStore = create<AppState>()((...a) => ({
  ...createUiSlice(...a),
  ...createHistorySlice(...a),
  ...createSceneSlice(...a),
  ...createMediaSlice(...a),
  ...createMapSlice(...a),
  ...createBridgeSlice(...a),
  ...createUnwrapSlice(...a),
}))

// Dev-only handles for debugging / scripted verification from the console.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as { uvStore: typeof useStore }).uvStore = useStore
  ;(window as unknown as { uvLive: typeof live }).uvLive = live
  ;(window as unknown as { uvThree: typeof THREE }).uvThree = THREE
  // both are code-split now, so the dev handles resolve them lazily too
  void import('three/examples/jsm/exporters/GLTFExporter.js').then((m) => {
    ;(window as unknown as { uvGltfExporter: unknown }).uvGltfExporter = m.GLTFExporter
  })
  void import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => {
    ;(window as unknown as { uvGltfLoader: unknown }).uvGltfLoader = m.GLTFLoader
  })
}
