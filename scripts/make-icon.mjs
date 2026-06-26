// Generate UV Studio app icons with zero dependencies.
//
//   node scripts/make-icon.mjs
//
// Produces src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png + icon.ico +
// icon.icns + app-icon.png (1024 source). Pure Node: rasterises a simple
// isometric-cube logo on the brand gradient, encodes PNG via zlib, and wraps
// PNGs into ICO/ICNS containers. Re-run any time, or replace later with
// `npm run tauri icon app-icon.png` for the official set.

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons')

// ---- tiny raster lib (RGBA, supersampled 2× for smooth edges) ---------------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

function render(size) {
  const SS = 2
  const W = size * SS
  const buf = new Float32Array(W * W * 4) // straight RGBA, premultiplied-ish accumulation
  const set = (x, y, [r, g, b], a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return
    const i = (y * W + x) * 4
    const ia = 1 - a
    buf[i] = buf[i] * ia + r * a
    buf[i + 1] = buf[i + 1] * ia + g * a
    buf[i + 2] = buf[i + 2] * ia + b * a
    buf[i + 3] = Math.min(1, buf[i + 3] * ia + a)
  }

  // rounded-square background with a vertical brand gradient
  const top = hex('#4aa9ff')
  const bot = hex('#1463d6')
  const r = W * 0.2
  const inRound = (x, y) => {
    const dx = Math.max(r - x, x - (W - r), 0)
    const dy = Math.max(r - y, y - (W - r), 0)
    return dx * dx + dy * dy <= r * r
  }
  for (let y = 0; y < W; y++) {
    const t = y / W
    const col = [top[0] + (bot[0] - top[0]) * t, top[1] + (bot[1] - top[1]) * t, top[2] + (bot[2] - top[2]) * t]
    for (let x = 0; x < W; x++) if (inRound(x, y)) set(x, y, col, 1)
  }

  // isometric cube (3 white-ish faces)
  const cx = W / 2
  const cy = W / 2
  const h = W * 0.22
  const poly = (pts, color) => {
    let minY = Infinity
    let maxY = -Infinity
    for (const [, py] of pts) {
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs = []
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]
        const b = pts[(i + 1) % pts.length]
        if (a[1] === b[1]) continue
        if (y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1])) {
          xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
        }
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.floor(xs[k]); x < Math.ceil(xs[k + 1]); x++) set(x, y, color, 1)
      }
    }
  }
  const pTop = [cx, cy - h]
  const pRight = [cx + h, cy - h * 0.5]
  const pFront = [cx, cy]
  const pLeft = [cx - h, cy - h * 0.5]
  poly([pTop, pRight, pFront, pLeft], hex('#ffffff')) // top
  poly([pLeft, pFront, [cx, cy + h], [cx - h, cy + h * 0.5]], hex('#dbe6f4')) // left
  poly([pFront, pRight, [cx + h, cy + h * 0.5], [cx, cy + h]], hex('#bccde2')) // right

  // box-downscale SS×SS → final RGBA8
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r2 = 0
      let g2 = 0
      let b2 = 0
      let a2 = 0
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4
          r2 += buf[i]
          g2 += buf[i + 1]
          b2 += buf[i + 2]
          a2 += buf[i + 3]
        }
      const n = SS * SS
      const o = (y * size + x) * 4
      out[o] = Math.round(r2 / n)
      out[o + 1] = Math.round(g2 / n)
      out[o + 2] = Math.round(b2 / n)
      out[o + 3] = Math.round((a2 / n) * 255)
    }
  }
  return out
}

// ---- PNG encoder ------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return (b) => {
    let c = 0xffffffff
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
})()
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(CRC(td))
  return Buffer.concat([len, td, crc])
}
function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const png = (size) => encodePNG(render(size), size)

// ---- ICO (single 256 PNG) ---------------------------------------------------
function ico(png256) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(1, 4)
  const e = Buffer.alloc(16)
  e[0] = 0 // 256 → 0
  e[1] = 0
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(png256.length, 8)
  e.writeUInt32LE(22, 12) // offset
  return Buffer.concat([dir, e, png256])
}

// ---- ICNS (PNG entries) -----------------------------------------------------
function icns(entries) {
  const parts = entries.map(([type, data]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(8 + data.length, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + body.length, 4)
  return Buffer.concat([head, body])
}

// ---- write all --------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true })
const p128 = png(128)
const p256 = png(256)
const p512 = png(512)
const p1024 = png(1024)
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), data)
write('32x32.png', png(32))
write('128x128.png', p128)
write('128x128@2x.png', p256)
write('icon.png', p512)
write('icon.ico', ico(p256))
write('icon.icns', icns([['ic07', p128], ['ic08', p256], ['ic09', p512], ['ic10', p1024]]))
fs.writeFileSync(path.join(OUT, '..', '..', 'app-icon.png'), p1024)
console.log('icons written to', OUT)
