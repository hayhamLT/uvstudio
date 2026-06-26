import type { PolyMesh } from './types'

// ---------------------------------------------------------------------------
// Procedural sample meshes. Built with quad topology wherever possible so the
// edge-loop seam tools feel like the real UVLayout.
// ---------------------------------------------------------------------------

class Builder {
  positions: number[] = []
  faces: number[][] = []
  private map = new Map<string, number>()

  vertex(x: number, y: number, z: number): number {
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
    const existing = this.map.get(key)
    if (existing !== undefined) return existing
    const idx = this.positions.length / 3
    this.positions.push(x, y, z)
    this.map.set(key, idx)
    return idx
  }

  quad(a: number, b: number, c: number, d: number) {
    this.faces.push([a, b, c, d])
  }

  tri(a: number, b: number, c: number) {
    this.faces.push([a, b, c])
  }

  build(name: string): PolyMesh {
    return { name, positions: Float32Array.from(this.positions), faces: this.faces }
  }
}

/** A subdivided box, projected onto a sphere — all quads, great for loops. */
export function quadSphere(seg = 8, radius = 1): PolyMesh {
  const b = new Builder()
  const project = (x: number, y: number, z: number): [number, number, number] => {
    // spherify a cube point for even-ish distribution
    const x2 = x * x,
      y2 = y * y,
      z2 = z * z
    const nx = x * Math.sqrt(1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3)
    const ny = y * Math.sqrt(1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3)
    const nz = z * Math.sqrt(1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3)
    return [nx * radius, ny * radius, nz * radius]
  }
  // 6 faces of the cube, each subdivided seg×seg
  const faceDirs: [[number, number, number], [number, number, number], [number, number, number]][] = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], // +z
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], // -z
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], // +x
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], // -x
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], // +y
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]], // -y
  ]
  for (const [normal, uDir, vDir] of faceDirs) {
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const corner = (ii: number, jj: number) => {
          const u = (ii / seg) * 2 - 1
          const v = (jj / seg) * 2 - 1
          const x = normal[0] + uDir[0] * u + vDir[0] * v
          const y = normal[1] + uDir[1] * u + vDir[1] * v
          const z = normal[2] + uDir[2] * u + vDir[2] * v
          const [px, py, pz] = project(x, y, z)
          return b.vertex(px, py, pz)
        }
        b.quad(corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1))
      }
    }
  }
  return b.build('Quad Sphere')
}

/** Simple 6-quad cube. */
export function box(size = 1): PolyMesh {
  const b = new Builder()
  const s = size
  const v = (x: number, y: number, z: number) => b.vertex(x * s, y * s, z * s)
  const p = [
    v(-1, -1, -1),
    v(1, -1, -1),
    v(1, 1, -1),
    v(-1, 1, -1),
    v(-1, -1, 1),
    v(1, -1, 1),
    v(1, 1, 1),
    v(-1, 1, 1),
  ]
  b.quad(p[4], p[5], p[6], p[7]) // +z
  b.quad(p[1], p[0], p[3], p[2]) // -z
  b.quad(p[5], p[1], p[2], p[6]) // +x
  b.quad(p[0], p[4], p[7], p[3]) // -x
  b.quad(p[7], p[6], p[2], p[3]) // +y
  b.quad(p[0], p[1], p[5], p[4]) // -y
  return b.build('Cube')
}

/** Closed torus — all quads. Needs two seams to unwrap (classic demo). */
export function torus(R = 1, r = 0.4, majorSeg = 24, minorSeg = 12): PolyMesh {
  const b = new Builder()
  const idx = (i: number, j: number) => {
    const u = (i % majorSeg) / majorSeg * Math.PI * 2
    const vv = (j % minorSeg) / minorSeg * Math.PI * 2
    const cx = Math.cos(u)
    const cz = Math.sin(u)
    const x = (R + r * Math.cos(vv)) * cx
    const z = (R + r * Math.cos(vv)) * cz
    const y = r * Math.sin(vv)
    return b.vertex(x, y, z)
  }
  for (let i = 0; i < majorSeg; i++) {
    for (let j = 0; j < minorSeg; j++) {
      b.quad(idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1))
    }
  }
  return b.build('Torus')
}

/** Cylinder: quad sides + triangle-fan caps. */
export function cylinder(radius = 0.7, height = 2, radial = 24, heightSeg = 6): PolyMesh {
  const b = new Builder()
  const ring = (j: number, h: number) => {
    const a = (j % radial) / radial * Math.PI * 2
    return b.vertex(Math.cos(a) * radius, h, Math.sin(a) * radius)
  }
  for (let s = 0; s < heightSeg; s++) {
    const y0 = -height / 2 + (height * s) / heightSeg
    const y1 = -height / 2 + (height * (s + 1)) / heightSeg
    for (let j = 0; j < radial; j++) {
      b.quad(ring(j, y0), ring(j + 1, y0), ring(j + 1, y1), ring(j, y1))
    }
  }
  const top = b.vertex(0, height / 2, 0)
  const bot = b.vertex(0, -height / 2, 0)
  for (let j = 0; j < radial; j++) {
    b.tri(bot, ring(j + 1, -height / 2), ring(j, -height / 2))
    b.tri(top, ring(j, height / 2), ring(j + 1, height / 2))
  }
  return b.build('Cylinder')
}

export interface SampleDef {
  key: string
  label: string
  make: () => PolyMesh
}

export const SAMPLES: SampleDef[] = [
  { key: 'sphere', label: 'Quad Sphere', make: () => quadSphere(8) },
  { key: 'cube', label: 'Cube', make: () => box(1) },
  { key: 'cylinder', label: 'Cylinder', make: () => cylinder() },
  { key: 'torus', label: 'Torus', make: () => torus() },
]
