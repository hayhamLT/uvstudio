import { create } from 'zustand'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { HEMesh, PolyMesh, SceneObject, Shell } from '../mesh/types'
import { buildHalfEdge } from '../mesh/halfedge'
import { extractShells, type ShellSet } from '../mesh/shells'
import { SAMPLES } from '../mesh/samples'
import { computeDistortion } from '../unwrap/distortion'
import { packIslands } from '../unwrap/pack'
import { live, resetLive } from './live'
import type { FromWorker, SerializedShell, ToWorker } from '../workers/protocol'
import type { Region } from '../map/types'
import { detectRegions } from '../map/regions'
import { contentRectFromImage, opaqueBBoxNorm } from '../map/contentRect'
import { flattenAndFit, type RectUV, type Projection } from '../map/fit'
import { ocrRegionLabels, matchByLabels, similarity, normalize, matchNamesToLabels } from '../map/ocr'
import { demoArena, makeDemoAtlas, demoRegions } from '../map/demo'
import { loadPsdFile, flattenPsdLayers } from '../mesh/loadPsd'
import * as linkBridge from '../bridge/link'
import { buildReturnPayload, type ReturnObjectInput } from '../bridge/roundtrip'

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

/** A transient notification card (stacked top-right, auto-dismissed). */
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

interface AppState {
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

const DEFAULT_DISPLAY: Display = {
  wireframe: true,
  checker: true,
  distortion: false,
  grid: true,
  flatShade: false,
  uvWireframe: true,
}

// --- unwrap worker singleton ---
let worker: Worker | null = null
let jobCounter = 0
let toastCounter = 0

function ensureWorker(get: () => AppState, set: (p: Partial<AppState>) => void): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/unwrap.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'init' || msg.type === 'iter') {
      live.uv.set(msg.shellId, msg.uv)
      live.dirty = true
    } else if (msg.type === 'progress') {
      set({ relaxProgress: msg.iter / msg.total })
    } else if (msg.type === 'done') {
      finishRelax(get, set)
    }
  }
  return worker
}

function finishRelax(get: () => AppState, set: (p: Partial<AppState>) => void) {
  const { shells } = get()
  live.distortion.clear()
  let sum = 0
  let wsum = 0
  for (const shell of shells) {
    const uv = live.uv.get(shell.id)
    if (!uv) continue
    const d = computeDistortion(shell.positions, uv, shell.triangles)
    live.distortion.set(shell.id, d)
    sum += d.overall * shell.triCount
    wsum += shell.triCount
  }
  live.dirty = true
  set({
    isRelaxing: false,
    relaxProgress: 1,
    hasUV: true,
    overallDistortion: wsum ? sum / wsum : 0,
    uvVersion: get().uvVersion + 1,
    status: `Relaxed ${shells.length} shell${shells.length === 1 ? '' : 's'} · ${(
      (wsum ? sum / wsum : 0) * 100
    ).toFixed(1)}% avg distortion`,
  })
}

// --- undo / redo: snapshot the editable "document" (uv + mapping metadata) ---
// shell geometry can change topology (seam-split on cylindrical/spherical), so
// undo must restore it too — otherwise UVs and the mesh desync after an undo.
type GeomSnap = Pick<
  Shell,
  'positions' | 'triangles' | 'toOrigVertex' | 'vertCount' | 'triCount' | 'polygons' | 'faceIds'
>
interface DocSnapshot {
  uv: Map<number, Float32Array>
  shells: Map<number, GeomSnap>
  assignment: Record<string, number>
  mapOrient: Record<string, { rot: number; flipX: boolean; flipY: boolean }>
  mapObjFit: Record<string, 'fill' | 'aspect'>
  mapProjection: Record<string, Projection>
  mappedObjects: string[]
  mapFitInfo: Record<string, { stretch: number }>
  importedObjects: string[]
}
const undoStack: DocSnapshot[] = []
const redoStack: DocSnapshot[] = []
const UNDO_LIMIT = 60

// default reference-geometry brightness (a dim grey that reads without distracting)
const DEFAULT_CONTEXT_SHADE = 0.3

// persisted boolean preferences (localStorage, namespaced)
const prefBool = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem('uvstudio.' + k)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}

/** Per-screen render spec carried in the GLB (node extras) + sidecar manifest. */
export interface ScreenSpec {
  name: string
  w: number // render width  (px)
  h: number // render height (px)
  aspect: number
}

// After a Send, the app quits only once the DCC acks a clean apply (or after a
// fallback timeout if the DCC is closed — it applies on its next launch). A
// partial failure/error keeps the app open so the warning is actually seen.
let sendQuitTimer: ReturnType<typeof setTimeout> | null = null
function armSendQuit() {
  if (sendQuitTimer) clearTimeout(sendQuitTimer)
  sendQuitTimer = setTimeout(() => {
    sendQuitTimer = null
    void linkBridge.quitApp()
  }, 6000)
}
function disarmSendQuit(): boolean {
  const armed = sendQuitTimer !== null
  if (sendQuitTimer) clearTimeout(sendQuitTimer)
  sendQuitTimer = null
  return armed
}

/** The LED render size for each mapped screen: the manual RES override if set,
 *  else the applied media's pixel dimensions. Feeds the export sidecar + bridge
 *  manifest so a render pipeline / C4D gets the exact pixel sizes. */
function screenSpecs(g: AppState): ScreenSpec[] {
  const dims = (i?: { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number }) => ({
    w: i?.naturalWidth || i?.width || 0,
    h: i?.naturalHeight || i?.height || 0,
  })
  return g.mappedObjects.map((name) => {
    let w = 0
    let h = 0
    const ov = g.screenRes[name]
    if (ov?.w && ov?.h) {
      // explicit RES override — always wins
      w = ov.w
      h = ov.h
    } else {
      const f = dims(live.objTextures.get(name)?.image as { width?: number; height?: number })
      const cr = live.objContentRect.get(name)
      if (cr && (cr.u1 - cr.u0 < 0.999 || cr.v1 - cr.v0 < 0.999)) {
        // chunk screen: samples a sub-region of a bigger image via UVs → the
        // slice's pixel size is that fraction of the full image
        w = Math.round((cr.u1 - cr.u0) * f.w)
        h = Math.round((cr.v1 - cr.v0) * f.h)
      } else {
        w = f.w
        h = f.h
      }
    }
    return { name, w, h, aspect: h ? w / h : live.objAspect.get(name) ?? 1 }
  })
}

/** Sidecar manifest (pretty JSON) listing every screen's render size. */
function screenManifest(specs: ScreenSpec[]): string {
  return JSON.stringify({ v: 1, app: 'UV Studio', kind: 'screen-map', screens: specs }, null, 2)
}

/** Build a binary glTF (GLB) of all mapped screens — geometry + per-screen UVs
 *  and textures, with each screen's render resolution in its node `extras`.
 *  Returns null when there is nothing mapped yet. Shared by "GLB" + "Send". */
function buildMappedGlb(
  mapShells: MapShell[],
  layeredMode: boolean,
  specByName?: Map<string, ScreenSpec>,
): Promise<ArrayBuffer | null> {
  if (!mapShells.length) return Promise.resolve(null)
  const group = new THREE.Group()
  for (const ms of mapShells) {
    const uv = live.uv.get(ms.id)
    if (!uv) continue
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(ms.shell.positions.slice(), 3))
    geo.setIndex(Array.from(ms.shell.triangles))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2))
    geo.computeVertexNormals()
    const tex = layeredMode ? live.objTextures.get(ms.objName) ?? null : live.atlasTexture
    const mat = new THREE.MeshStandardMaterial({
      map: tex ?? null,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: layeredMode,
      roughness: 0.7,
      metalness: 0,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = ms.objName
    // GLTFExporter writes userData → node.extras, so the LED size travels in the GLB
    const spec = specByName?.get(ms.objName)
    if (spec) mesh.userData = { uvstudio: { resolution: [spec.w, spec.h], aspect: spec.aspect } }
    group.add(mesh)
  }
  if (!group.children.length) return Promise.resolve(null)
  return new Promise((resolve) => {
    new GLTFExporter().parse(
      group,
      (result) => resolve(result as ArrayBuffer),
      () => resolve(null),
      { binary: true, onlyVisible: false },
    )
  })
}

