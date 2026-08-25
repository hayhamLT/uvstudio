// ---------------------------------------------------------------------------
// Mapping screens to their content: per-screen orientation, fit,
// projection, LED resolution, and the auto-map runs themselves.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'
import { live } from '../live'
import { prefBool, prefStr } from '../prefs'
import { authoredUV, mapObjectUV, snapshot, transformObjectUV } from '../mapping'

export type MapSlice = Pick<
  AppState,
  | 'assignment'
  | 'mapOrient'
  | 'mapProjection'
  | 'screenRes'
  | 'mapFill'
  | 'mapObjFit'
  | 'mapFitInfo'
  | 'mappedObjects'
  | 'selectedObject'
  | 'hiddenScreens'
  | 'soloScreen'
  | 'autoMapOnImport'
  | 'screenKeywords'
  | 'scaleMode'
  | 'assign'
  | 'rotateObject'
  | 'flipObject'
  | 'scaleSelection'
  | 'scaleObject'
  | 'setScaleMode'
  | 'resetObjectOrient'
  | 'setObjectProjection'
  | 'setScreenRes'
  | 'setMapFill'
  | 'setAutoMapOnImport'
  | 'setScreenKeywords'
  | 'setObjectFit'
  | 'runMapping'
  | 'runMappingFor'
  | 'selectObject'
  | 'moveScreen'
  | 'toggleHidden'
  | 'toggleSolo'
>

export const createMapSlice: StateCreator<AppState, [], [], MapSlice> = (set, get) => ({
  assignment: {},
  mapOrient: {},
  mapProjection: {},
  screenRes: {},
  // Fill by default: the screen's UVs cover the ENTIRE image — or, for a PSD
  // layer / image with alpha, the entire opaque region (see objContentRect).
  // Media made for the screen fills it exactly; a mismatch fills + stretches
  // rather than cropping or letterboxing (the whole image always shows).
  mapFill: true,
  mapObjFit: {},
  mapFitInfo: {},
  mappedObjects: [],
  selectedObject: null,
  hiddenScreens: [],
  soloScreen: null,
  autoMapOnImport: prefBool('autoMapOnImport', false),
  screenKeywords: prefStr('screenKeywords', ''),
  scaleMode: false,
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
      live.uvEpoch++
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
      live.uvEpoch++
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
    live.uvEpoch++
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
    live.uvEpoch++
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
  setScreenKeywords: (v) => {
    try {
      localStorage.setItem('uvstudio.screenKeywords', v)
    } catch {
      /* ignore */
    }
    set({ screenKeywords: v })
  },
  setObjectFit: (objName, fit) => {
    const mapObjFit = { ...get().mapObjFit }
    if (fit === 'default') delete mapObjFit[objName]
    else mapObjFit[objName] = fit
    set({ mapObjFit })
    get().runMappingFor(objName)
  },
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
    live.uvEpoch++
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
        get().pushToast(
          'good',
          `Mapped ${mapped.length}/${g.mapObjects.length} screen${g.mapObjects.length === 1 ? '' : 's'}`,
        )
      else get().pushToast('info', 'Nothing to map yet — add images or PSD layers to the screens first')
    }
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
      !g.layeredMode || // atlas mode — region assignment is the target
      live.layerPool.length > 0 || // PSD/images were loaded
      g.assignment[objName] != null || // manual region assignment
      live.objTextures.has(objName) // the screen has its own content to fit
    if (g.importedObjects.includes(objName) && !hasTarget && obj.shellIds.some((id) => authoredUV.has(id))) {
      if (!opts?.noUndo) get().pushUndo()
      obj.shellIds.forEach((id) => {
        const a = authoredUV.get(id)
        if (a) live.uv.set(id, a.slice())
      })
      const mapped = new Set(g.mappedObjects)
      mapped.add(objName)
      live.uvEpoch++
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
    live.uvEpoch++
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
  selectObject: (name) =>
    // Switching to a different screen drops any sub-element (vertex/edge/face)
    // selection — it belonged to the old screen. Otherwise a stale selection
    // would make the transform gizmo edit the previously-selected object.
    set((s) =>
      name === s.selectedObject
        ? { selectedObject: name }
        : { selectedObject: name, mapSelection: new Set<string>() },
    ),
  // Reorder a screen in the draw stack (later = drawn on top, for overlaps).
  moveScreen: (objName, dir) => {
    const order = get().screenOrder.length ? [...get().screenOrder] : get().mapObjects.map((o) => o.name)
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
})
