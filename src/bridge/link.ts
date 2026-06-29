/**
 * UV Studio ⇄ Cinema 4D link bridge.
 *
 * Transport is a SHARED FOLDER — the same one the C4D plugin watches:
 *
 *     <link>/to_app/scene.glb   C4D → UV Studio   (we READ this)
 *     <link>/to_c4d/scene.glb   UV Studio → C4D   (we WRITE this)
 *
 * Each writer drops `scene.glb` then writes `scene.json` LAST; the reader polls
 * the manifest's timestamp so it never reads a half-written GLB.
 *
 * Two backends, one API:
 *   • Web  → File System Access API (Chromium). Lets the browser build (e.g.
 *            embedded in preshow.link) talk to the same folder, with the user
 *            granting access once via a directory picker.
 *   • Desktop (Tauri) → native fs via invoke() commands (see src-tauri). No
 *            picker permission prompts, survives restarts.
 *
 * The same React app drives both — nothing here is bundled unless used.
 */

import type { ReturnPayload, ForwardSidecar } from './roundtrip'

/** What the bridge delivers from the DCC: a forward sidecar (lossless, geometry
 *  built 1:1) when present, else raw GLB bytes (manual/legacy). */
export type Incoming = { sidecar?: ForwardSidecar; glb?: ArrayBuffer }

const TO_APP = 'to_app'
const TO_C4D = 'to_c4d'
const GLB = 'scene.glb'
const MANIFEST = 'scene.json'
const ACK = 'ack.json'

export type LinkScreen = { name: string; w: number; h: number; aspect: number }
type Manifest = { v: number; ts: number; objects: string[]; screens: LinkScreen[] }
/** C4D → app confirmation that the returned UVs landed on the objects.
 *  stage: 'received' (heartbeat) | 'applied' | 'error'. */
export type UvAck = { ts: number; applied: number; missed: string[]; stage?: string; error?: string }

// ---- backend detection ------------------------------------------------------
interface TauriGlobal {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
  event?: { listen: (name: string, cb: (e: unknown) => void) => Promise<() => void> }
}
function tauri(): TauriGlobal | null {
  const w = window as unknown as { __TAURI__?: TauriGlobal }
  return w.__TAURI__ ?? null
}
export function isDesktop(): boolean {
  return tauri() !== null
}
function hasFsAccess(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}
/** Whether a link folder can be used at all in this environment. */
export function linkSupported(): boolean {
  return isDesktop() || hasFsAccess()
}

// ---- web backend (File System Access API) -----------------------------------
type DirHandle = {
  name: string
  getDirectoryHandle: (n: string, o?: { create?: boolean }) => Promise<DirHandle>
  getFileHandle: (n: string, o?: { create?: boolean }) => Promise<FileHandle>
  queryPermission?: (o: { mode: string }) => Promise<string>
  requestPermission?: (o: { mode: string }) => Promise<string>
}
type FileHandle = {
  getFile: () => Promise<File>
  createWritable: () => Promise<{ write: (d: BufferSource | string) => Promise<void>; close: () => Promise<void> }>
}

let webRoot: DirHandle | null = null
let savedHandle: DirHandle | null = null // remembered across reloads (IndexedDB)
let folderLabel = ''

// --- tiny IndexedDB kv store (FileSystemDirectoryHandle is structured-cloneable,
//     so the browser can remember the chosen link folder across reloads) --------
const IDB_DB = 'uvstudio'
const IDB_STORE = 'kv'
const IDB_KEY = 'linkDir'
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}
async function idbSet(val: unknown): Promise<void> {
  const db = await idbOpen()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(val, IDB_KEY)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
  db.close()
}
async function idbGet(): Promise<DirHandle | undefined> {
  const db = await idbOpen()
  const v = await new Promise<DirHandle | undefined>((res, rej) => {
    const r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY)
    r.onsuccess = () => res(r.result as DirHandle | undefined)
    r.onerror = () => rej(r.error)
  })
  db.close()
  return v
}
async function loadSaved(): Promise<DirHandle | null> {
  if (savedHandle) return savedHandle
  if (!hasFsAccess()) return null
  try {
    savedHandle = (await idbGet()) ?? null
  } catch {
    savedHandle = null
  }
  return savedHandle
}

