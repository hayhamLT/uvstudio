import type { Region } from './types'

// ---------------------------------------------------------------------------
// Name matching between screen objects and map regions, plus best-effort OCR
// to read region labels straight from the image. OCR is lazy-loaded so it never
// bloats the main bundle and degrades gracefully to manual assignment.
// ---------------------------------------------------------------------------

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Greedily pair names to labelled candidates, ONE-TO-ONE, preferring exact
 * (normalised) name equality before any fuzzy match. This stops near-miss names
 * (e.g. PILLAR_SCREEN vs WALL_SCREEN_05) from stealing each other's slot, while
 * still tolerating minor variants (WALL_SCREEN_1 ↔ WALL_SCREEN_01). Unmatched
 * names are simply left out. Returns name -> candidate id.
 */
export function matchNamesToLabels(
  names: string[],
  cands: { id: number; label: string }[],
  fuzzy = 0.82,
): Record<string, number> {
  const out: Record<string, number> = {}
  const usedId = new Set<number>()
  const usedName = new Set<string>()
  // 1. exact normalised matches win first
  for (const name of names) {
    const c = cands.find((c) => !usedId.has(c.id) && normalize(c.label) === normalize(name))
    if (c) {
      out[name] = c.id
      usedId.add(c.id)
      usedName.add(name)
    }
  }
  // 2. high-confidence fuzzy for the leftovers, still one-to-one
  const pairs: { name: string; id: number; sim: number }[] = []
  for (const name of names) {
    if (usedName.has(name)) continue
    for (const c of cands) {
      if (usedId.has(c.id)) continue
      pairs.push({ name, id: c.id, sim: similarity(name, c.label) })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim)
  for (const p of pairs) {
    if (p.sim < fuzzy) break
    if (usedName.has(p.name) || usedId.has(p.id)) continue
    out[p.name] = p.id
    usedName.add(p.name)
    usedId.add(p.id)
  }
  return out
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  const prev = new Array(n + 1)
  const cur = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]
  }
  return prev[n]
}

/** 0..1 similarity, snapping OCR noise to the closest known name. */
export function similarity(a: string, b: string): number {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return 0
  if (x === y) return 1
  // reward substring containment (labels often include resolution suffixes)
  if (x.includes(y) || y.includes(x)) return 0.9
  const d = levenshtein(x, y)
  return 1 - d / Math.max(x.length, y.length)
}

/**
 * Greedily pair object names with regions by best label similarity.
 * Returns objectName -> regionId for confident matches (sim >= threshold).
 */
export function matchByLabels(
  objectNames: string[],
  regions: Region[],
  threshold = 0.45,
): Record<string, number> {
  const pairs: { obj: string; rid: number; sim: number }[] = []
  for (const obj of objectNames) {
    for (const r of regions) {
      if (!r.label) continue
      pairs.push({ obj, rid: r.id, sim: similarity(obj, r.label) })
    }
  }
  pairs.sort((a, b) => b.sim - a.sim)
  const usedObj = new Set<string>()
  const usedReg = new Set<number>()
  const out: Record<string, number> = {}
  for (const p of pairs) {
    if (p.sim < threshold) break
    if (usedObj.has(p.obj) || usedReg.has(p.rid)) continue
    out[p.obj] = p.rid
    usedObj.add(p.obj)
    usedReg.add(p.rid)
  }
  return out
}

/**
 * OCR the center of each region to read its label. Best-effort: returns the
 * regions with `label` filled where text was found. Lazy-imports tesseract.js.
 */
export async function ocrRegionLabels(
  source: CanvasImageSource & { width: number; height: number },
  regions: Region[],
): Promise<Region[]> {
  let Tesseract: typeof import('tesseract.js')
  try {
    Tesseract = await import('tesseract.js')
  } catch {
    return regions // OCR unavailable; caller falls back to manual assignment
  }
  const W = source.width
  const H = source.height
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const worker = await Tesseract.createWorker('eng')
  try {
    for (const r of regions) {
      const x = Math.round(r.x0 * W)
      const y = Math.round(r.y0 * H)
      const w = Math.max(1, Math.round((r.x1 - r.x0) * W))
      const h = Math.max(1, Math.round((r.y1 - r.y0) * H))
      const up = 2 // upscale small crops for legibility
      canvas.width = w * up
      canvas.height = h * up
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(source, x, y, w, h, 0, 0, w * up, h * up)
      // Boost contrast: labels are usually white on color.
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const d = img.data
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        const v = lum > 150 ? 0 : 255 // dark text on white for OCR
        d[i] = d[i + 1] = d[i + 2] = v
      }
      ctx.putImageData(img, 0, 0)
      const { data } = await worker.recognize(canvas)
      const text = (data.text || '').trim().split('\n')[0]?.trim()
      if (text) r.label = text
    }
  } finally {
    await worker.terminate()
  }
  return regions
}
