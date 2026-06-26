import { describe, it, expect } from 'vitest'
import { packIslands } from './pack'

function square(x0: number, y0: number, s: number): Float32Array {
  return Float32Array.from([x0, y0, x0 + s, y0, x0 + s, y0 + s, x0, y0 + s])
}

describe('packing', () => {
  it('packs islands inside the unit square', () => {
    const islands = [
      { uv: square(0, 0, 2) },
      { uv: square(10, 10, 1) },
      { uv: square(-5, 3, 1.5) },
    ]
    const res = packIslands(islands, { angleSteps: 8 })
    expect(res.uv.length).toBe(3)
    for (const uv of res.uv) {
      for (const c of uv) {
        expect(c).toBeGreaterThanOrEqual(-1e-3)
        expect(c).toBeLessThanOrEqual(1 + 1e-3)
        expect(Number.isFinite(c)).toBe(true)
      }
    }
    expect(res.fill).toBeGreaterThan(0)
    expect(res.fill).toBeLessThanOrEqual(1)
  })

  it('preserves relative island areas (uniform texel density)', () => {
    const big = { uv: square(0, 0, 2) }
    const small = { uv: square(0, 0, 1) }
    const res = packIslands([big, small], { angleSteps: 8 })
    const area = (uv: Float32Array) => {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity
      for (let i = 0; i < uv.length; i += 2) {
        minX = Math.min(minX, uv[i])
        maxX = Math.max(maxX, uv[i])
        minY = Math.min(minY, uv[i + 1])
        maxY = Math.max(maxY, uv[i + 1])
      }
      return (maxX - minX) * (maxY - minY)
    }
    const ratio = area(res.uv[0]) / area(res.uv[1])
    expect(ratio).toBeGreaterThan(3.5) // ~4x area, allowing margin
    expect(ratio).toBeLessThan(4.5)
  })
})
