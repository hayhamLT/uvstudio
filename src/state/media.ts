// ---------------------------------------------------------------------------
// Reading imported media: images, PSDs, thumbnails, and the name-matching that
// suggests which layer belongs to which screen in the link wizard.
// ---------------------------------------------------------------------------
import { flattenPsdLayers, loadPsdFile } from '../mesh/loadPsd'
import { normalize, similarity } from '../map/ocr'
import type { MediaItem } from './types'

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    // WebKit (the desktop app's WKWebView, Safari) can upload a BLANK texture
    // when an image is handed to texImage2D straight from onload, before its
    // bitmap is decoded — decode() guarantees pixels are ready. Chromium
    // decodes synchronously on upload, so this is a no-op there.
    img.onload = () =>
      img.decode().then(
        () => resolve(img),
        () => resolve(img),
      )
    img.onerror = reject
    img.src = url
  })
}

/** Load a File/Blob as an image and RELEASE its object URL again. A bare
 *  `loadImage(URL.createObjectURL(f))` pins the file's full bytes in memory for
 *  the lifetime of the page — a session spent iterating on 8K PSDs ends up
 *  holding every revision it ever opened. */
export async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url) // the decoded bitmap outlives the URL
  }
}

/** True if the file is a Photoshop document — by extension OR by its "8BPS"
 *  magic bytes, so PSDs exported without a .psd suffix are still recognised. */
export async function isPsd(file: File): Promise<boolean> {
  if (/\.psd$/i.test(file.name)) return true
  try {
    const b = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    return b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53 // "8BPS"
  } catch {
    return false
  }
}

/** Explode media files into linkable items: one per image, one per PSD layer. */
/** Downscale any drawable source into a small dataURL for wizard preview tiles. */
export function thumbUrl(src: CanvasImageSource, sw: number, sh: number): string | undefined {
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

export async function imageThumb(file: File): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file)
    const t = thumbUrl(bmp, bmp.width, bmp.height)
    bmp.close()
    return t
  } catch {
    return undefined
  }
}

export async function parseMediaItems(files: File[], startId: number): Promise<MediaItem[]> {
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
export function suggestLinks(
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
