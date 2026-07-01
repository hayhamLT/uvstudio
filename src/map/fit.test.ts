import { describe, it, expect } from 'vitest'
import { buildHalfEdge } from '../mesh/halfedge'
import { flattenAndFit, type RectUV } from './fit'
import type { PolyMesh } from '../mesh/types'

const RECT: RectUV = { u0: 0, v0: 0, u1: 1, v1: 1 }

/** A flat 3x2 grid of quads in the y=0 plane (a "floor screen"). */
function grid(): PolyMesh {
  const positions: number[] = []
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) positions.push(i, 0, j)
  const idx = (i: number, j: number) => j * 4 + i
  const faces: number[][] = []
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 3; i++) faces.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)])
  return { name: 'grid', positions: Float32Array.from(positions), faces }
}

/** A flat pentagon (n-gon) in the y=0 plane. */
function pentagon(): PolyMesh {
  return {
    name: 'pent',
    positions: Float32Array.from([0, 0, 0, 2, 0, 0, 2.6, 0, 1.9, 1, 0, 3.1, -0.6, 0, 1.9]),
    faces: [[0, 1, 2, 3, 4]],
  }
}

function allFinite(uvs: Float32Array[]): boolean {
  return uvs.every((uv) => Array.from(uv).every((x) => Number.isFinite(x)))
}
function withinRect(uvs: Float32Array[], eps = 1e-4): boolean {
  return uvs.every((uv) => {
    for (let i = 0; i < uv.length; i += 2) {
      if (uv[i] < RECT.u0 - eps || uv[i] > RECT.u1 + eps) return false
      if (uv[i + 1] < RECT.v0 - eps || uv[i + 1] > RECT.v1 + eps) return false
    }
    return true
  })
}

describe('flattenAndFit', () => {
  it('unwraps a flat grid into the rect with finite UVs', () => {
    const r = flattenAndFit(buildHalfEdge(grid()), RECT, { relaxIters: 8 })
    expect(r.shells.length).toBe(1)
    expect(allFinite(r.uv)).toBe(true)
    expect(withinRect(r.uv)).toBe(true)
    // fill=false preserves aspect: the grid is 3x2 → wider than tall
    expect(r.srcAspect).toBeGreaterThan(1)
  })

  it('flipX mirrors U (and only U)', () => {
    const he = buildHalfEdge(grid())
    const a = flattenAndFit(he, RECT, { relaxIters: 0 })
    const b = flattenAndFit(he, RECT, { relaxIters: 0, flipX: true })
    const ua = a.uv[0]
    const ub = b.uv[0]
    // mirrored inside the rect: u + u' ≈ (u0 + u1), v unchanged
    const span = RECT.u0 + RECT.u1
    for (let i = 0; i < ua.length; i += 2) {
      expect(ua[i] + ub[i]).toBeCloseTo(span, 3)
      expect(ua[i + 1]).toBeCloseTo(ub[i + 1], 3)
    }
  })

  it('unwraps an n-gon (pentagon) without NaN and inside the rect', () => {
    const r = flattenAndFit(buildHalfEdge(pentagon()), RECT, { relaxIters: 8 })
    expect(allFinite(r.uv)).toBe(true)
    expect(withinRect(r.uv)).toBe(true)
    expect(r.shells[0].polygons[0]).toHaveLength(5) // loop survives for the return
  })

  it('forced planar projection matches auto on a flat patch (finite, in rect)', () => {
    const r = flattenAndFit(buildHalfEdge(grid()), RECT, { projection: 'planar' })
    expect(allFinite(r.uv)).toBe(true)
    expect(withinRect(r.uv)).toBe(true)
  })
})