async function webConnect(): Promise<boolean> {
  // first connect this session → try to re-grant the remembered folder (no
  // re-browsing). If already connected ("Change…"), skip straight to the picker.
  if (!webRoot) {
    const saved = await loadSaved()
    if (saved?.requestPermission) {
      try {
        if ((await saved.requestPermission({ mode: 'readwrite' })) === 'granted') {
          webRoot = saved
          folderLabel = saved.name
          return true
        }
      } catch {
        /* fall through to the picker */
      }
    }
  }
  const pick = (window as unknown as { showDirectoryPicker: (o?: unknown) => Promise<DirHandle> }).showDirectoryPicker
  try {
    const dir = await pick({ id: 'uvstudio-link', mode: 'readwrite' })
    if (dir.requestPermission) await dir.requestPermission({ mode: 'readwrite' })
    webRoot = dir
    savedHandle = dir
    folderLabel = dir.name
    void idbSet(dir).catch(() => {}) // remember for next time
    return true
  } catch {
    return false // user cancelled
  }
}

async function webWrite(buf: ArrayBuffer, screens: LinkScreen[]): Promise<void> {
  if (!webRoot) throw new Error('no link folder')
  const out = await webRoot.getDirectoryHandle(TO_C4D, { create: true })
  const gh = await out.getFileHandle(GLB, { create: true })
  let w = await gh.createWritable()
  await w.write(buf)
  await w.close()
  // manifest LAST → signals the GLB is complete (carries the LED render sizes)
  const man: Manifest = { v: 1, ts: Date.now(), objects: screens.map((s) => s.name), screens }
  const mh = await out.getFileHandle(MANIFEST, { create: true })
  w = await mh.createWritable()
  await w.write(JSON.stringify(man))
  await w.close()
}

type IncomingManifest = { ts: number; kind?: string } & Record<string, unknown>
async function webReadManifest(): Promise<IncomingManifest | null> {
  if (!webRoot) return null
  try {
    const inbox = await webRoot.getDirectoryHandle(TO_APP, { create: true })
    const mh = await inbox.getFileHandle(MANIFEST)
    return JSON.parse(await (await mh.getFile()).text()) as IncomingManifest
  } catch {
    return null
  }
}

async function webReadGlb(): Promise<ArrayBuffer | null> {
  if (!webRoot) return null
  try {
    const inbox = await webRoot.getDirectoryHandle(TO_APP)
    const gh = await inbox.getFileHandle(GLB)
    return await (await gh.getFile()).arrayBuffer()
  } catch {
    return null
  }
}

async function webReadAck(): Promise<UvAck | null> {
  if (!webRoot) return null
  try {
    const inbox = await webRoot.getDirectoryHandle(TO_APP)
    const ah = await inbox.getFileHandle(ACK)
    return JSON.parse(await (await ah.getFile()).text()) as UvAck
  } catch {
    return null
  }
}

// ---- desktop backend (Tauri commands in src-tauri) --------------------------
async function deskConnect(): Promise<boolean> {
  const path = (await tauri()!.core.invoke('bridge_connect')) as string | null
  if (path) folderLabel = path.split(/[/\\]/).pop() || path
  return !!path
}
async function deskWrite(buf: ArrayBuffer, screens: LinkScreen[]): Promise<void> {
  await tauri()!.core.invoke('bridge_send', { bytes: Array.from(new Uint8Array(buf)), screens })
}
async function deskPoll(): Promise<Incoming | null> {
  // Rust tracks the last-seen timestamp and returns the new scene.json (always)
  // + scene.glb bytes (if present), or null when nothing changed.
  const res = (await tauri()!.core.invoke('bridge_poll')) as { json: string; glb: number[] | null } | null
  if (!res) return null
  try {
    const man = JSON.parse(res.json) as { kind?: string }
    if (man.kind === 'geo-forward') return { sidecar: man as unknown as ForwardSidecar }
  } catch {
    /* not a forward sidecar — fall through to GLB */
  }
  return res.glb ? { glb: new Uint8Array(res.glb).buffer } : null
}
async function deskAck(): Promise<UvAck | null> {
  // Rust dedupes by ts and returns the ack JSON only once per new ack.
  const json = (await tauri()!.core.invoke('bridge_ack')) as string | null
  if (!json) return null
  try {
    return JSON.parse(json) as UvAck
  } catch {
    return null
  }
}