// Manual per-screen texture overrides (add/replace), kept by name so they
// survive a Refresh of the underlying model file.
const screenOverrides = new Map<
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
const authoredUV = new Map<number, Float32Array>()

function snapshotDoc(g: AppState): DocSnapshot {
  const uv = new Map<number, Float32Array>()
  for (const [k, a] of live.uv) uv.set(k, a.slice())
  // shell arrays are only ever reassigned wholesale (never mutated in place), so
  // capturing references here is safe and cheap — undo restores those references.
  const shells = new Map<number, GeomSnap>()
  for (const m of g.mapShells) {
    const s = m.shell
    shells.set(m.id, {
      positions: s.positions,
      triangles: s.triangles,
      toOrigVertex: s.toOrigVertex,
      vertCount: s.vertCount,
      triCount: s.triCount,
      polygons: s.polygons,
      faceIds: s.faceIds,
    })
  }
  return {
    uv,
    shells,
    assignment: { ...g.assignment },
    mapOrient: structuredClone(g.mapOrient),
    mapObjFit: { ...g.mapObjFit },
    mapProjection: { ...g.mapProjection },
    mappedObjects: [...g.mappedObjects],
    mapFitInfo: structuredClone(g.mapFitInfo),
    importedObjects: [...g.importedObjects],
  }
}

