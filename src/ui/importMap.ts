import { useStore } from '../state/store'
import { loadSceneFile } from '../mesh/loadFile'
import * as link from '../bridge/link'

// Remembered file handle of the last model import — lets Refresh re-read the
// file from disk (after a re-export from C4D etc.) without re-picking it.
// Only available via the File System Access API (Chromium).
let lastHandle: FileSystemHandleLike | null = null
interface FileSystemHandleLike {
  getFile: () => Promise<File>
}

/** Parse a model file and open the screen-selection flow. `media` are any
 *  image/PSD files imported alongside it, auto-applied to matching screens. */
export async function importModelFile(
  file: File,
  handle?: FileSystemHandleLike | null,
  media?: File[],
) {
  const s = useStore.getState()
  s.setStatus(`Loading ${file.name}…`)
  lastHandle = handle ?? null
  try {
    s.beginImport(await loadSceneFile(file), file.name, media)
  } catch (err) {
    s.setStatus(`Import failed: ${(err as Error).message}`)
  }
}

type PickedHandle = FileSystemHandleLike & { getFile: () => Promise<File> }

async function pickModelFile(): Promise<{
  file: File
  handle: FileSystemHandleLike
  media: File[]
} | null> {
  const w = window as unknown as {
    showOpenFilePicker?: (o: unknown) => Promise<PickedHandle[]>
  }
  if (!w.showOpenFilePicker) return null
  try {
    // allow picking the model AND its media (PSD / images) in one go
    // NOTE: showOpenFilePicker rejects wildcard MIME keys (e.g. 'image/*') and
    // throws — every accept key must be a concrete MIME type.
    const handles = await w.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: 'Model + media',
          accept: {
            'model/gltf-binary': ['.glb'],
            'model/gltf+json': ['.gltf'],
            'image/vnd.adobe.photoshop': ['.psd'],
            'image/png': ['.png'],
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/webp': ['.webp'],
          },
        },
      ],
    })
    const files = await Promise.all(handles.map(async (h) => ({ h, f: await h.getFile() })))
    const model = files.find(({ f }) => isModelFile(f))
    if (!model) return null
    return {
      file: model.f,
      handle: model.h,
      media: files.filter(({ f }) => f !== model.f && !isModelFile(f)).map(({ f }) => f),
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null // user cancelled — done
    throw e // a real API failure → let the caller fall back to the <input>
  }
}

/** True when the File System Access API is available (one-click refresh). */
export function canPickWithHandle() {
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'
}

/** Open the model picker; uses the File System Access API when available (so
 *  Refresh can re-read from disk), otherwise falls back to the given <input>. */
export async function openModelPicker(fallbackInput?: HTMLInputElement | null) {
  // desktop: native multi-select dialog → model + its PSDs / images in one go
  if (link.isDesktop()) {
    const picked = await link.importModelMedia()
    if (!picked || !picked.length) return
    const files = picked.map((p) => new File([p.buf], p.name, { type: mimeForName(p.name) }))
    const model = files.find(isModelFile)
    if (!model) return // no model in the selection — nothing to load
    await importModelFile(model, null, files.filter((f) => f !== model && !isModelFile(f)))
    return
  }
  if (canPickWithHandle()) {
    try {
      const picked = await pickModelFile()
      if (picked) await importModelFile(picked.file, picked.handle, picked.media)
      return // imported, or the user cancelled — either way we're done
    } catch {
      // showOpenFilePicker failed in this host → fall through to the <input>
    }
  }
  fallbackInput?.click()
}

/** Re-read the current model from disk and rebuild — keeping which objects are
 *  screens vs reference geometry, and the user's manual texture overrides. */