// ---- public API -------------------------------------------------------------
let connected = false

export function isConnected(): boolean {
  return connected
}
export function linkFolderLabel(): string {
  return folderLabel
}

/**
 * Re-attach to a previously-chosen link folder without prompting. Desktop only:
 * Tauri remembers the path across launches (set once, ever). Returns true if a
 * folder was restored. (Web can't silently restore a directory handle yet.)
 */
export async function restore(): Promise<boolean> {
  if (isDesktop()) {
    try {
      const path = (await tauri()!.core.invoke('bridge_restore')) as string | null
      if (path) {
        folderLabel = path.split(/[/\\]/).pop() || path
        connected = true
        return true
      }
    } catch {
      /* ignore */
    }
    return false
  }
  // web: silently re-attach the saved folder if its permission still holds
  const saved = await loadSaved()
  if (saved?.queryPermission) {
    try {
      if ((await saved.queryPermission({ mode: 'readwrite' })) === 'granted') {
        webRoot = saved
        folderLabel = saved.name
        connected = true
        return true
      }
    } catch {
      /* permission needs a gesture — user clicks Connect to re-grant */
    }
  }
  return false
}

/** A remembered (web) folder name even when not yet reconnected — for the UI. */
export async function savedLabel(): Promise<string> {
  const saved = await loadSaved()
  return saved?.name ?? ''
}

/** Prompt for / open the shared link folder. Returns true on success. */
export async function connect(): Promise<boolean> {
  try {
    connected = isDesktop() ? await deskConnect() : await webConnect()
  } catch {
    connected = false
  }
  return connected
}

/** Result of an install: auto = found & installed into N C4D folders; manual =
 *  user picked a folder; null = cancelled / no C4D / not desktop. */
export type PluginInstall = { auto: boolean; paths: string[] }

/**
 * Desktop only: install the bundled Cinema 4D plugin into the LATEST installed
 * C4D (newest version) — no picking. Falls back to a manual folder picker only
 * if no Cinema 4D is found.
 */
export async function installC4DPlugin(): Promise<PluginInstall | null> {
  if (!isDesktop()) return null
  try {
    const latest = (await tauri()!.core.invoke('install_c4d_plugin_latest')) as string | null
    if (latest) return { auto: true, paths: [latest] }
    const manual = (await tauri()!.core.invoke('install_c4d_plugin')) as string | null
    return manual ? { auto: false, paths: [manual] } : null
  } catch {
    return null
  }
}

/** Desktop: whether the bundled C4D plugin is already installed in the latest
 *  Cinema 4D (so the UI can hide the Install button when it's not needed). */
export type C4DStatus = { found: boolean; installed: boolean; path: string | null }
export async function c4dStatus(): Promise<C4DStatus | null> {
  if (!isDesktop()) return null
  try {
    return (await tauri()!.core.invoke('c4d_status')) as C4DStatus
  } catch {
    return null
  }
}

/** Desktop only: silently refresh the bundled plugin into the latest C4D. Run on
 *  launch so updating the app keeps the C4D-side plugin current. */
export async function refreshPluginSilently(): Promise<void> {
  if (!isDesktop()) return
  try {
    await tauri()!.core.invoke('install_c4d_plugin_latest')
  } catch {
    /* no C4D / not ready — ignore */
  }
}

/** Open a URL in the default browser (desktop → native; web → new tab). */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      await tauri()!.core.invoke('open_url', { url })
    } catch {
      /* ignore */
    }
  } else {
    window.open(url, '_blank')
  }
}

/** Quit the desktop app (after starting an update download). */
export async function quitApp(): Promise<void> {
  if (!isDesktop()) return
  try {
    await tauri()!.core.invoke('quit_app')
  } catch {
    /* ignore */
  }
}

/** Bring the desktop window to the front (e.g. when C4D sends new geometry). */
export async function focusWindow(): Promise<void> {
  if (!isDesktop()) return
  try {
    await tauri()!.core.invoke('focus_window')
  } catch {
    /* ignore */
  }
}

/** Write the mapped GLB (+ per-screen LED sizes) into to_c4d/ for C4D to pick up. */
export async function sendGlb(buf: ArrayBuffer, screens: LinkScreen[]): Promise<void> {
  if (isDesktop()) await deskWrite(buf, screens)
  else await webWrite(buf, screens)
}

