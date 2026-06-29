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
        points: [0, 0, 3, 1, 0, 3, 1, 1, 5, 0, 1, 5],
        polys: [[0, 1, 2, 3]],
      },
    ],
  }

  it('builds geometry from points + polys (quad preserved, Z negated for handedness)', () => {
    const objs = sceneFromSidecar(sidecar)
    expect(objs).toHaveLength(1)
    expect(objs[0].name).toBe('Wall')
    expect(objs[0].c4dGuid).toBe('abc')
    // C4D (left-handed) → app (right-handed): Z is negated on import; X/Y unchanged.
    expect(Array.from(objs[0].mesh.positions)).toEqual([0, 0, -3, 1, 0, -3, 1, 1, -5, 0, 1, -5])
    expect(objs[0].mesh.faces).toEqual([[0, 1, 2, 3]]) // quad preserved, not triangulated
  })

  it('welds triangle-soup geometry so adjacent faces share vertices', () => {
    // two triangles forming a quad, sent as a soup: 6 points, the shared edge
    // duplicated (verts 0≡3 and 2≡4 by position).
    const soup: ForwardSidecar = {
      v: 2,
      ts: 0,
      kind: 'geo-forward',
      objects: [
        {
          name: 'Soup',
          guid: 'g',
          points: [0, 0, 0, 1, 0, 0, 1, 1, 0, /*dup*/ 0, 0, 0, 1, 1, 0, 0, 1, 0],
          polys: [
            [0, 1, 2],
            [3, 4, 5],
          ],
        },
      ],
    }
    const [obj] = sceneFromSidecar(soup)
    expect(obj.mesh.positions.length / 3).toBe(4) // 6 soup points → 4 unique
    expect(obj.mesh.faces).toHaveLength(2) // face count + corner order preserved
    // the two triangles now share their welded corner indices (connected)
    const shared = obj.mesh.faces[0].filter((v) => obj.mesh.faces[1].includes(v))
    expect(shared.length).toBe(2)
  })

  it('carries imported UVs through to the SceneObject', () => {
    const sc: ForwardSidecar = {
      v: 2,
      ts: 0,
      kind: 'geo-forward',
      objects: [
        {
          name: 'S',
          guid: 'g',
          points: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          polys: [[0, 1, 2]],
          uv: [[0.1, 0.2, 0.3, 0.4, 0.5, 0.6]],
        },
      ],
    }
    const [obj] = sceneFromSidecar(sc)
    expect(obj.uvs).toBeDefined()
    ;[0.1, 0.2, 0.3, 0.4, 0.5, 0.6].forEach((want, i) => expect(obj.uvs![i]).toBeCloseTo(want))
    expect(obj.mesh.faces).toEqual([[0, 1, 2]])
  })

  it('welds by POSITION only, even when imported UVs differ at a shared point', () => {
    // two triangles share the point at (1,0,0) with different UVs there; we weld
    // by position (clean topology for unwrap), so it stays ONE vertex, not split.
    const sc: ForwardSidecar = {
      v: 2,
      ts: 0,
      kind: 'geo-forward',
      objects: [
        {
          name: 'S',
          guid: 'g',
          points: [0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 1, 0],
          polys: [
            [0, 1, 2],
            [1, 3, 2],
          ],
          uv: [
            [0, 0, 0.5, 0, 0.5, 1],
            [0.9, 0, 1, 1, 0.5, 1],
          ],
        },
      ],
    }
    const [obj] = sceneFromSidecar(sc)
    expect(obj.mesh.positions.length / 3).toBe(4) // 4 unique positions, no UV split
    // the two triangles share the welded corners (connected manifold)
    const shared = obj.mesh.faces[0].filter((v) => obj.mesh.faces[1].includes(v))
    expect(shared.length).toBe(2)
  })
})