export async function refreshModel(fallbackInput?: HTMLInputElement | null) {
  const s = useStore.getState()
  const screenNames = s.mapObjects.map((o) => o.name)
  let file: File | null = null
  if (lastHandle) {
    try {
      file = await lastHandle.getFile()
    } catch {
      lastHandle = null
    }
  }
  if (!file) {
    let picked: Awaited<ReturnType<typeof pickModelFile>> = null
    try {
      picked = await pickModelFile()
    } catch {
      /* picker failed → fall back to the <input> below */
    }
    if (picked) {
      lastHandle = picked.handle
      file = picked.file
    } else {
      fallbackInput?.click() // non-Chromium: re-pick via <input> (will re-prompt for screens)
      return
    }
  }
  s.setStatus(`Refreshing ${file.name}…`)
  try {
    const objects = await loadSceneFile(file)
    s.loadScene(objects, { screenNames, keepOverrides: true })
  } catch (err) {
    s.setStatus(`Refresh failed: ${(err as Error).message}`)
  }
}

/** A 3D model file (vs. an image / PSD map). */
export function isModelFile(f: File) {
  return /\.(glb|gltf)$/i.test(f.name)
}

/** Best-effort MIME from a file name (desktop picker returns bytes + name only). */
function mimeForName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  const map: Record<string, string> = {
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    psd: 'image/vnd.adobe.photoshop',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  }
  return map[ext] || ''
}

/**
 * Smart drop router shared by the 2D and 3D viewports. Figures out intent from
 * the files and current selection so a drop "just works" wherever it lands:
 *   - a model file (.glb/.gltf) → (re)import the model
 *   - a single image whose name matches a screen → apply to that screen
 *   - a single image with a screen selected → apply to the active screen
 *   - otherwise (several images, a PSD, or no target) → name-matched map import
 */
export async function handleViewportDrop(files: FileList | File[]) {
  const arr = Array.from(files)
  const s = useStore.getState()
  if (!arr.length) return

  const model = arr.find(isModelFile)
  if (model) {
    // import the model + any image/PSD files dropped with it (auto-applied)
    await importModelFile(model, null, arr.filter((f) => f !== model && !isModelFile(f)))
    return
  }

  const singleImage = arr.length === 1 && !arr[0].name.toLowerCase().endsWith('.psd')
  if (singleImage) {
    const base = arr[0].name.replace(/\.[^.]+$/, '').toLowerCase()
    const match = s.mapObjects.find((o) => o.name.toLowerCase() === base)
    const target = match?.name ?? s.selectedObject
    if (target) {
      s.setStatus(`Applying ${arr[0].name} to ${target}…`)
      await s.setObjectImage(target, arr[0])
      return
    }
    s.setStatus(`Select a screen, then drop “${arr[0].name}” on it to apply`)
  }

  await importMapFiles(files)
}

/**
 * Load map content from one or more dropped/selected files, choosing the right
 * mode automatically:
 *   - a `.psd` → layered mode, matched by layer name (replaces)
 *   - already in layered mode → images are MERGED in (incremental build-up),
 *     matched by file name
 *   - several images (fresh) → new layered set, matched by file name
 *   - a single image (fresh) → atlas mode (region detection)
 */
export async function importMapFiles(fileList: FileList | File[]) {
  const files = Array.from(fileList)
  if (!files.length) return
  const s = useStore.getState()
  s.setStatus('Loading map…')
  try {
    // With screens loaded, open the link wizard for per-screen media (multiple
    // files, or any PSD with layers). A single unnamed image still goes to the
    // atlas / region-detection flow below.
    const hasPsd = files.some((f) => f.name.toLowerCase().endsWith('.psd'))
    if (s.mapObjects.length && (files.length > 1 || hasPsd)) {
      await s.beginLink(files)
      if (useStore.getState().pendingLink) return
    }
    const psd = files.find((f) => f.name.toLowerCase().endsWith('.psd'))
    if (psd) await s.loadPsd(psd)
    else if (s.layeredMode) await s.loadImages(files, true)
    else if (files.length > 1) await s.loadImages(files, false)
    else await s.loadAtlasUrl(URL.createObjectURL(files[0]), true)
  } catch (err) {
    s.setStatus(`Map import failed: ${(err as Error).message}`)
  }
}
