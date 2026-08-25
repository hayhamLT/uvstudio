// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import * as THREE from 'three'
import { useStore } from './store'
import { live, resetLive } from './live'
import { demoArena, demoRegions } from '../map/demo'
import type { PolyMesh, SceneObject } from '../mesh/types'

/** N disconnected unit quads inside ONE object — each becomes its own shell. */
function shatteredObject(name: string, n: number): SceneObject {
  const positions = new Float32Array(n * 4 * 3)
  const faces: number[][] = []
  for (let i = 0; i < n; i++) {
    const x = i * 10 // far apart, so nothing welds or connects
    const b = i * 4
    positions.set([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0], b * 3)
    faces.push([b, b + 1, b + 2, b + 3])
  }
  const mesh: PolyMesh = { name, positions, faces }
  return { name, mesh }
}

beforeEach(() => {
  resetLive()
  useStore.setState({ mapObjects: [], mapShells: [], contextShells: [] })
})

describe('loadScene', () => {
  it('splits chosen names into screens and the rest into reference geometry', () => {
    const objects = demoArena()
    useStore.getState().loadScene(objects, { screenNames: ['NEZS', 'NEAX'] })
    const s = useStore.getState()
    expect(s.mapObjects.map((o) => o.name)).toEqual(['NEZS', 'NEAX'])
    expect(s.contextCount).toBe(objects.length - 2)
  })

  it('gives every shell a unique id even past 1000 shells in one object', () => {
    // Regression: ids used to be `objectIndex * 1000 + shellIndex`, so an object
    // with 1000+ connected components collided with the next object's ids — and
    // live.uv is keyed by them, so two screens silently shared one UV array.
    // An LED wall modelled as individual tiles hits this routinely.
    const objects = [shatteredObject('WALL_TILES', 1200), ...demoArena()]
    useStore.getState().loadScene(objects)
    const s = useStore.getState()
    const ids = [...s.mapShells, ...s.contextShells].map((m) => m.id)
    expect(ids.length).toBeGreaterThan(1200)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('bumps the UV epoch so the viewports re-upload their buffers', () => {
    const before = live.uvEpoch
    useStore.getState().loadScene(demoArena())
    expect(live.uvEpoch).toBeGreaterThan(before)
  })
})

/** Atlas mode with the demo layout: each screen assigned to its labelled
 *  region, which is what gives runMapping something to fit the UVs to. */
function loadDemoAtlasScene() {
  const objects = demoArena()
  useStore.getState().loadScene(objects)
  const regions = demoRegions()
  live.atlasAspect = 16 / 9
  useStore.setState({ regions, layeredMode: false })
  for (const o of objects) {
    const r = regions.find((x) => x.label === o.name)
    if (r) useStore.getState().assign(o.name, r.id)
  }
  return objects
}

describe('runMapping', () => {
  it('maps every assigned screen to finite UVs', () => {
    const objects = loadDemoAtlasScene()
    useStore.getState().runMapping()
    expect(useStore.getState().mapObjects.length).toBe(objects.length)
    const s = useStore.getState()
    expect(s.mappedObjects.length).toBe(s.mapObjects.length)
    expect(s.hasUV).toBe(true)
    for (const ms of s.mapShells) {
      const uv = live.uv.get(ms.id)
      expect(uv, `shell ${ms.id} has no UVs`).toBeDefined()
      expect(uv!.every((n) => Number.isFinite(n))).toBe(true)
    }
  })
})

describe('undo / redo', () => {
  beforeEach(() => {
    loadDemoAtlasScene()
    useStore.getState().runMapping()
  })

  it('round-trips a rotate', () => {
    const s = useStore.getState()
    const obj = s.mapObjects[0]
    const id = obj.shellIds[0]
    const before = Array.from(live.uv.get(id)!)

    s.rotateObject(obj.name, 'cw')
    const rotated = Array.from(live.uv.get(id)!)
    expect(rotated).not.toEqual(before)

    useStore.getState().undo()
    expect(Array.from(live.uv.get(id)!)).toEqual(before)

    useStore.getState().redo()
    expect(Array.from(live.uv.get(id)!)).toEqual(rotated)
  })

  it('caps history so a long session cannot grow without bound', () => {
    const name = useStore.getState().mapObjects[0].name
    for (let i = 0; i < 150; i++) useStore.getState().rotateObject(name, 'cw')
    expect(useStore.getState().undoCount).toBeLessThanOrEqual(60)
    // and it is still usable, not emptied
    expect(useStore.getState().undoCount).toBeGreaterThan(0)
  })
})

describe('resetLive', () => {
  it('disposes screen textures and drops the atlas', () => {
    // Regression: the atlas survived a new project, so importing an untextured
    // model after a PSD job rendered — and EXPORTED — the old artwork. Screen
    // textures were cleared without dispose(), leaking GPU memory per load.
    const screenTex = new THREE.Texture()
    const atlasTex = new THREE.Texture()
    const disposeScreen = vi.spyOn(screenTex, 'dispose')
    const disposeAtlas = vi.spyOn(atlasTex, 'dispose')
    live.objTextures.set('WALL', screenTex)
    live.atlasTexture = atlasTex
    live.atlasAspect = 2.5

    resetLive()

    expect(disposeScreen).toHaveBeenCalled()
    expect(disposeAtlas).toHaveBeenCalled()
    expect(live.atlasTexture).toBeNull()
    expect(live.atlasAspect).toBe(1)
    expect(live.objTextures.size).toBe(0)
  })
})
