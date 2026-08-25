// ---------------------------------------------------------------------------
// The original single-mesh unwrap mode (LSCM + ARAP relax, shell
// selection, packing) — separate from screen mapping.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'
import { buildHalfEdge } from '../../mesh/halfedge'
import { extractShells } from '../../mesh/shells'
import { SAMPLES } from '../../mesh/samples'
import { live, resetLive } from '../live'
import type { SerializedShell, ToWorker } from '../../workers/protocol'
import { cancelRelaxJob, ensureWorker, nextJobId } from '../relax'
import { computePacked } from '../mapping'
import { DEFAULT_DISPLAY } from '../types'

export type UnwrapSlice = Pick<
  AppState,
  | 'mesh'
  | 'he'
  | 'modelName'
  | 'shells'
  | 'shellSet'
  | 'tool'
  | 'display'
  | 'isRelaxing'
  | 'relaxProgress'
  | 'overallDistortion'
  | 'selectedShells'
  | 'loadMesh'
  | 'loadSample'
  | 'setTool'
  | 'setDisplay'
  | 'flatten'
  | 'cancelRelax'
  | 'pack'
  | 'unpack'
  | 'selectShell'
  | 'clearSelection'
>

export const createUnwrapSlice: StateCreator<AppState, [], [], UnwrapSlice> = (set, get) => ({
  mesh: null,
  he: null,
  modelName: '',
  shells: [],
  shellSet: null,
  tool: 'cut',
  display: DEFAULT_DISPLAY,
  isRelaxing: false,
  relaxProgress: 0,
  overallDistortion: 0,
  selectedShells: new Set(),
  loadMesh: (mesh) => {
    const he = buildHalfEdge(mesh)
    resetLive()
    set({
      mesh,
      he,
      modelName: mesh.name,
      shells: [],
      shellSet: null,
      hasUV: false,
      isPacked: false,
      isRelaxing: false,
      overallDistortion: 0,
      selectedShells: new Set(),
      uvVersion: get().uvVersion + 1,
      status: `${mesh.name} · ${mesh.positions.length / 3} verts · ${mesh.faces.length} faces`,
    })
  },
  loadSample: (key) => {
    const def = SAMPLES.find((s) => s.key === key)
    if (!def) return
    get().loadMesh(def.make())
  },
  setTool: (t) => set({ tool: t }),
  setDisplay: (key, value) => set({ display: { ...get().display, [key]: value } }),
  flatten: () => {
    const { he } = get()
    if (!he) return
    const shellSet = extractShells(he)
    const shells = shellSet.shells

    resetLive()
    live.topoVersion++
    const w = ensureWorker(get, set)
    const job = nextJobId()
    const serial: SerializedShell[] = shells.map((s) => ({
      id: s.id,
      positions: s.positions.slice(),
      triangles: s.triangles.slice(),
      vertCount: s.vertCount,
      triCount: s.triCount,
    }))
    const msg: ToWorker = {
      type: 'unwrap',
      jobId: job,
      shells: serial,
      iterations: 64,
      pace: 16,
    }
    w.postMessage(msg)
    set({
      shells,
      shellSet,
      isRelaxing: true,
      relaxProgress: 0,
      hasUV: false,
      isPacked: false,
      selectedShells: new Set(),
      uvVersion: get().uvVersion + 1,
      status: `Flattening ${shells.length} shell${shells.length === 1 ? '' : 's'}…`,
    })
  },
  cancelRelax: () => {
    cancelRelaxJob()
    set({ isRelaxing: false, status: 'Relax stopped' })
  },
  pack: () => {
    const { shells } = get()
    if (!shells.length || !live.uv.size) return
    live.packed = computePacked(shells, live.uv)
    live.uvEpoch++
    set({
      isPacked: true,
      uvVersion: get().uvVersion + 1,
      status: `Packed ${live.packed.size} islands into 0–1`,
    })
  },
  unpack: () => {
    live.packed = null
    live.uvEpoch++
    set({ isPacked: false, uvVersion: get().uvVersion + 1, status: 'Unpacked' })
  },
  selectShell: (id, additive) => {
    const sel = additive ? new Set(get().selectedShells) : new Set<number>()
    if (sel.has(id)) sel.delete(id)
    else sel.add(id)
    set({ selectedShells: sel })
  },
  clearSelection: () => set({ selectedShells: new Set() }),
})
