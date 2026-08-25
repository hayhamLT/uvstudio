// @vitest-environment jsdom
//
// Bridge round-trip against sidecars captured from the REAL plugins.
//
// `fixtures/*-forward.json` were produced by driving the shipped Cinema 4D
// plugin (via c4dpy) and Blender add-on (via `blender --background`) headlessly
// — not hand-written. That matters: the forward payload is the one part of the
// protocol this repo does not control end-to-end, and a hand-rolled fixture
// would only ever assert what we already believe.
//
// Regenerate with the scripts in docs/BRIDGE-TESTING.md.
import { describe, expect, it, vi } from 'vitest'
import blenderForward from './fixtures/blender-forward.json'
import c4dForward from './fixtures/c4d-forward.json'

const focus: string[] = []
vi.mock('./link', () => ({
  isDesktop: () => true,
  linkSupported: () => true,
  isConnected: () => true,
  connect: async () => true,
  sendGlb: async () => {},
  saveGlb: async () => null,
  sendUVs: async (p: unknown) => {
    captured.payload = p as ReturnPayloadShape
  },
  minimizeWindow: async () => {
    focus.push('minimize')
  },
  focusWindow: async () => {
    focus.push('focus')
  },
}))
const captured: { payload?: ReturnPayloadShape } = {}

interface ReturnPayloadShape {
  v: number
  kind: string
  objects: { name: string; guid: string; polyCount: number; uv: number[][] }[]
}

const { sceneFromSidecar } = await import('./roundtrip')
type ForwardSidecar = import('./roundtrip').ForwardSidecar
const { useStore } = await import('../state/store')
const { live } = await import('../state/live')

// imported rather than read from disk: Vite resolves the path, so the test does
// not depend on the cwd or on Node types being present
const FIXTURES: Record<string, ForwardFixture> = {
  blender: blenderForward as ForwardFixture,
  c4d: c4dForward as ForwardFixture,
}

interface ForwardFixture extends ForwardSidecar {
  objects: { name: string; guid: string; points: number[]; polys: number[][] }[]
}

/** Import the sidecar, give each screen a target, auto-map, and send back. */
async function roundTrip(name: string) {
  captured.payload = undefined
  const sidecar = FIXTURES[name]
  const objects = sceneFromSidecar(sidecar)
  useStore.getState().loadScene(objects, { screenNames: objects.map((o) => o.name) })

  const regions = objects.map((o, i) => ({
    id: i,
    x0: i * 0.5,
    y0: 0,
    x1: i * 0.5 + 0.5,
    y1: 1,
    color: [128, 128, 128] as [number, number, number],
    label: o.name,
    areaFrac: 0.5,
  }))
  live.atlasAspect = 16 / 9
  useStore.setState({ regions, layeredMode: false })
  objects.forEach((o, i) => useStore.getState().assign(o.name, i))
  useStore.getState().runMapping()
  await useStore.getState().sendToC4D()
  return { sidecar, objects, payload: captured.payload! }
}

describe.each(['blender', 'c4d'])('%s round-trip', (dcc) => {
  it('returns one UV row per polygon, keyed by the DCC object guid', async () => {
    const { sidecar, payload } = await roundTrip(dcc)
    expect(payload).toBeDefined()
    expect(payload.kind).toBe('uv-return')

    for (const sent of sidecar.objects) {
      const back = payload.objects.find((o) => o.guid === sent.guid)
      expect(back, `no return object for guid ${sent.guid}`).toBeDefined()
      // the plugins apply by polygon INDEX, so the counts must line up exactly
      expect(back!.polyCount).toBe(sent.polys.length)
      expect(back!.uv.length).toBe(sent.polys.length)
      back!.uv.forEach((row, i) => {
        expect(row.length / 2, `poly ${i} corner count`).toBe(sent.polys[i].length)
        expect(row.every(Number.isFinite)).toBe(true)
      })
    }
  })

  it('gives each object its own UV space', async () => {
    // Regression for the shell-id collision: ids were objectIndex * 1000 +
    // shellIndex, so objects silently shared UV arrays and every screen came
    // back wearing the first one's unwrap.
    const { payload } = await roundTrip(dcc)
    const ranges = payload.objects.map((o) => {
      const us = o.uv.flat().filter((_, k) => k % 2 === 0)
      return [Math.min(...us), Math.max(...us)] as const
    })
    expect(ranges.length).toBeGreaterThan(1)
    const [a, b] = ranges
    expect(a[1] <= b[0] + 1e-6 || b[1] <= a[0] + 1e-6, `overlapping UV ranges: ${ranges}`).toBe(true)
  })
})

describe('the ack the plugins send back', () => {
  it('reports a clean apply', () => {
    useStore.setState({ toasts: [] })
    useStore.getState().handleUvAck({ ts: 1, applied: 2, missed: [], app: 'blender' })
    expect(useStore.getState().status).toMatch(/Blender applied UVs to 2 objects/)
    expect(useStore.getState().toasts.at(-1)?.kind).toBe('good')
  })

  it('surfaces a PARTIAL apply instead of reporting success', () => {
    useStore.setState({ toasts: [] })
    focus.length = 0
    useStore.getState().handleUvAck({ ts: 2, applied: 1, missed: ['RIBBON'], app: 'c4d' })
    expect(useStore.getState().toasts.at(-1)?.kind).toBe('warn')
    expect(useStore.getState().status).toContain('RIBBON')
    expect(focus).toContain('focus') // stays up front so the warning is seen
  })

  it('surfaces an error and does not step aside', () => {
    useStore.setState({ toasts: [] })
    focus.length = 0
    useStore.getState().handleUvAck({ ts: 3, applied: 0, missed: [], error: 'bad tag', app: 'c4d' })
    expect(useStore.getState().toasts.at(-1)?.kind).toBe('bad')
    expect(focus).toContain('focus')
    expect(focus).not.toContain('minimize')
  })
})
