// ---------------------------------------------------------------------------
// The unwrap (relax) worker.
//
// LSCM + ARAP run off the main thread and stream UV frames back; the store owns
// the lifecycle here so the worker is created once and reused across jobs.
// ---------------------------------------------------------------------------
import { computeDistortion } from '../unwrap/distortion'
import type { FromWorker, ToWorker } from '../workers/protocol'
import type { Shell } from '../mesh/types'
import { live } from './live'

/** The relax-relevant slice of app state (structural — no store import). */
export interface RelaxSource {
  shells: Shell[]
  uvVersion: number
}
export interface RelaxPatch {
  isRelaxing: boolean
  relaxProgress: number
  hasUV: boolean
  overallDistortion: number
  uvVersion: number
  status: string
}

// --- unwrap worker singleton ---
let worker: Worker | null = null
let jobCounter = 0

/** Monotonic job id, so a late frame from a cancelled run is ignored. */
export function nextJobId(): number {
  return ++jobCounter
}

/** Tell a running relax to stop (no-op if the worker was never started). */
export function cancelRelaxJob() {
  worker?.postMessage({ type: 'cancel' } satisfies ToWorker)
}

export function ensureWorker(get: () => RelaxSource, set: (p: Partial<RelaxPatch>) => void): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/unwrap.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data
    if (msg.type === 'init' || msg.type === 'iter') {
      live.uv.set(msg.shellId, msg.uv)
      live.uvEpoch++
    } else if (msg.type === 'progress') {
      set({ relaxProgress: msg.iter / msg.total })
    } else if (msg.type === 'done') {
      finishRelax(get, set)
    }
  }
  return worker
}

export function finishRelax(get: () => RelaxSource, set: (p: Partial<RelaxPatch>) => void) {
  const { shells } = get()
  live.distortion.clear()
  let sum = 0
  let wsum = 0
  for (const shell of shells) {
    const uv = live.uv.get(shell.id)
    if (!uv) continue
    const d = computeDistortion(shell.positions, uv, shell.triangles)
    live.distortion.set(shell.id, d)
    sum += d.overall * shell.triCount
    wsum += shell.triCount
  }
  live.uvEpoch++
  set({
    isRelaxing: false,
    relaxProgress: 1,
    hasUV: true,
    overallDistortion: wsum ? sum / wsum : 0,
    uvVersion: get().uvVersion + 1,
    status: `Relaxed ${shells.length} shell${shells.length === 1 ? '' : 's'} · ${(
      (wsum ? sum / wsum : 0) * 100
    ).toFixed(1)}% avg distortion`,
  })
}
