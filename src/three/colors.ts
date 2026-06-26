import * as THREE from 'three'

/** Distortion color ramp: green (good) → yellow → red (bad). */
export function distortionColor(d: number, out = new THREE.Color()): THREE.Color {
  const t = Math.min(1, Math.max(0, d))
  // green -> yellow at 0.5 -> red at 1
  if (t < 0.5) {
    const k = t / 0.5
    out.setRGB(0.27 + 0.73 * k, 0.83, 0.6 - 0.2 * k)
  } else {
    const k = (t - 0.5) / 0.5
    out.setRGB(1.0, 0.83 - 0.55 * k, 0.4 - 0.25 * k)
  }
  return out
}

/** Signed texel-density (stretch) ramp: red (UV too small / compressed) ←
 *  green (ideal density) → blue (UV too large / stretched). v in [-1, 1]. */
export function stretchColor(v: number, out = new THREE.Color()): THREE.Color {
  const g = [0.27, 0.83, 0.6] // green — ideal
  if (v >= 0) {
    const b = [0.25, 0.55, 1.0] // blue — expanded (scaled up)
    const k = Math.min(1, v)
    out.setRGB(g[0] + (b[0] - g[0]) * k, g[1] + (b[1] - g[1]) * k, g[2] + (b[2] - g[2]) * k)
  } else {
    const r = [1.0, 0.23, 0.3] // red — compressed (scaled down)
    const k = Math.min(1, -v)
    out.setRGB(g[0] + (r[0] - g[0]) * k, g[1] + (r[1] - g[1]) * k, g[2] + (r[2] - g[2]) * k)
  }
  return out
}

export const THEME = {
  surface: new THREE.Color('#7c8aa0'),
  surfaceDim: new THREE.Color('#3a4655'),
  wire: new THREE.Color('#0a0e14'),
  hover: new THREE.Color('#5cc8ff'),
  shell: new THREE.Color('#6b7a90'),
  shellSelected: new THREE.Color('#2da9f7'),
  good: new THREE.Color('#46d39a'),
}