/**
 * LOSSLESS return: write a UV-only payload (per-polygon-corner UVs) to
 * to_c4d/scene.json. No geometry — the plugin applies these onto C4D's existing
 * objects' UVW tags. scene.json is the manifest + the payload in one.
 */
export async function sendUVs(payload: ReturnPayload): Promise<void> {
  const json = JSON.stringify(payload)
  if (isDesktop()) {
    await tauri()!.core.invoke('bridge_send_uvs', { json })
    return
  }
  if (!webRoot) throw new Error('no link folder')
  const out = await webRoot.getDirectoryHandle(TO_C4D, { create: true })
  const mh = await out.getFileHandle(MANIFEST, { create: true })
  const w = await mh.createWritable()
  await w.write(json)
  await w.close()
}

/**
 * Desktop only: native Save dialog → writes the GLB and a sidecar manifest next
 * to it. Returns the saved path, or null (cancelled / not desktop, where the
 * caller falls back to a browser download).
 */
export async function saveGlb(defaultName: string, buf: ArrayBuffer, sidecar: string): Promise<string | null> {
  if (!isDesktop()) return null
  const path = await tauri()!.core.invoke('export_glb', {
    name: defaultName,
    bytes: Array.from(new Uint8Array(buf)),
    sidecar,
  })
  return (path as string | null) ?? null
}

/** Desktop only: native Open dialog for a GLB/glTF. Returns its bytes + name. */
export async function importGlb(): Promise<{ name: string; buf: ArrayBuffer } | null> {
  if (!isDesktop()) return null
  const picked = (await tauri()!.core.invoke('import_glb')) as { name: string; bytes: number[] } | null
  if (!picked) return null
  return { name: picked.name, buf: new Uint8Array(picked.bytes).buffer }
}

/**
 * Watch to_app/ for messages from C4D:
 *   • `onIncoming` — geometry (forward sidecar, else GLB bytes)
 *   • `onAck`      — confirmation that returned UVs landed on the objects
 *
 * Desktop is EVENT-DRIVEN: a Rust filesystem watcher pushes `bridge-changed`
 * the instant C4D drops a file, so reactions are immediate. A slow fallback
 * poll covers any missed event (and folder overrides). Web has no fs-watch API,
 * so it polls. Returns a stop fn.
 */
export function watchIncoming(
  onIncoming: (inc: Incoming) => void,
  onAck?: (ack: UvAck) => void,
  intervalMs = 1000,
): () => void {
  let lastTs: number | null = null
  let lastAckTs: number | null = null
  let stopped = false
  let unlisten: (() => void) | null = null

  const pull = async () => {
    if (stopped || !connected) return
    try {
      if (isDesktop()) {
        const inc = await deskPoll()
        if (inc) onIncoming(inc)
        if (onAck) {
          const ack = await deskAck()
          if (ack) onAck(ack)
        }
      } else {
        const man = await webReadManifest()
        if (man && man.ts !== lastTs) {
          lastTs = man.ts
          if (man.kind === 'geo-forward') {
            onIncoming({ sidecar: man as unknown as ForwardSidecar })
          } else {
            const glb = await webReadGlb()
            if (glb) onIncoming({ glb })
          }
        }
        if (onAck) {
          const ack = await webReadAck()
          if (ack && ack.ts !== lastAckTs) {
            lastAckTs = ack.ts
            onAck(ack)
          }
        }
      }
    } catch {
      /* folder went away / permission lost — keep polling, recover on reconnect */
    }
  }

  // desktop: react instantly to the Rust watcher's push event
  const t = tauri()
  if (t?.event?.listen) {
    void t.event.listen('bridge-changed', () => void pull()).then((un) => {
      if (stopped) un()
      else unlisten = un
    })
  }

  // import anything already waiting (e.g. a Send that cold-launched the app),
  // retrying briefly until the link is connected
  let tries = 0
  const warmup = window.setInterval(() => {
    if (stopped || tries++ > 20) {
      window.clearInterval(warmup)
      return
    }
    if (connected) {
      window.clearInterval(warmup)
      void pull()
    }
  }, 250)

  // poll: the only channel on web; a slow safety net on desktop
  const id = window.setInterval(pull, isDesktop() ? 2500 : intervalMs)
  return () => {
    stopped = true
    window.clearInterval(id)
    if (unlisten) unlisten()
  }
}
