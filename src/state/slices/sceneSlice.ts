// ---------------------------------------------------------------------------
// Loading a scene: the import flow (pick which objects are screens),
// the resulting screen + reference geometry, and the demo scenes.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'
import * as THREE from 'three'
import { buildHalfEdge } from '../../mesh/halfedge'
import { extractShells } from '../../mesh/shells'
import { live, resetLive } from '../live'
import { contentRectFromImage } from '../../map/contentRect'
import { matchByLabels } from '../../map/ocr'
import { demoArena, makeDemoAtlas, demoRegions } from '../../map/demo'
import { redoStack, undoStack } from '../history'
import {
  authoredUV,
  screenOverrides,
  } from '../mapping'
import {
  DEFAULT_CONTEXT_SHADE,
  type MapObject,
  type MapShell,
  } from '../types'


export type SceneSlice = Pick<AppState, 'mode' | 'mapObjects' | 'mapShells' | 'contextShells' | 'contextCount' | 'contextShade' | 'contextOpacity' | 'contextVisible' | 'lastImportName' | 'pendingImport' | 'importedObjects' | 'screenOrder' | 'setMode' | 'loadScene' | 'beginImport' | 'confirmImport' | 'cancelImport' | 'setContextShade' | 'setContextOpacity' | 'setContextVisible' | 'loadDemoArena' | 'loadDemoPsd'>

export const createSceneSlice: StateCreator<AppState, [], [], SceneSlice> = (
  set,
  get,
) => ({
  mode: 'map',
  mapObjects: [],
  mapShells: [],
  contextShells: [],
  contextCount: 0,
  contextShade: DEFAULT_CONTEXT_SHADE,
  contextOpacity: 1,
  contextVisible: true,
  lastImportName: null,
  pendingImport: null,
  importedObjects: [],
  screenOrder: [],
  setMode: (m) => set({ mode: m }),
  loadScene: (objects, opts) => {
    const prevShade = get().contextShade
    const prevOpacity = get().contextOpacity
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
    // Shell ids must be globally unique: live.uv, authoredUV and the undo
    // snapshots are all keyed by them. The old scheme (objectIndex * 1000 +
    // shellIndex) collided as soon as ONE object had 1000+ connected
    // components — routine in this domain, where an LED wall is often modelled
    // as a few thousand individual tiles — and a collision silently hands one
    // screen another screen's UVs. A plain counter cannot collide, and is
    // still deterministic for a given import order.
    let nextShellId = 0
    objects.forEach((o) => {
      const he = buildHalfEdge(o.mesh)
      const shells = extractShells(he, new Set()).shells
      if (!isScreen(o.name)) {
        // reference geometry — render only, no mapping
        shells.forEach((shell) => contextShells.push({ id: nextShellId++, shell, objName: o.name }))
        return
      }
      const shellIds: number[] = []
      const hasUVs = !!o.uvs // show imported UVs even when there's no texture
      const hasTexture = !!o.textureImage
      shells.forEach((shell) => {
        const id = nextShellId++
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
    live.uvEpoch++
    set({
      mode: 'map',
      mapObjects,
      mapShells,
      contextShells,
      contextCount: new Set(contextShells.map((s) => s.objName)).size,
      contextShade: opts?.keepOverrides ? prevShade : DEFAULT_CONTEXT_SHADE,
      contextOpacity: opts?.keepOverrides ? prevOpacity : 1,
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
  setContextOpacity: (v) => set({ contextOpacity: Math.max(0.15, Math.min(1, v)) }),
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
  }
})
