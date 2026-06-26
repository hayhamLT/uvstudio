import * as THREE from 'three'

/**
 * A procedural checker texture used both as the 3D surface overlay and the 2D
 * UV-space background. Tinted to match the studio theme.
 */
export function makeCheckerTexture(
  size = 1024,
  cells = 16,
  a = '#1b2330',
  b = '#2a3b50',
): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b
      ctx.fillRect(x * c, y * c, c, c)
    }
  }
  // accent grid lines every 4 cells
  ctx.strokeStyle = 'rgba(92,200,255,0.35)'
  ctx.lineWidth = Math.max(1, size / 512)
  for (let i = 0; i <= cells; i += 4) {
    ctx.beginPath()
    ctx.moveTo(i * c, 0)
    ctx.lineTo(i * c, size)
    ctx.moveTo(0, i * c)
    ctx.lineTo(size, i * c)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * A UV checker whose cells are PERFECT SQUARES in the texture's real pixel
 * proportions — the industry-standard diagnostic. A square texture gets N×N
 * cells; a wide (e.g. 11.4:1 panorama) texture gets ~11×N cells across × N down,
 * each one square. Mapped through the authored UVs, the cells stay square ONLY
 * where the mapping is proportional, and visibly stretch/skew where it isn't —
 * which is the whole point of a checker. (A naive square N×N checker would show
 * the panorama as long rectangles even when the mapping is perfect.)
 *
 * Cached per aspect so repeated screens share one texture.
 */
const checkerCache = new Map<string, THREE.Texture>()
export function checkerForAspect(
  aspect: number,
  rows = 12,
  a = '#f2f3f5',
  b = '#8b93a0',
): THREE.Texture {
  const A = aspect > 0 && isFinite(aspect) ? aspect : 1
  const key = `${Math.round(A * 100)}|${rows}|${a}|${b}`
  const hit = checkerCache.get(key)
  if (hit) return hit
  const cols = Math.max(1, Math.round(rows * A)) // more cells across for wide maps
  // keep the canvas within sane bounds while keeping cells crisp
  const cell = Math.max(3, Math.min(40, Math.floor(4096 / Math.max(cols, rows))))
  const w = cols * cell
  const h = rows * cell
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  // accent grid lines every 4 cells (both axes, same spacing → square grid)
  ctx.strokeStyle = 'rgba(92,200,255,0.35)'
  ctx.lineWidth = Math.max(1, cell / 16)
  for (let i = 0; i <= cols; i += 4) {
    ctx.beginPath()
    ctx.moveTo(i * cell, 0)
    ctx.lineTo(i * cell, h)
    ctx.stroke()
  }
  for (let i = 0; i <= rows; i += 4) {
    ctx.beginPath()
    ctx.moveTo(0, i * cell)
    ctx.lineTo(w, i * cell)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  tex.colorSpace = THREE.SRGBColorSpace
  checkerCache.set(key, tex)
  return tex
}

/**
 * Photoshop-style transparency checkerboard (neutral gray) shown behind images
 * with alpha, so transparent areas read as "transparent" instead of white.
 */
export function makeAlphaChecker(): THREE.Texture {
  const s = 16
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#aab0ba'
  ctx.fillRect(0, 0, s, s)
  ctx.fillStyle = '#ced3db'
  ctx.fillRect(0, 0, s / 2, s / 2)
  ctx.fillRect(s / 2, s / 2, s / 2, s / 2)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
