import { describe, it, expect } from 'vitest'
import type { Shell } from '../mesh/types'
import { buildParamContext, lscm, arapIterate } from './param'
import { computeDistortion } from './distortion'

/** A flat 2x2 grid of quads in the z=0 plane, fan-triangulated. */
function flatPatch(): Shell {
  const positions: number[] = []
  const idx = (i: number, j: number) => j * 3 + i
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < 3; i++) positions.push(i, j, 0)
  const triangles: number[] = []
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const a = idx(i, j),
        b = idx(i + 1, j),
        c = idx(i + 1, j + 1),
        d = idx(i, j + 1)
      triangles.push(a, b, c, a, c, d)
    }
  }
  return {
    id: 0,
    positions: Float32Array.from(positions),
    triangles: Uint32Array.from(triangles),
    polygons: [],
    toOrigVertex: new Int32Array(9),
    vertCount: 9,
    triCount: triangles.length / 3,
    faceIds: [],
  }
}

describe('parameterization', () => {
  it('LSCM flattens a planar patch with near-zero distortion', () => {
    const shell = flatPatch()
    const ctx = buildParamContext(shell)
    const uv = Float32Array.from(lscm(ctx))
    const d = computeDistortion(shell.positions, uv, shell.triangles)
    expect(d.overall).toBeLessThan(0.02)
    expect(d.flippedTris).toBe(0)
    expect(Number.isFinite(uv[2])).toBe(true)
  })

  it('ARAP keeps a planar patch low-distortion and stable', () => {
    const shell = flatPatch()
    const ctx = buildParamContext(shell)
    const uv = lscm(ctx)
    for (let i = 0; i < 10; i++) arapIterate(ctx, uv)
    const d = computeDistortion(shell.positions, Float32Array.from(uv), shell.triangles)
    expect(d.overall).toBeLessThan(0.05)
  })
})
