import type { Region } from './types'

// ---------------------------------------------------------------------------
// Detect solid-colored rectangular regions in a map/atlas image.
//
// The image is downscaled (which averages out thin grid lines + text), then
// region-grown into connected components of similar color. White/background and
// tiny specks are dropped. Returns normalized rectangles (origin top-left).
// ---------------------------------------------------------------------------

export interface DetectOpts {
  maxDim?: number // working resolution for detection
  colorTol?: number // max RGB distance within a region
  minAreaFrac?: number // drop regions smaller than this fraction of the image
  whiteCut?: number // pixels with all channels above this count as background
}

export function detectRegions(
  source: CanvasImageSource & { width: number; height: number },
  opts: DetectOpts = {},
): Region[] {
  const maxDim = opts.maxDim ?? 360
  const colorTol = opts.colorTol ?? 64
  const minAreaFrac = opts.minAreaFrac ?? 0.003
  const whiteCut = opts.whiteCut ?? 232

  const srcW = source.width
  const srcH = source.height
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  const visited = new Uint8Array(w * h)
  const isBg = (i: number) =>
    data[i * 4] > whiteCut && data[i * 4 + 1] > whiteCut && data[i * 4 + 2] > whiteCut
  const dist2 = (i: number, r: number, g: number, b: number) => {
    const dr = data[i * 4] - r
    const dg = data[i * 4 + 1] - g
    const db = data[i * 4 + 2] - b
    return dr * dr + dg * dg + db * db
  }

  const tol2 = colorTol * colorTol
  const minPx = Math.max(8, minAreaFrac * w * h)
  const regions: Region[] = []
  const queue = new Int32Array(w * h)

  for (let start = 0; start < w * h; start++) {
    if (visited[start] || isBg(start)) continue
    const sr = data[start * 4]
    const sg = data[start * 4 + 1]
    const sb = data[start * 4 + 2]
    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0
    let sumR = 0,
      sumG = 0,
      sumB = 0,
      count = 0
    while (head < tail) {
      const p = queue[head++]
      const px = p % w
      const py = (p / w) | 0
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py
      sumR += data[p * 4]
      sumG += data[p * 4 + 1]
      sumB += data[p * 4 + 2]
      count++
      const neigh = [p - 1, p + 1, p - w, p + w]
      const nx = [px - 1, px + 1, px, px]
      const ny = [py, py, py - 1, py + 1]
      for (let k = 0; k < 4; k++) {
        const np = neigh[k]
        if (nx[k] < 0 || nx[k] >= w || ny[k] < 0 || ny[k] >= h) continue
        if (visited[np] || isBg(np)) continue
        if (dist2(np, sr, sg, sb) > tol2) continue
        visited[np] = 1
        queue[tail++] = np
      }
    }
    if (count < minPx) continue
    regions.push({
      id: regions.length,
      x0: minX / w,
      y0: minY / h,
      x1: (maxX + 1) / w,
      y1: (maxY + 1) / h,
      color: [
        Math.round(sumR / count),
        Math.round(sumG / count),
        Math.round(sumB / count),
      ],
      areaFrac: count / (w * h),
    })
  }

  // Largest first — usually the most significant screens.
  regions.sort((a, b) => b.areaFrac - a.areaFrac)
  regions.forEach((r, i) => (r.id = i))
  return regions
}
