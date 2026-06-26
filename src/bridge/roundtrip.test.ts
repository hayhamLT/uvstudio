import { describe, it, expect } from 'vitest'
import { buildReturnObject, sceneFromSidecar, type ReturnObjectInput, type ForwardSidecar } from './roundtrip'
import type { Shell } from '../mesh/types'

// A shell holding one quad (face 0, corners 0,1,2,3) and one triangle
// (face 1, corners 4,5,6). buildReturnObject only reads faceIds, polygons and uv.
function shell(): Shell {
  return {
    id: 0,
    positions: new Float32Array(0),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6]),
    polygons: [
      [0, 1, 2, 3],
      [4, 5, 6],
    ],
    toOrigVertex: Int32Array.from([0, 1, 2, 3, 4, 5, 6]),
    vertCount: 7,
    triCount: 3,
    faceIds: [0, 1],
  }
}

const UV = Float32Array.from([
  0, 0, 1, 0, 1, 1, 0, 1, // quad corners
  0.2, 0.2, 0.5, 0.2, 0.2, 0.5, // triangle corners
])

describe('buildReturnObject', () => {
  const input: ReturnObjectInput = { name: 'Wall', guid: 'g1', polyCount: 2, shells: [shell()], uv: () => UV }

  it('emits one row per C4D polygon, keyed by faceId', () => {
    const r = buildReturnObject(input)
    expect(r.polyCount).toBe(2)
    expect(r.uv).toHaveLength(2)
    expect(r.name).toBe('Wall')
    expect(r.guid).toBe('g1')
    expect(r.vFlip).toBe(true)
  })

  it('emits quad corners straight across (raw V-up; plugin flips)', () => {
    const r = buildReturnObject(input)
    expect(r.uv[0]).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
  })

  it('pads a triangle to 4 corners by repeating the last (d = c)', () => {
    const r = buildReturnObject(input)
    const row = r.uv[1]!
    expect(row).toHaveLength(8)
    ;[0.2, 0.2, 0.5, 0.2, 0.2, 0.5, 0.2, 0.5].forEach((v, i) => expect(row[i]).toBeCloseTo(v, 5))
  })

  it('leaves unmapped polygons null', () => {
    const r = buildReturnObject({ ...input, polyCount: 4 })
    expect(r.uv[2]).toBeNull()
    expect(r.uv[3]).toBeNull()
  })

  it('skips a shell with no UVs', () => {
    const r = buildReturnObject({ ...input, uv: () => undefined })
    expect(r.uv).toEqual([null, null])
  })
})

describe('sceneFromSidecar', () => {
  const sidecar: ForwardSidecar = {
    v: 2,
    ts: 0,
    kind: 'geo-forward',
    objects: [
      {
        name: 'Wall',
        guid: 'abc',
        points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        polys: [[0, 1, 2, 3]],
      },
    ],
  }

  it('builds geometry 1:1 from points + polys with identity provenance', () => {
    const objs = sceneFromSidecar(sidecar)
    expect(objs).toHaveLength(1)
    expect(objs[0].name).toBe('Wall')
    expect(objs[0].c4dGuid).toBe('abc')
    expect(Array.from(objs[0].mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    expect(objs[0].mesh.faces).toEqual([[0, 1, 2, 3]]) // quad preserved, not triangulated
  })
})
