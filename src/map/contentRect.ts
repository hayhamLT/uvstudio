export interface ContentRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

const FULL: ContentRect = { u0: 0, v0: 0, u1: 1, v1: 1 }

/** Normalized (0..1, top-left origin) bounding box of the OPAQUE pixels of an
 *  image, or null if fully transparent / untestable. Downscaled for speed. */
export function opaqueBBoxNorm(
  img: CanvasImageSource,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const src = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }
  const w = src.naturalWidth || src.width || 0
  const h = src.naturalHeight || src.height || 0
  if (!w || !h) return null
  const scale = Math.min(1, 256 / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = ch
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, cw, ch)
  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, cw, ch).data
  } catch {
    return null // tainted canvas, etc.
  }
  const ALPHA = 8
  let minX = cw,
    minY = ch,
    maxX = -1,
    maxY = -1
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (data[(y * cw + x) * 4 + 3] > ALPHA) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x0: minX / cw, y0: minY / ch, x1: (maxX + 1) / cw, y1: (maxY + 1) / ch }
}

/**
 * Opaque content bounds of an image in UV space (0..1), flipY=true convention
 * (image top → v=1). Returns the full rect for opaque / untestable images.
 */
export function contentRectFromImage(img: CanvasImageSource): ContentRect {
  const b = opaqueBBoxNorm(img)
  if (!b) return FULL
  return { u0: b.x0, u1: b.x1, v0: 1 - b.y1, v1: 1 - b.y0 }
}

/** True when the rect is (almost) the whole texture — nothing meaningful to trim. */
export function isFullRect(r: ContentRect): boolean {
  return r.u0 < 0.002 && r.v0 < 0.002 && r.u1 > 0.998 && r.v1 > 0.998
}
