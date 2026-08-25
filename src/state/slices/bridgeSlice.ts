// ---------------------------------------------------------------------------
// Getting the result out: GLB export, and the Cinema 4D / Blender
// round-trip over the link folder.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'
import type { Shell } from '../../mesh/types'
import { live } from '../live'
import * as linkBridge from '../../bridge/link'
import { buildReturnPayload, type ReturnObjectInput } from '../../bridge/roundtrip'
import { buildMappedGlb, screenManifest, screenSpecs } from '../glb'

// After a Send, the app minimizes (steps aside for the DCC but keeps running)
// only once the DCC acks a clean apply — or after a fallback timeout if the DCC
// is closed (it applies on its next launch). A partial failure/error keeps the
// app up front so the warning is actually seen.
let sendQuitTimer: ReturnType<typeof setTimeout> | null = null

function armSendQuit() {
  if (sendQuitTimer) clearTimeout(sendQuitTimer)
  sendQuitTimer = setTimeout(() => {
    sendQuitTimer = null
    void linkBridge.minimizeWindow()
  }, 6000)
}

function disarmSendQuit(): boolean {
  const armed = sendQuitTimer !== null
  if (sendQuitTimer) clearTimeout(sendQuitTimer)
  sendQuitTimer = null
  return armed
}

export type BridgeSlice = Pick<AppState, 'exportGltf' | 'sendToC4D' | 'handleUvAck'>

export const createBridgeSlice: StateCreator<AppState, [], [], BridgeSlice> = (set, get) => ({
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
      // revoke on the next tick — WebKit/Gecko still need the URL alive when the
      // download actually starts, and an immediate revoke can truncate it
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
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
    get().pushToast(
      'good',
      `Exported ${specs.length} screen${specs.length === 1 ? '' : 's'} — screen_map.glb + .json`,
    )
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
        set({
          status: `Sent UVs for ${uvInputs.length} object${uvInputs.length === 1 ? '' : 's'} — waiting for confirmation…`,
        })
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
        void linkBridge.minimizeWindow() // step aside so C4D comes forward
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
        ack.missed.slice(0, 3).join(', ') + (ack.missed.length > 3 ? ` +${ack.missed.length - 3} more` : '')
      set({
        status: `⚠ ${dcc} applied UVs to ${ack.applied} object${plural} — couldn't find: ${names}`,
      })
      get().pushToast('warn', `${dcc} applied ${ack.applied} object${plural} — couldn't find: ${names}`)
      void linkBridge.focusWindow() // partial failure → stay open and show it
      return
    }
    set({ status: `${dcc} applied UVs to ${ack.applied} object${plural} ✓` })
    get().pushToast('good', `${dcc} applied UVs to ${ack.applied} object${plural}`)
    // clean success right after a Send → hand off to the DCC and step aside
    // (minimize, not quit — the app stays running for the next round-trip)
    if (wasSending) setTimeout(() => void linkBridge.minimizeWindow(), 1200)
  },
})
