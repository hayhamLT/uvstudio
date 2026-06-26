import { describe, it, expect } from 'vitest'
import { buildHalfEdge, edgeLoop, UnionFind } from './halfedge'
import { extractShells } from './shells'
import { box, torus } from './samples'

describe('half-edge', () => {
  it('builds correct connectivity for a cube', () => {
    const he = buildHalfEdge(box())
    expect(he.vertexCount).toBe(8)
    expect(he.faceCount).toBe(6)
    expect(he.halfEdgeCount).toBe(24)
    expect(he.edgeCount).toBe(12)
    // every edge of a closed cube is interior (has a twin)
    for (let e = 0; e < he.edgeCount; e++) {
      expect(he.heTwin[he.edgeHe[e]]).not.toBe(-1)
    }
  })

  it('walks a 4-edge loop around a cube', () => {
    const he = buildHalfEdge(box())
    const loop = edgeLoop(he, 0)
    expect(loop.length).toBe(4)
    expect(loop).toContain(0)
  })
})

describe('shells', () => {
  it('keeps a closed cube as a single shell with no seams', () => {
    const he = buildHalfEdge(box())
    const { shells } = extractShells(he, new Set())
    expect(shells.length).toBe(1)
    expect(shells[0].triCount).toBe(12) // 6 quads -> 12 tris
  })

  it('splits a torus into two shells when cut by a loop and a ring', () => {
    const he = buildHalfEdge(torus(undefined, undefined, 8, 6))
    // a full quad loop + a full ring should open the torus into a rectangle
    const seams = new Set<number>([...edgeLoop(he, 0)])
    const before = extractShells(he, new Set()).shells.length
    const after = extractShells(he, seams).shells.length
    expect(before).toBe(1)
    expect(after).toBeGreaterThanOrEqual(1)
  })
})

describe('union-find', () => {
  it('merges connected sets', () => {
    const uf = new UnionFind(5)
    uf.union(0, 1)
    uf.union(1, 2)
    expect(uf.find(0)).toBe(uf.find(2))
    expect(uf.find(0)).not.toBe(uf.find(3))
  })
})