function restoreDoc(snap: DocSnapshot, set: (p: Partial<AppState>) => void, g: AppState) {
  live.uv.clear()
  for (const [k, a] of snap.uv) live.uv.set(k, a.slice())
  // restore shell geometry; if any topology changed, hand mapShells a fresh array
  // ref so the 3D/2D geometry rebuilds at the restored vertex count.
  let topoChanged = false
  for (const m of g.mapShells) {
    const geom = snap.shells.get(m.id)
    if (!geom) continue
    if (m.shell.vertCount !== geom.vertCount) topoChanged = true
    m.shell.positions = geom.positions
    m.shell.triangles = geom.triangles
    m.shell.toOrigVertex = geom.toOrigVertex
    m.shell.vertCount = geom.vertCount
    m.shell.triCount = geom.triCount
    m.shell.polygons = geom.polygons
    m.shell.faceIds = geom.faceIds
  }
  live.dirty = true
  set({
    assignment: { ...snap.assignment },
    mapOrient: structuredClone(snap.mapOrient),
    mapObjFit: { ...snap.mapObjFit },
    mapProjection: { ...snap.mapProjection },
    mappedObjects: [...snap.mappedObjects],
    mapFitInfo: structuredClone(snap.mapFitInfo),
    importedObjects: [...snap.importedObjects],
    ...(topoChanged ? { mapShells: [...g.mapShells] } : {}),
    uvVersion: g.uvVersion + 1,
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/** True if the file is a Photoshop document — by extension OR by its "8BPS"
 *  magic bytes, so PSDs exported without a .psd suffix are still recognised. */
async function isPsd(file: File): Promise<boolean> {
  if (/\.psd$/i.test(file.name)) return true
  try {
    const b = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    return b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53 // "8BPS"
  } catch {
    return false
  }
}

interface MapSnapshot {
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
function rectFor(obj: MapObject, st: MapSnapshot): RectUV | null {
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
function targetAspect(obj: MapObject, st: MapSnapshot): number {
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
function fitAuthoredUV(obj: MapObject, rect: RectUV) {
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
function replaceShell(dst: Shell, src: Shell) {
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
function restoreOriginalShells(obj: MapObject, shellById: Map<number, Shell>) {
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

function mapObjectUV(obj: MapObject, st: MapSnapshot, shellById: Map<number, Shell>): number | null {
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
function transformObjectUV(
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
    ? live.objAspect.get(obj.name) ?? 1
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
function matchLayerPool(names: string[]): number {
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

function snapshot(g: AppState): MapSnapshot {
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

function computePacked(
  shells: Shell[],
  uvMap: Map<number, Float32Array>,
): Map<number, Float32Array> {
  const ids = shells.map((s) => s.id).filter((id) => uvMap.has(id))
  const islands = ids.map((id) => ({ uv: uvMap.get(id)! }))
  const result = packIslands(islands)
  const out = new Map<number, Float32Array>()
  ids.forEach((id, i) => out.set(id, result.uv[i]))
  return out
}

/** Explode media files into linkable items: one per image, one per PSD layer. */
/** Downscale any drawable source into a small dataURL for wizard preview tiles. */
function thumbUrl(src: CanvasImageSource, sw: number, sh: number): string | undefined {
  try {
    if (!sw || !sh) return undefined
    const MAX = 144 // longest edge, px — small enough to keep dozens in memory
    const s = Math.min(1, MAX / Math.max(sw, sh))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(sw * s))
    cv.height = Math.max(1, Math.round(sh * s))
    cv.getContext('2d')!.drawImage(src, 0, 0, cv.width, cv.height)
    return cv.toDataURL('image/png')
  } catch {
    return undefined
  }
}

async function imageThumb(file: File): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file)
    const t = thumbUrl(bmp, bmp.width, bmp.height)
    bmp.close()
    return t
  } catch {
    return undefined
  }
}

async function parseMediaItems(files: File[], startId: number): Promise<MediaItem[]> {
  const items: MediaItem[] = []
  let idc = startId
  for (const f of files) {
    if (await isPsd(f)) {
      try {
        const psd = await loadPsdFile(f)
        if (psd.layers.length > 1) {
          for (const l of psd.layers)
            items.push({
              id: idc++,
              label: l.name,
              file: f,
              layerName: l.name,
              group: f.name,
              thumb: thumbUrl(l.canvas, l.width, l.height),
            })
        } else {
          const flat = psd.composite ?? flattenPsdLayers(psd)
          items.push({
            id: idc++,
            label: f.name.replace(/\.[^.]+$/, ''),
            file: f,
            thumb: thumbUrl(flat, flat.width, flat.height),
          })
        }
      } catch {
        /* skip unreadable PSD */
      }
    } else {
      items.push({
        id: idc++,
        label: f.name.replace(/\.[^.]+$/, ''),
        file: f,
        thumb: await imageThumb(f),
      })
    }
  }
  return items
}

/** Suggest object→item links: exact name match first, then high-similarity,
 *  one-to-one, keeping any links the user already made. */
function suggestLinks(
  objects: string[],
  items: MediaItem[],
  existing: Record<string, number> = {},
): Record<string, number> {
  const links: Record<string, number> = { ...existing }
  const usedItem = new Set<number>(Object.values(links))
  for (const name of objects) {
    if (links[name] != null) continue
    const it = items.find((i) => !usedItem.has(i.id) && normalize(i.label) === normalize(name))
    if (it) {
      links[name] = it.id
      usedItem.add(it.id)
    }
  }
  const pairs: { name: string; id: number; sim: number }[] = []
  for (const name of objects) {
    if (links[name] != null) continue
    for (const it of items) {
      if (usedItem.has(it.id)) continue
      pairs.push({ name, id: it.id, sim: similarity(name, it.label) })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim)
  for (const p of pairs) {
    if (p.sim < 0.82) break
    if (links[p.name] != null || usedItem.has(p.id)) continue
    links[p.name] = p.id
    usedItem.add(p.id)
  }
  return links
}

export const useStore = create<AppState>((set, get) => ({
  mesh: null,
  he: null,
  modelName: '',
  shells: [],
  shellSet: null,
  tool: 'cut',
  display: DEFAULT_DISPLAY,
  isRelaxing: false,
  relaxProgress: 0,
  hasUV: false,
  isPacked: false,
  overallDistortion: 0,
  uvVersion: 0,
  selectedShells: new Set(),
  status: 'Load a model to begin',
  toasts: [],

  mode: 'map',
  mapObjects: [],
  mapShells: [],
  atlas: null,
  regions: [],
  layeredMode: false,
  psdLayerCount: 0,
  layerPoolCount: 0,
  assignment: {},
  mapOrient: {},
  mapProjection: {},
  screenRes: {},
  // Fill by default: the screen's UVs cover the ENTIRE image — or, for a PSD
  // layer / image with alpha, the entire opaque region (see objContentRect).
  // Media made for the screen fills it exactly; a mismatch fills + stretches
  // rather than cropping or letterboxing (the whole image always shows).
  mapFill: true,
  autoMapOnImport: prefBool('autoMapOnImport', false),
  mapObjFit: {},
  mapFitInfo: {},
  mappedObjects: [],
  selectedObject: null,
  ocrBusy: false,
  screenOrder: [],
  hiddenScreens: [],
  soloScreen: null,
  importedObjects: [],
  pendingImport: null,
  pendingLink: null,
  contextShells: [],
  contextCount: 0,
  contextShade: DEFAULT_CONTEXT_SHADE,
  contextVisible: true,
  lastImportName: null,
  view3d: 'shaded',
  setView3d: (m) => set({ view3d: m }),
  cullBackface: true,
  setCullBackface: (v) => set({ cullBackface: v }),

  editMode: 'object',
  mapSelection: new Set(),
  scaleMode: false,
  undoCount: 0,
  redoCount: 0,

  pushUndo: () => {
    undoStack.push(snapshotDoc(get()))
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
    redoStack.length = 0
    set({ undoCount: undoStack.length, redoCount: 0 })
  },

  undo: () => {
    if (!undoStack.length) return
    redoStack.push(snapshotDoc(get()))
    const snap = undoStack.pop()!
    restoreDoc(snap, set, get())
    set({ undoCount: undoStack.length, redoCount: redoStack.length, status: 'Undo' })
  },

  redo: () => {
    if (!redoStack.length) return
    undoStack.push(snapshotDoc(get()))
    const snap = redoStack.pop()!
    restoreDoc(snap, set, get())
    set({ undoCount: undoStack.length, redoCount: redoStack.length, status: 'Redo' })
  },

  setMode: (m) => set({ mode: m }),

  loadScene: (objects, opts) => {
    const prevShade = get().contextShade
    const prevVisible = get().contextVisible
    resetLive() // brand-new project: clears uv, atlas texture, per-screen textures
    authoredUV.clear()
    if (!opts?.keepOverrides) screenOverrides.clear()
    undoStack.length = 0
    redoStack.length = 0

    // split into screens (mappable) and context (dimmable reference geometry)
    const screenNames = opts?.screenNames
    const isScreen = (name: string) => !screenNames || screenNames.includes(name)

    const mapObjects: MapObject[] = []
    const mapShells: MapShell[] = []
    const contextShells: MapShell[] = []
    const importedObjects: string[] = [] // screens that arrived with a texture
    const uvObjects: string[] = [] // screens that arrived with UVs (texture or not)
    objects.forEach((o, oi) => {
      const he = buildHalfEdge(o.mesh)
      const shells = extractShells(he, new Set()).shells
      if (!isScreen(o.name)) {
        // reference geometry — render only, no mapping
        shells.forEach((shell, si) => contextShells.push({ id: oi * 1000 + si, shell, objName: o.name }))
        return
      }
      const shellIds: number[] = []
      const hasUVs = !!o.uvs // show imported UVs even when there's no texture
      const hasTexture = !!o.textureImage
      shells.forEach((shell, si) => {
        const id = oi * 1000 + si
        shellIds.push(id)
        mapShells.push({ id, shell, objName: o.name })
        if (hasUVs) {
          const uv = new Float32Array(shell.vertCount * 2)
          for (let v = 0; v < shell.vertCount; v++) {
            const ov = shell.toOrigVertex[v]
            uv[v * 2] = o.uvs![ov * 2]
            uv[v * 2 + 1] = o.uvs![ov * 2 + 1]
          }
          live.uv.set(id, uv)
          authoredUV.set(id, uv.slice()) // remember the import UV so M can restore it
        }
      })
      mapObjects.push({ name: o.name, mesh: o.mesh, he, shellIds, c4dGuid: o.c4dGuid, source: o.source })
      if (hasUVs) uvObjects.push(o.name)
      if (hasTexture) {
        const tex = new THREE.CanvasTexture(o.textureImage as HTMLCanvasElement)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.needsUpdate = true
        live.objTextures.set(o.name, tex)
        live.objAspect.set(o.name, o.textureAspect ?? 1)
        // A screen samples only the REGION of its texture that its authored UVs
        // cover — not the whole image. Use that as the content rect so auto-map
        // fits the screen to its own slice (e.g. one wall's part of a shared
        // panorama atlas) instead of stretching the entire texture across it.
        const uvs = o.uvs ?? new Float32Array(0)
        let bu0 = Infinity,
          bu1 = -Infinity,
          bv0 = Infinity,
          bv1 = -Infinity
        for (let i = 0; i < uvs.length; i += 2) {
          const u = uvs[i],
            v = uvs[i + 1]
          if (u < bu0) bu0 = u
          if (u > bu1) bu1 = u
          if (v < bv0) bv0 = v
          if (v > bv1) bv1 = v
        }
        const cl = (n: number) => Math.min(1, Math.max(0, n))
        live.objContentRect.set(
          o.name,
          bu1 - bu0 > 1e-4 && bv1 - bv0 > 1e-4
            ? { u0: cl(bu0), v0: cl(bv0), u1: cl(bu1), v1: cl(bv1) }
            : contentRectFromImage(o.textureImage as CanvasImageSource),
        )
        importedObjects.push(o.name)
      }
    })

    // re-apply the user's manual texture overrides by name (survives Refresh)
    if (opts?.keepOverrides) {
      for (const obj of mapObjects) {
        const ov = screenOverrides.get(obj.name)
        if (!ov) continue
        live.objTextures.get(obj.name)?.dispose()
        const tex = new THREE.Texture(ov.image as unknown as HTMLImageElement)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.needsUpdate = true
        live.objTextures.set(obj.name, tex)
        live.objAspect.set(obj.name, ov.aspect)
        live.objContentRect.set(obj.name, ov.contentRect ?? contentRectFromImage(ov.image))
        // pure-UV model: chunk screens have no separate cropped source texture
        live.objSource.get(obj.name)?.tex.dispose()
        live.objSource.delete(obj.name)
        if (!importedObjects.includes(obj.name)) importedObjects.push(obj.name)
      }
    }

    const anyImported = importedObjects.length > 0 // texture import (PSD/atlas flow)
    const anyUV = uvObjects.length > 0 // has UVs to show (incl. C4D objects w/o texture)
    if (anyImported) live.layeredMode = true
    live.dirty = true
    set({
      mode: 'map',
      mapObjects,
      mapShells,
      contextShells,
      contextCount: new Set(contextShells.map((s) => s.objName)).size,
      contextShade: opts?.keepOverrides ? prevShade : DEFAULT_CONTEXT_SHADE,
      contextVisible: opts?.keepOverrides ? prevVisible : true,
      atlas: null,
      regions: [],
      assignment: {},
      mapOrient: {},
      mapProjection: {},
      screenRes: {},
      mapObjFit: {},
      mapFitInfo: {},
      mapSelection: new Set(),
      mappedObjects: [...uvObjects],
      importedObjects,
      layeredMode: anyImported,
      psdLayerCount: anyImported ? importedObjects.length : 0,
      layerPoolCount: 0, // GLB textures are baked per-object, no name-match pool
      pendingImport: null,
      undoCount: 0,
      redoCount: 0,
      screenOrder: mapObjects.map((o) => o.name),
      hiddenScreens: [],
      soloScreen: null,
      selectedObject: mapObjects[0]?.name ?? null,
      hasUV: anyUV,
      isPacked: false,
      status: anyUV || anyImported
        ? `Imported ${mapObjects.length} screens${contextShells.length ? ` + reference geometry` : ''} — showing their UVs`
        : `Scene: ${mapObjects.length} objects`,
      uvVersion: get().uvVersion + 1,
    })

    // Imports show their OWN UVs by default — auto-map is opt-in (Preferences ▸
    // "Auto-map on import", or the per-screen Auto-map button / M). Refresh keeps
    // the user's work, so it never re-maps either.
    if (anyImported && !opts?.keepOverrides && get().autoMapOnImport) get().runMapping()
  },

  beginImport: (objects, fileName, media) => {
    set({ lastImportName: fileName })
    // single object → load directly; multiple → let the user pick screens
    if (objects.length <= 1) {
      get().loadScene(objects, { screenNames: objects.map((o) => o.name) })
      if (media?.length) void get().beginLink(media)
    } else {
      set({ pendingImport: { objects, fileName, media } })
    }
  },

  confirmImport: (screenNames) => {
    const pending = get().pendingImport
    if (!pending) return
    set({ pendingImport: null })
    // import EVERYTHING — chosen names are screens, the rest are reference geometry
    get().loadScene(pending.objects, { screenNames })
    // media imported with the model → open the link wizard (names pre-matched)
    if (pending.media?.length) void get().beginLink(pending.media)
  },

  cancelImport: () => set({ pendingImport: null }),

  setContextShade: (v) => set({ contextShade: Math.max(0, Math.min(1, v)) }),
  setContextVisible: (v) => set({ contextVisible: v }),

  loadDemoArena: async () => {
    get().loadScene(demoArena())
    // await the atlas so runMapping has correct atlas dimensions
    await get().loadAtlasUrl(makeDemoAtlas(), false)
    // demo ships pre-labeled regions, so matching is exact
    const regions = demoRegions()
    const names = get().mapObjects.map((o) => o.name)
    set({ regions, assignment: matchByLabels(names, regions) })
    get().runMapping()
    // baseline = the freshly-mapped demo; nothing to undo before this
    undoStack.length = 0
    redoStack.length = 0
    set({
      undoCount: 0,
      redoCount: 0,
      status: 'Demo arena loaded & mapped — tweak assignments on the right',
    })
  },

  loadDemoPsd: async () => {
    get().loadScene(demoArena())
    try {
      const res = await fetch('/demo-screens.psd')
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      await get().loadPsd(new File([blob], 'demo-screens.psd'))
    } catch {
      set({ status: 'Demo PSD not found — import a .psd instead' })
    }
  },

  loadAtlasUrl: async (url, detect) => {
    const img = await loadImage(url)
    const tex = new THREE.Texture(img)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    live.atlasTexture = tex
    live.atlasAspect = img.width / img.height
    live.layeredMode = false
    live.dirty = true
    set({ layeredMode: false, importedObjects: [], layerPoolCount: 0 })
    if (detect) {
      const oldRegions = get().regions
      const oldAssign = get().assignment
      const regions = detectRegions(img)
      // Preserve assignments across re-detection: re-match each assigned object
      // to the new region nearest the old region's centre.
      const assignment: Record<string, number> = {}
      const center = (r: Region) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2] as const
      for (const [name, oldId] of Object.entries(oldAssign)) {
        const old = oldRegions.find((r) => r.id === oldId)
        if (!old) continue
        const [ox, oy] = center(old)
        let best = -1
        let bd = Infinity
        for (const nr of regions) {
          const [cx, cy] = center(nr)
          const d = (cx - ox) ** 2 + (cy - oy) ** 2
          if (d < bd) {
            bd = d
            best = nr.id
          }
        }
        if (best >= 0) assignment[name] = best
      }
      set({
        atlas: { url, width: img.width, height: img.height },
        regions,
        assignment,
        uvVersion: get().uvVersion + 1,
        status: `Map loaded · ${regions.length} regions detected`,
      })
      if (Object.keys(assignment).length) get().runMapping()
    } else {
      set({
        atlas: { url, width: img.width, height: img.height },
        regions: get().regions,
        uvVersion: get().uvVersion + 1,
        status: 'Map loaded',
      })
    }
  },

  // Load a PSD whose layers are named like the objects (OBJECT NAME == LAYER
  // NAME). Two layouts are handled automatically:
  //  - SIDE-BY-SIDE: each layer sits in its own spot of one canvas → composite
  //    becomes a shared atlas and each object maps to its layer's region.
  //  - OVERLAPPING (each layer is a full-frame screen) → each object gets its
  //    own layer texture (trimmed to its opaque content).
  loadPsd: async (file) => {
    set({ status: `Reading ${file.name}…` })
    const psd = await loadPsdFile(file)
    for (const t of live.objTextures.values()) t.dispose()
    live.objTextures.clear()
    live.objAspect.clear()
    live.objContentRect.clear()
    for (const s of live.objSource.values()) s.tex.dispose()
    live.objSource.clear()
    live.layerPool = []
    const objects = get().mapObjects

    const W = psd.width || 1
    const H = psd.height || 1
    if (!psd.layers.length) {
      set({ status: 'PSD has no layers' })
      return
    }

    // opaque content of each layer, placed in the canvas
    const placed = psd.layers.map((l) => {
      const ob = opaqueBBoxNorm(l.canvas) ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
      return {
        l,
        x0: (l.left + ob.x0 * l.width) / W,
        y0: (l.top + ob.y0 * l.height) / H,
        x1: (l.left + ob.x1 * l.width) / W,
        y1: (l.top + ob.y1 * l.height) / H,
      }
    })
    const totalArea = placed.reduce((s, p) => s + Math.max(0, (p.x1 - p.x0) * (p.y1 - p.y0)), 0)
    // layers tiling the canvas (~disjoint) → side-by-side; heavy overlap → per-screen
    const sideBySide = psd.layers.length > 1 && totalArea <= 1.4

    if (!sideBySide) {
      // OVERLAPPING / full-frame: each layer is its own screen texture
      live.layerPool = psd.layers.map((l) => ({
        name: l.name,
        image: l.canvas,
        aspect: l.width / Math.max(l.height, 1),
      }))
      const matched = matchLayerPool(objects.map((o) => o.name))
      live.layeredMode = true
      live.dirty = true
      set({
        layeredMode: true,
        psdLayerCount: psd.layers.length,
        layerPoolCount: live.layerPool.length,
        atlas: null,
        regions: [],
        assignment: {},
        mapFitInfo: {},
        importedObjects: [],
        selectedObject: [...live.objTextures.keys()][0] ?? get().selectedObject,
        status: `PSD · ${psd.layers.length} layers · ${matched} matched to screens`,
      })
      get().runMapping()
      undoStack.length = 0
      redoStack.length = 0
      set({ undoCount: 0, redoCount: 0 })
      return
    }

    // SIDE-BY-SIDE: composite all layers → one shared atlas; each layer's opaque
    // bounds become that object's region.
    const composite = document.createElement('canvas')
    composite.width = W
    composite.height = H
    const cctx = composite.getContext('2d')!
    for (const l of psd.layers) cctx.drawImage(l.canvas, l.left, l.top)
    live.atlasTexture = new THREE.CanvasTexture(composite)
    live.atlasTexture.colorSpace = THREE.SRGBColorSpace
    live.atlasTexture.needsUpdate = true
    live.atlasAspect = W / H
    live.layeredMode = false
    live.dirty = true

    const regions: Region[] = placed.map((p, i) => ({
      id: i,
      x0: p.x0,
      y0: p.y0,
      x1: p.x1,
      y1: p.y1,
      label: p.l.name,
      color: [128, 128, 128],
      areaFrac: Math.max(0, (p.x1 - p.x0) * (p.y1 - p.y0)),
    }))
    // exact-first, one-to-one — a layer named per screen maps to that screen only
    const assignment = matchNamesToLabels(
      objects.map((o) => o.name),
      regions.map((r) => ({ id: r.id, label: r.label ?? '' })),
    )
    const matched = Object.keys(assignment).length
    set({
      layeredMode: false,
      psdLayerCount: psd.layers.length,
      layerPoolCount: 0,
      atlas: { url: '', width: W, height: H },
      regions,
      assignment,
      mapFitInfo: {},
      importedObjects: [],
      status: `PSD · ${psd.layers.length} layers · ${matched} screens matched to layers by name`,
    })
    get().runMapping()
    undoStack.length = 0
    redoStack.length = 0
    set({ undoCount: 0, redoCount: 0 })
  },

  // Separate images, one per screen — matched by FILENAME to screen names
  // (same name-matching logic as PSD layers). `merge` keeps existing per-screen
  // textures and adds/updates only the imported ones (incremental build-up);
  // otherwise the layered set is replaced. Unmatched images fall back to the
  // first screen still without content, then to the active screen.
  loadImages: async (files, merge = false) => {
    set({ status: `Reading ${files.length} image${files.length > 1 ? 's' : ''}…` })
    const imgs = await Promise.all(
      files.map(async (f) => {
        const img = await loadImage(URL.createObjectURL(f))
        return { name: f.name.replace(/\.[^.]+$/, ''), img, width: img.width, height: img.height }
      }),
    )

    if (!merge) {
      for (const t of live.objTextures.values()) t.dispose()
      live.objTextures.clear()
      live.objAspect.clear()
      for (const s of live.objSource.values()) s.tex.dispose()
      live.objSource.clear()
      live.layerPool = []
    }
    // remember the imported images (by file name) so Auto-match can re-assign
    for (const im of imgs)
      live.layerPool.push({ name: im.name, image: im.img, aspect: im.width / Math.max(im.height, 1) })

    const assign = (objName: string, im: (typeof imgs)[number]) => {
      live.objTextures.get(objName)?.dispose()
      const tex = new THREE.Texture(im.img)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      live.objTextures.set(objName, tex)
      live.objAspect.set(objName, im.width / Math.max(im.height, 1))
      live.objContentRect.set(objName, contentRectFromImage(im.img))
    }

    const objects = get().mapObjects
    let matched = 0
    for (const im of imgs) {
      // best screen by filename
      let best = -1
      let bestSim = 0
      objects.forEach((o, i) => {
        const s = similarity(o.name, im.name)
        if (s > bestSim) {
          bestSim = s
          best = i
        }
      })
      if (best >= 0 && bestSim >= 0.45) {
        assign(objects[best].name, im)
        matched++
        continue
      }
      // fallback: first screen still without content, else the active screen
      const empty = objects.find((o) => !live.objTextures.has(o.name))
      const target = empty?.name ?? get().selectedObject ?? objects[0]?.name
      if (target) {
        assign(target, im)
        matched++
      }
    }

    live.layeredMode = true
    live.dirty = true
    set({
      layeredMode: true,
      psdLayerCount: live.objTextures.size,
      layerPoolCount: live.layerPool.length,
      atlas: null,
      regions: [],
      assignment: {},
      importedObjects: merge ? get().importedObjects : [],
      selectedObject: get().selectedObject ?? [...live.objTextures.keys()][0] ?? null,
      status: merge
        ? `Added ${imgs.length} image${imgs.length > 1 ? 's' : ''} · ${live.objTextures.size} screens have content`
        : `${imgs.length} images · ${matched} matched to screens by name`,
    })
    get().runMapping()
    if (!merge) {
      undoStack.length = 0
      redoStack.length = 0
      set({ undoCount: 0, redoCount: 0 })
    }
  },

  // Assign one image to a SPECIFIC screen (regardless of filename), entering /
  // staying in layered mode. Used by the per-screen "add / replace" controls.
  setObjectImage: async (objName, file, opts) => {
    // PSDs can't be decoded by an <img>; flatten to the composite canvas instead.
    // Detect PSD by content (magic bytes "8BPS"), not extension — source files
    // are often exported without a .psd suffix.
    let source: CanvasImageSource
    let chunkRect: RectUV | null = null
    try {
      if (await isPsd(file)) {
        const psd = await loadPsdFile(file)
        // A multi-layer PSD holds one slice per screen (each layer positioned in
        // the doc, rest alpha). Use the EXPLICIT layer when given (manual link in
        // the wizard), else the layer that matches THIS screen by name.
        let layer = opts?.layerName
          ? psd.layers.find((l) => l.name === opts.layerName)
          : psd.layers.find((l) => normalize(l.name) === normalize(objName))
        if (!layer && !opts?.layerName && psd.layers.length > 1) {
          let best = -1
          let bestSim = 0
          psd.layers.forEach((l, i) => {
            const sim = similarity(objName, l.name)
            if (sim > bestSim) {
              bestSim = sim
              best = i
            }
          })
          if (bestSim >= 0.82) layer = psd.layers[best]
        }
        const W = psd.width || 1
        const H = psd.height || 1
        if (layer && (layer.width < W || layer.height < H)) {
          // CHUNK of a bigger PSD: sample the WHOLE composite and place this
          // screen in its slice via UVs — a pure-UV mapping (nothing is cropped),
          // so the slice can be moved/scaled by editing UVs. The slice is the
          // layer's bounds in the texture's UV space (image y-down → v-up).
          source = psd.composite ?? flattenPsdLayers(psd)
          chunkRect = {
            u0: layer.left / W,
            v0: 1 - (layer.top + layer.height) / H,
            u1: (layer.left + layer.width) / W,
            v1: 1 - layer.top / H,
          }
        } else {
          source = layer?.canvas ?? psd.composite ?? flattenPsdLayers(psd)
        }
      } else {
        source = await loadImage(URL.createObjectURL(file))
      }
    } catch {
      set({ status: `Couldn't read “${file.name}” — not a supported image or PSD` })
      return
    }
    const aspect = (source as { width: number }).width / Math.max((source as { height: number }).height, 1)
    live.objTextures.get(objName)?.dispose()
    const tex = new THREE.Texture(source)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    live.objTextures.set(objName, tex)
    live.objAspect.set(objName, aspect)
    live.objContentRect.set(objName, chunkRect ?? contentRectFromImage(source))
    // pure-UV model: a chunk screen carries its slice in its UVs (fit to the
    // content rect above), not a separate cropped source — so no objSource.
    live.objSource.get(objName)?.tex.dispose()
    live.objSource.delete(objName)
    // remember as an override so it survives a model Refresh
    screenOverrides.set(objName, { image: source, aspect, contentRect: chunkRect ?? undefined })
    live.layeredMode = true
    live.dirty = true
    set({
      layeredMode: true,
      psdLayerCount: live.objTextures.size,
      atlas: null,
      regions: [],
      assignment: {},
      selectedObject: objName,
      status: `Set content for ${objName}`,
    })
    if (opts?.remap !== false) get().runMapping()
  },

  applyMediaFiles: async (files) => {
    const arr = Array.from(files)
    if (!arr.length) return 0
    // pre-read PSD layer names; everything else is a named image
    const psds: { file: File; layers: string[] }[] = []
    const imgs: { file: File; name: string }[] = []
    for (const f of arr) {
      if (await isPsd(f)) {
        try {
          const psd = await loadPsdFile(f)
          psds.push({ file: f, layers: psd.layers.map((l) => l.name) })
        } catch {
          /* unreadable PSD — skip */
        }
      } else {
        imgs.push({ file: f, name: f.name.replace(/\.[^.]+$/, '') })
      }
    }
    const stem = (n: string) => n.replace(/\.[^.]+$/, '')
    const match = (a: string, b: string) => normalize(a) === normalize(b) || similarity(a, b) >= 0.82
    let matched = 0
    for (const obj of get().mapObjects) {
      let file: File | null = null
      // 1. a PSD with a LAYER named for this screen (setObjectImage picks the layer)
      const byLayer = psds.find((p) => p.layers.some((ln) => match(ln, obj.name)))
      if (byLayer) file = byLayer.file
      // 2. a PSD whose FILE NAME is this screen (single-screen PSD → composite)
      if (!file) file = psds.find((p) => match(stem(p.file.name), obj.name))?.file ?? null
      // 3. an image whose file name is this screen
      if (!file) file = imgs.find((im) => match(im.name, obj.name))?.file ?? null
      if (file) {
        await get().setObjectImage(obj.name, file, { remap: false }) // map once after
        matched++
      }
    }
    if (matched) {
      get().runMapping()
      set({ status: `Applied media to ${matched} screen${matched === 1 ? '' : 's'}` })
    }
    return matched
  },

  beginLink: async (files) => {
    const items = await parseMediaItems(Array.from(files), 0)
    if (!items.length) return
    const objects = get().mapObjects.map((o) => o.name)
    set({ pendingLink: { objects, items, links: suggestLinks(objects, items) } })
  },

  // Open the link wizard for the current screens with NO media yet — the user
  // adds PSDs/images inside it (used after a Cinema 4D Send).
  openLinkWizard: () => {
    const objects = get().mapObjects.map((o) => o.name)
    if (!objects.length) return
    set({ pendingLink: { objects, items: [], links: {} } })
  },

  // Add media into the open wizard: parse new files, append, re-suggest links
  // for still-unlinked screens (keeps the user's manual choices).
  addLinkMedia: async (files) => {
    const pl = get().pendingLink
    if (!pl) return
    const nextId = pl.items.reduce((m, i) => Math.max(m, i.id), -1) + 1
    const more = await parseMediaItems(Array.from(files), nextId)
    if (!more.length) return
    const items = [...pl.items, ...more]
    set({ pendingLink: { ...pl, items, links: suggestLinks(pl.objects, items, pl.links) } })
  },

  confirmLink: async (links) => {
    const pl = get().pendingLink
    set({ pendingLink: null })
    if (!pl) return
    const byId = new Map(pl.items.map((i) => [i.id, i]))
    let applied = 0
    for (const [objName, itemId] of Object.entries(links)) {
      const item = byId.get(itemId)
      if (!item) continue
      await get().setObjectImage(objName, item.file, { remap: false, layerName: item.layerName })
      applied++
    }
    if (applied) {
      // respect the no-auto-map preference: by default show the media through the
      // screens' existing UVs; the user maps on demand (Auto-map / M).
      if (get().autoMapOnImport) get().runMapping()
      const n = `${applied} screen${applied === 1 ? '' : 's'}`
      const msg = get().autoMapOnImport
        ? `Linked media to ${n}`
        : `Linked media to ${n} — Auto-map to fit`
      set({ status: msg })
      get().pushToast('good', msg)
    }
  },

  cancelLink: () => set({ pendingLink: null }),

  // Remove a screen's content; it reverts to a solid placeholder colour.
  removeObjectTexture: (objName) => {
    live.objTextures.get(objName)?.dispose()
    live.objTextures.delete(objName)
    live.objAspect.delete(objName)
    live.objContentRect.delete(objName)
    live.objSource.get(objName)?.tex.dispose()
    live.objSource.delete(objName)
    screenOverrides.delete(objName)
    live.dirty = true
    set({ psdLayerCount: live.objTextures.size, status: `Removed content from ${objName}` })
    get().runMapping()
  },

  // Reorder a screen in the draw stack (later = drawn on top, for overlaps).
  moveScreen: (objName, dir) => {
    const order = get().screenOrder.length
      ? [...get().screenOrder]
      : get().mapObjects.map((o) => o.name)
    const i = order.indexOf(objName)
    if (i < 0) return
    const j = dir === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    set({ screenOrder: order, uvVersion: get().uvVersion + 1 })
  },

  toggleHidden: (objName) => {
    const hidden = new Set(get().hiddenScreens)
    hidden.has(objName) ? hidden.delete(objName) : hidden.add(objName)
    set({ hiddenScreens: [...hidden], uvVersion: get().uvVersion + 1 })
  },

  toggleSolo: (objName) => {
    set({
      soloScreen: get().soloScreen === objName ? null : objName,
      uvVersion: get().uvVersion + 1,
    })
  },

  autoMatch: async () => {
    const { atlas, regions, mapObjects, layeredMode } = get()
    const names = mapObjects.map((o) => o.name)
    // Layer names take priority: if we have named layers, match screens to them.
    if (layeredMode && live.layerPool.length) {
      const matched = matchLayerPool(names)
      live.dirty = true
      set({
        psdLayerCount: live.layerPool.length,
        uvVersion: get().uvVersion + 1,
        status: `Auto-matched ${matched}/${names.length} screens to layers by name`,
      })
      get().runMapping()
      return
    }
    // Otherwise (a single flat image) read names off the image with OCR.
    if (!atlas || !regions.length) {
      set({ status: 'Load a map with named layers, or a labelled atlas, to auto-match' })
      return
    }
    set({ ocrBusy: true, status: 'Reading region labels (OCR)…' })
    try {
      const img = await loadImage(atlas.url)
      const labeled = await ocrRegionLabels(img, regions.map((r) => ({ ...r })))
      const assignment = matchByLabels(names, labeled)
      set({
        regions: labeled,
        assignment,
        status: `Auto-matched ${Object.keys(assignment).length}/${names.length} objects by label`,
      })
    } catch {
      set({ status: 'OCR unavailable — assign regions manually' })
    } finally {
      set({ ocrBusy: false })
    }
  },

  assign: (objName, regionId) => {
    const assignment = { ...get().assignment }
    if (regionId == null) delete assignment[objName]
    else assignment[objName] = regionId
    set({ assignment })
  },

  rotateObject: (objName, dir) => {
    const g = get()
    const obj = g.mapObjects.find((o) => o.name === objName)
    if (!obj) return
    get().pushUndo()
    const cur = g.mapOrient[objName] ?? { rot: 0, flipX: false, flipY: false }
    const step = dir === 'cw' ? 270 : 90
    set({ mapOrient: { ...g.mapOrient, [objName]: { ...cur, rot: (cur.rot + step) % 360 } } })
    // rotate the existing island in place (no re-flatten — preserves edits)
    if (transformObjectUV(obj, snapshot(get()), { rot: step })) {
      live.dirty = true
      set({ uvVersion: get().uvVersion + 1, status: `Rotated ${objName} (M to re-map)` })
    }
  },

  flipObject: (objName, axis) => {
    const g = get()
    const obj = g.mapObjects.find((o) => o.name === objName)
    if (!obj) return
    get().pushUndo()
    const cur = g.mapOrient[objName] ?? { rot: 0, flipX: false, flipY: false }
    const next = axis === 'x' ? { ...cur, flipX: !cur.flipX } : { ...cur, flipY: !cur.flipY }
    set({ mapOrient: { ...g.mapOrient, [objName]: next } })
    if (transformObjectUV(obj, snapshot(get()), axis === 'x' ? { flipX: true } : { flipY: true })) {
      live.dirty = true
      set({ uvVersion: get().uvVersion + 1, status: `Flipped ${objName} (M to re-map)` })
    }
  },

  scaleSelection: (factor) => {
    const sel = get().mapSelection
    if (!sel.size) return
    get().pushUndo()
    let cx = 0,
      cy = 0,
      n = 0
    const items: [Float32Array, number][] = []
    for (const k of sel) {
      const [sid, vs] = k.split(':')
      const uv = live.uv.get(Number(sid))
      if (!uv) continue
      const vi = Number(vs)
      cx += uv[vi * 2]
      cy += uv[vi * 2 + 1]
      n++
      items.push([uv, vi])
    }
    if (!n) return
    cx /= n
    cy /= n
    for (const [uv, vi] of items) {
      uv[vi * 2] = cx + (uv[vi * 2] - cx) * factor
      uv[vi * 2 + 1] = cy + (uv[vi * 2 + 1] - cy) * factor
    }
    live.dirty = true
    set({ uvVersion: get().uvVersion + 1 })
  },

  // Uniform (proportional) scale of a whole screen's UV island about its centre.
  // Raw u,v scale uniformly → the island keeps its shape (and its displayed shape,
  // since the view scales u by aspect equally). Undoable; safe to call repeatedly.
  scaleObject: (objName, factor) => {
    const g = get()
    const obj = g.mapObjects.find((o) => o.name === objName)
    if (!obj) return
    const arrays = obj.shellIds.map((id) => live.uv.get(id)).filter(Boolean) as Float32Array[]
    if (!arrays.length) return
    get().pushUndo()
    let mnx = Infinity,
      mxx = -Infinity,
      mny = Infinity,
      mxy = -Infinity
    for (const a of arrays)
      for (let i = 0; i < a.length; i += 2) {
        if (a[i] < mnx) mnx = a[i]
        if (a[i] > mxx) mxx = a[i]
        if (a[i + 1] < mny) mny = a[i + 1]
        if (a[i + 1] > mxy) mxy = a[i + 1]
      }
    const cx = (mnx + mxx) / 2
    const cy = (mny + mxy) / 2
    for (const a of arrays)
      for (let i = 0; i < a.length; i += 2) {
        a[i] = cx + (a[i] - cx) * factor
        a[i + 1] = cy + (a[i + 1] - cy) * factor
      }
    live.dirty = true
    set({ uvVersion: g.uvVersion + 1, status: `Scaled ${objName}` })
  },

  setScaleMode: (on) => set({ scaleMode: on }),

  resetObjectOrient: (objName) => {
    const mapOrient = { ...get().mapOrient }
    delete mapOrient[objName]
    const mapObjFit = { ...get().mapObjFit }
    delete mapObjFit[objName]
    set({ mapOrient, mapObjFit })
    get().runMappingFor(objName)
  },

  setObjectProjection: (objName, p) => {
    get().pushUndo() // snapshot BEFORE the projection change so undo reverts it
    const mapProjection = { ...get().mapProjection }
    if (p === 'auto') delete mapProjection[objName]
    else mapProjection[objName] = p
    set({ mapProjection })
    get().runMappingFor(objName, { noUndo: true })
  },

  setScreenRes: (objName, w, h) => {
    const screenRes = { ...get().screenRes }
    if (w > 0 && h > 0) screenRes[objName] = { w: Math.round(w), h: Math.round(h) }
    else delete screenRes[objName] // 0×0 → back to auto (media dimensions)
    set({ screenRes })
  },

  setMapFill: (fill) => {
    set({ mapFill: fill })
    get().runMapping()
  },

  setAutoMapOnImport: (v) => {
    try {
      localStorage.setItem('uvstudio.autoMapOnImport', v ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ autoMapOnImport: v })
  },

  setObjectFit: (objName, fit) => {
    const mapObjFit = { ...get().mapObjFit }
    if (fit === 'default') delete mapObjFit[objName]
    else mapObjFit[objName] = fit
    set({ mapObjFit })
    get().runMappingFor(objName)
  },

  // Explicit per-screen auto-map: re-projects when a target exists (PSD layer,
  // atlas region). For GLB-imported screens with no content target yet, just
  // confirms the authored UV as mapped without overwriting it. Undoable.
  runMappingFor: (objName, opts) => {
    const g = get()
    const obj = g.mapObjects.find((o) => o.name === objName)
    if (!obj) return
    // re-mapping establishes a new baseline → reset the stretch reference
    obj.shellIds.forEach((id) => live.refDensity.delete(id))

    // Guard: if the screen has authored UVs from import AND there is no content
    // target to map to (no PSD/images in pool, no atlas region assigned), snap
    // it BACK to its authored mapping. Re-projecting to {0,0,1,1} would trash
    // panorama slices, and doing nothing leaves a stale manual move in place.
    const hasTarget =
      !g.layeredMode                        // atlas mode — region assignment is the target
      || live.layerPool.length > 0          // PSD/images were loaded
      || g.assignment[objName] != null       // manual region assignment
      || live.objTextures.has(objName)       // the screen has its own content to fit
    if (g.importedObjects.includes(objName) && !hasTarget && obj.shellIds.some((id) => authoredUV.has(id))) {
      if (!opts?.noUndo) get().pushUndo()
      obj.shellIds.forEach((id) => {
        const a = authoredUV.get(id)
        if (a) live.uv.set(id, a.slice())
      })
      const mapped = new Set(g.mappedObjects)
      mapped.add(objName)
      live.dirty = true
      set({
        mappedObjects: [...mapped],
        hasUV: true,
        uvVersion: g.uvVersion + 1,
        status: `${objName}: restored authored UV`,
      })
      return
    }

    if (!opts?.noUndo) get().pushUndo()
    // a re-projected screen is no longer "as-imported"
    const importedObjects = g.importedObjects.filter((n) => n !== objName)
    const shellById = new Map(g.mapShells.map((m) => [m.id, m.shell]))
    const beforeVerts = obj.shellIds.map((id) => shellById.get(id)?.vertCount)
    const beforeUV = obj.shellIds.map((id) => live.uv.get(id)?.slice())
    const s = mapObjectUV(obj, snapshot({ ...g, importedObjects }), shellById)
    // a projection may have changed a shell's topology (seam-split) → new mapShells
    // array ref so the 3D geometry rebuilds at the new vertex count
    const topoChanged = obj.shellIds.some((id, k) => shellById.get(id)?.vertCount !== beforeVerts[k])
    // did re-mapping actually move anything? (so a no-op gives honest feedback)
    const changed =
      topoChanged ||
      obj.shellIds.some((id, k) => {
        const a = live.uv.get(id)
        const b = beforeUV[k]
        if (!a || !b || a.length !== b.length) return true
        for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-5) return true
        return false
      })
    const mapped = new Set(g.mappedObjects)
    const fitInfo = { ...g.mapFitInfo }
    if (s !== null) {
      mapped.add(objName)
      fitInfo[objName] = { stretch: s }
    } else {
      mapped.delete(objName)
      delete fitInfo[objName]
    }
    live.dirty = true
    set({
      mappedObjects: [...mapped],
      mapFitInfo: fitInfo,
      importedObjects,
      hasUV: mapped.size > 0,
      uvVersion: g.uvVersion + 1,
      ...(topoChanged ? { mapShells: [...g.mapShells] } : {}),
      status:
        s === null
          ? `${objName} unassigned`
          : changed
            ? `Re-mapped ${objName}`
            : `${objName} already mapped — nothing to change`,
    })
  },

  setEditMode: (m) => set({ editMode: m }),
  setMapSelection: (s) => set({ mapSelection: s }),
  clearMapSelection: () => set({ mapSelection: new Set() }),

  runMapping: (opts) => {
    get().pushUndo()
    const g = get()
    const st = snapshot(g)
    const shellById = new Map(g.mapShells.map((m) => [m.id, m.shell]))
    const beforeVerts = new Map(g.mapShells.map((m) => [m.id, m.shell.vertCount]))
    live.refDensity.clear() // every screen gets a fresh mapped baseline
    const mapped: string[] = []
    const fitInfo: Record<string, { stretch: number }> = {}
    const imported = new Set(g.importedObjects)
    for (const obj of g.mapObjects) {
      // A screen has a fresh content target when it's atlas-mode, or has a
      // PSD/image layer pool, or an explicit region assignment.
      const hasTarget =
        !g.layeredMode ||
        live.layerPool.length > 0 ||
        g.assignment[obj.name] != null ||
        live.objTextures.has(obj.name) // the screen has its own content to fit
      // Imported screen with no target → snap back to its authored UV (resets a
      // manual move/rotate); never re-project it onto a shared panorama.
      if (imported.has(obj.name) && !hasTarget) {
        if (obj.shellIds.some((id) => authoredUV.has(id))) {
          obj.shellIds.forEach((id) => {
            const a = authoredUV.get(id)
            if (a) live.uv.set(id, a.slice())
          })
        }
        mapped.push(obj.name)
        continue
      }
      const s = mapObjectUV(obj, st, shellById)
      if (s !== null) {
        mapped.push(obj.name)
        fitInfo[obj.name] = { stretch: s }
      }
    }
    live.packed = null
    live.dirty = true
    // any projection seam-split changed a shell's vertex count → rebuild geometry
    const topoChanged = g.mapShells.some((m) => m.shell.vertCount !== beforeVerts.get(m.id))
    set({
      mappedObjects: mapped,
      mapFitInfo: fitInfo,
      hasUV: mapped.length > 0,
      uvVersion: g.uvVersion + 1,
      ...(topoChanged ? { mapShells: [...g.mapShells] } : {}),
      status: `Mapped ${mapped.length}/${g.mapObjects.length} objects to ${
        g.layeredMode ? 'per-screen layers' : 'the atlas'
      }`,
    })
    // toast only on an explicit user action (the Auto-map button) — runMapping is
    // also called internally (region change, remove content, …) and must stay quiet
    if (opts?.announce) {
      if (mapped.length)
        get().pushToast('good', `Mapped ${mapped.length}/${g.mapObjects.length} screen${g.mapObjects.length === 1 ? '' : 's'}`)
      else
        get().pushToast('info', 'Nothing to map yet — add images or PSD layers to the screens first')
    }
  },

  selectObject: (name) =>
    // Switching to a different screen drops any sub-element (vertex/edge/face)
    // selection — it belonged to the old screen. Otherwise a stale selection
    // would make the transform gizmo edit the previously-selected object.
    set((s) =>
      name === s.selectedObject
        ? { selectedObject: name }
        : { selectedObject: name, mapSelection: new Set<string>() },
    ),

  exportGltf: async () => {
    const g = get()
    const specs = screenSpecs(g)
    const buf = await buildMappedGlb(g.mapShells, g.layeredMode, new Map(specs.map((s) => [s.name, s])))
    if (!buf) {
      set({ status: 'Nothing to export — map first' })
      get().pushToast('warn', 'Nothing to export — map a screen first')
      return
    }
    const download = (data: BlobPart, name: string, type: string) => {
      const url = URL.createObjectURL(new Blob([data], { type }))
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    }
    // desktop: native Save dialog (writes GLB + sidecar next to it); web: download both
    if (linkBridge.isDesktop()) {
      const saved = await linkBridge.saveGlb('screen_map.glb', buf, screenManifest(specs))
      set({ status: saved ? `Exported to ${saved}` : 'Export cancelled' })
      if (saved) get().pushToast('good', `Exported to ${saved}`)
      return
    }
    download(buf, 'screen_map.glb', 'model/gltf-binary')
    download(screenManifest(specs), 'screen_map.json', 'application/json')
    set({ status: `Exported ${specs.length} screens — screen_map.glb + .json (LED sizes)` })
    get().pushToast('good', `Exported ${specs.length} screen${specs.length === 1 ? '' : 's'} — screen_map.glb + .json`)
  },

  sendToC4D: async () => {
    const g = get()
    const specs = screenSpecs(g)
    // Bridge-sourced objects (with a c4dGuid) get the LOSSLESS path: send only
    // per-polygon-corner UVs, applied onto C4D's existing objects. Manual-import
    // objects (no guid, no provenance) fall back to a mapped GLB.
    const shellsByObj = new Map<string, Shell[]>()
    for (const ms of g.mapShells) {
      const arr = shellsByObj.get(ms.objName) ?? []
      // CRITICAL: live.uv is keyed by the MapShell id (ms.id = oi*1000+si), but
      // shell.id is a local 0-based index — identical across objects (every
      // object's first shell is id 0). Using shell.id made every object read
      // shell-0's UVs (the first object / floor), so each got the FLOOR's unwrap
      // → tangled in C4D. Override the shell id with the live.uv key.
      arr.push({ ...ms.shell, id: ms.id })
      shellsByObj.set(ms.objName, arr)
    }
    // Send the app's UVs EXACTLY as shown — no per-object normalize. Screens that
    // SHARE a material (e.g. the 4 walls on Wall_Material) are packed into that
    // material's shared UV space, each a slice; objects with their own material
    // fill [0,1]. Normalizing each to [0,1] would overlap the shared-material
    // screens. The per-object lookup (ms.id) is what makes this correct.
    const uvInputs: ReturnObjectInput[] = g.mapObjects
      .filter((o) => o.c4dGuid)
      .map((o) => ({
        name: o.name,
        guid: o.c4dGuid!,
        polyCount: o.mesh.faces.length,
        shells: shellsByObj.get(o.name) ?? [],
        uv: (shellId: number) => live.uv.get(shellId),
      }))

    if (!linkBridge.linkSupported()) {
      set({ status: 'Folder bridge needs the desktop app or a Chromium browser' })
      return
    }
    if (!linkBridge.isConnected()) {
      set({ status: 'Choose the shared C4D link folder…' })
      if (!(await linkBridge.connect())) {
        set({ status: 'Send cancelled — no link folder chosen' })
        return
      }
    }
    set({ status: 'Sending to Cinema 4D…' })
    try {
      if (uvInputs.length) {
        const payload = buildReturnPayload(uvInputs, Date.now())
        payload.screens = specs
        await linkBridge.sendUVs(payload)
        set({ status: `Sent UVs for ${uvInputs.length} object${uvInputs.length === 1 ? '' : 's'} — waiting for confirmation…` })
        // Don't quit yet — wait for the plugin's ack so a partial failure is SEEN
        // (handleUvAck quits on success, stays open + warns on missed/error).
        // Fallback: if no ack lands (DCC closed — it applies on next launch), quit.
        armSendQuit()
      } else {
        const buf = await buildMappedGlb(g.mapShells, g.layeredMode, new Map(specs.map((s) => [s.name, s])))
        if (!buf) {
          set({ status: 'Nothing to send — map first' })
          return
        }
        await linkBridge.sendGlb(buf, specs)
        set({ status: `Sent ${specs.length} screens to Cinema 4D (link folder)` })
        void linkBridge.quitApp() // close UV Studio after sending; C4D comes forward
      }
    } catch {
      set({ status: 'Send failed — check the link folder' })
      get().pushToast('bad', 'Send failed — check the link folder in Preferences')
    }
  },

  handleUvAck: (ack) => {
    if (ack.stage === 'received') return // heartbeat — the result ack follows
    const wasSending = disarmSendQuit()
    const dcc = ack.app === 'blender' ? 'Blender' : 'Cinema 4D'
    if (ack.error) {
      const last = ack.error.trim().split('\n').pop() || 'error'
      set({ status: `${dcc} apply FAILED: ${last}` })
      get().pushToast('bad', `${dcc} apply failed: ${last}`)
      void linkBridge.focusWindow() // stay open — the user must see this
      return
    }
    const plural = ack.applied === 1 ? '' : 's'
    if (ack.missed?.length) {
      const names =
        ack.missed.slice(0, 3).join(', ') +
        (ack.missed.length > 3 ? ` +${ack.missed.length - 3} more` : '')
      set({
        status: `⚠ ${dcc} applied UVs to ${ack.applied} object${plural} — couldn't find: ${names}`,
      })
      get().pushToast('warn', `${dcc} applied ${ack.applied} object${plural} — couldn't find: ${names}`)
      void linkBridge.focusWindow() // partial failure → stay open and show it
      return
    }
    set({ status: `${dcc} applied UVs to ${ack.applied} object${plural} ✓` })
    get().pushToast('good', `${dcc} applied UVs to ${ack.applied} object${plural}`)
    // clean success right after a Send → hand off to the DCC and close
    if (wasSending) setTimeout(() => void linkBridge.quitApp(), 1200)
  },

  loadMesh: (mesh) => {
    const he = buildHalfEdge(mesh)
    resetLive()
    set({
      mesh,
      he,
      modelName: mesh.name,
      shells: [],
      shellSet: null,
      hasUV: false,
      isPacked: false,
      isRelaxing: false,
      overallDistortion: 0,
      selectedShells: new Set(),
      uvVersion: get().uvVersion + 1,
      status: `${mesh.name} · ${mesh.positions.length / 3} verts · ${mesh.faces.length} faces`,
    })
  },

  loadSample: (key) => {
    const def = SAMPLES.find((s) => s.key === key)
    if (!def) return
    get().loadMesh(def.make())
  },

  setTool: (t) => set({ tool: t }),
  setDisplay: (key, value) => set({ display: { ...get().display, [key]: value } }),

  flatten: () => {
    const { he } = get()
    if (!he) return
    const shellSet = extractShells(he)
    const shells = shellSet.shells

    resetLive()
    live.topoVersion++
    const w = ensureWorker(get, set)
    const job = ++jobCounter
    const serial: SerializedShell[] = shells.map((s) => ({
      id: s.id,
      positions: s.positions.slice(),
      triangles: s.triangles.slice(),
      vertCount: s.vertCount,
      triCount: s.triCount,
    }))
    const msg: ToWorker = {
      type: 'unwrap',
      jobId: job,
      shells: serial,
      iterations: 64,
      pace: 16,
    }
    w.postMessage(msg)
    set({
      shells,
      shellSet,
      isRelaxing: true,
      relaxProgress: 0,
      hasUV: false,
      isPacked: false,
      selectedShells: new Set(),
      uvVersion: get().uvVersion + 1,
      status: `Flattening ${shells.length} shell${shells.length === 1 ? '' : 's'}…`,
    })
  },

  cancelRelax: () => {
    if (worker) worker.postMessage({ type: 'cancel' } satisfies ToWorker)
    set({ isRelaxing: false, status: 'Relax stopped' })
  },

  pack: () => {
    const { shells } = get()
    if (!shells.length || !live.uv.size) return
    live.packed = computePacked(shells, live.uv)
    live.dirty = true
    set({
      isPacked: true,
      uvVersion: get().uvVersion + 1,
      status: `Packed ${live.packed.size} islands into 0–1`,
    })
  },

  unpack: () => {
    live.packed = null
    live.dirty = true
    set({ isPacked: false, uvVersion: get().uvVersion + 1, status: 'Unpacked' })
  },

  selectShell: (id, additive) => {
    const sel = additive ? new Set(get().selectedShells) : new Set<number>()
    if (sel.has(id)) sel.delete(id)
    else sel.add(id)
    set({ selectedShells: sel })
  },
  clearSelection: () => set({ selectedShells: new Set() }),
  setStatus: (s) => set({ status: s }),

  pushToast: (kind, msg) =>
    // keep at most 4 on screen — older ones roll off the top of the stack
    set({ toasts: [...get().toasts.slice(-3), { id: ++toastCounter, kind, msg }] }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

// Dev-only handles for debugging / scripted verification from the console.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as { uvStore: typeof useStore }).uvStore = useStore
  ;(window as unknown as { uvLive: typeof live }).uvLive = live
  ;(window as unknown as { uvThree: typeof THREE }).uvThree = THREE
  ;(window as unknown as { uvGltfExporter: typeof GLTFExporter }).uvGltfExporter = GLTFExporter
  ;(window as unknown as { uvGltfLoader: typeof GLTFLoader }).uvGltfLoader = GLTFLoader
}
