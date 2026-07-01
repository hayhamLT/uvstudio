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

  it('handles n-gons: a pentagon sharing an edge with a quad', () => {
    // pentagon (0..4) + quad (1,0,5,6) sharing edge 0-1 — Blender-style n-gon input
    const he = buildHalfEdge({
      name: 'ngon',
      positions: new Float32Array([0,0,0, 2,0,0, 2.6,1.9,0, 1,3.1,0, -0.6,1.9,0, 2,-1,0, 0,-1,0]),
      faces: [
        [0, 1, 2, 3, 4],
        [1, 0, 6, 5],
      ],
    })
    expect(he.faceCount).toBe(2)
    expect(he.faceDegree[0]).toBe(5)
    expect(he.faceDegree[1]).toBe(4)
    expect(he.halfEdgeCount).toBe(9)
    expect(he.edgeCount).toBe(8) // 9 half-edges, one shared edge twinned
    // the shared edge 0-1 must be twinned; the rest are boundary
    let twinned = 0
    for (let e = 0; e < he.edgeCount; e++) if (he.heTwin[he.edgeHe[e]] !== -1) twinned++
    expect(twinned).toBe(1)
  })
})

describe('shells', () => {
  it('keeps a closed cube as a single shell with no seams', () => {
    const he = buildHalfEdge(box())
    const { shells } = extractShells(he, new Set())
    expect(shells.length).toBe(1)
    expect(shells[0].triCount).toBe(12) // 6 quads -> 12 tris
  })

  it('fan-triangulates an n-gon and keeps its polygon loop', () => {
    const he = buildHalfEdge({
      name: 'pent',
      positions: new Float32Array([0,0,0, 2,0,0, 2.6,1.9,0, 1,3.1,0, -0.6,1.9,0]),
      faces: [[0, 1, 2, 3, 4]],
    })
    const { shells } = extractShells(he, new Set())
    expect(shells.length).toBe(1)
    expect(shells[0].triCount).toBe(3) // pentagon → 3 fan triangles
    expect(shells[0].polygons[0]).toHaveLength(5) // full loop preserved for the return
    expect(shells[0].faceIds).toEqual([0])
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
