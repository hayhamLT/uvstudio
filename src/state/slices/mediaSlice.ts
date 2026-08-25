// ---------------------------------------------------------------------------
// The content side: atlases, PSDs, images, and the link wizard that
// pairs each piece of media with the screen that shows it.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'
import * as THREE from 'three'
import { live } from '../live'
import type { Region } from '../../map/types'
import { detectRegions } from '../../map/regions'
import { contentRectFromImage, opaqueBBoxNorm } from '../../map/contentRect'
import { type RectUV } from '../../map/fit'
import { ocrRegionLabels, matchByLabels, similarity, normalize, matchNamesToLabels } from '../../map/ocr'
import { loadPsdFile, flattenPsdLayers } from '../../mesh/loadPsd'
import { redoStack, undoStack } from '../history'
import { isPsd, loadImage, loadImageFromBlob, parseMediaItems, suggestLinks } from '../media'
import { matchLayerPool, screenOverrides } from '../mapping'

export type MediaSlice = Pick<
  AppState,
  | 'atlas'
  | 'regions'
  | 'layeredMode'
  | 'psdLayerCount'
  | 'layerPoolCount'
  | 'pendingLink'
  | 'ocrBusy'
  | 'loadAtlasUrl'
  | 'loadPsd'
  | 'loadImages'
  | 'setObjectImage'
  | 'applyMediaFiles'
  | 'beginLink'
  | 'openLinkWizard'
  | 'addLinkMedia'
  | 'confirmLink'
  | 'cancelLink'
  | 'removeObjectTexture'
  | 'autoMatch'
>

export const createMediaSlice: StateCreator<AppState, [], [], MediaSlice> = (set, get) => ({
  atlas: null,
  regions: [],
  layeredMode: false,
  psdLayerCount: 0,
  layerPoolCount: 0,
  pendingLink: null,
  ocrBusy: false,
  loadAtlasUrl: async (url, detect) => {
    const img = await loadImage(url)
    // callers pass a blob: URL they have no other chance to release
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    const tex = new THREE.Texture(img)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    live.atlasTexture?.dispose() // replacing the atlas frees the old GPU texture
    live.atlasTexture = tex
    live.atlasAspect = img.width / img.height
    live.layeredMode = false
    live.uvEpoch++
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
      live.uvEpoch++
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
    live.atlasTexture?.dispose()
    live.atlasTexture = new THREE.CanvasTexture(composite)
    live.atlasTexture.colorSpace = THREE.SRGBColorSpace
    live.atlasTexture.needsUpdate = true
    live.atlasAspect = W / H
    live.layeredMode = false
    live.uvEpoch++

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
        const img = await loadImageFromBlob(f)
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
    live.uvEpoch++
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
        source = await loadImageFromBlob(file)
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
    live.uvEpoch++
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
      const msg = get().autoMapOnImport ? `Linked media to ${n}` : `Linked media to ${n} — Auto-map to fit`
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
    live.uvEpoch++
    set({ psdLayerCount: live.objTextures.size, status: `Removed content from ${objName}` })
    get().runMapping()
  },
  autoMatch: async () => {
    const { atlas, regions, mapObjects, layeredMode } = get()
    const names = mapObjects.map((o) => o.name)
    // Layer names take priority: if we have named layers, match screens to them.
    if (layeredMode && live.layerPool.length) {
      const matched = matchLayerPool(names)
      live.uvEpoch++
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
      const labeled = await ocrRegionLabels(
        img,
        regions.map((r) => ({ ...r })),
      )
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
})
