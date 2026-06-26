/// <reference lib="webworker" />
import { buildParamContext, lscm, arapIterate, type ParamContext } from '../unwrap/param'
import type { Shell } from '../mesh/types'
import type { FromWorker, ToWorker } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

let activeJob = -1

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve()

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer)
}

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    activeJob = -1
    return
  }
  if (msg.type !== 'unwrap') return

  const jobId = msg.jobId
  activeJob = jobId
  const { shells, iterations, pace } = msg

  // 1. Build contexts + LSCM init for every shell.
  const contexts: { ctx: ParamContext; uv: Float64Array; shellId: number }[] = []
  for (const s of shells) {
    if (activeJob !== jobId) return
    const shell: Shell = {
      id: s.id,
      positions: s.positions,
      triangles: s.triangles,
      polygons: [],
      toOrigVertex: new Int32Array(0),
      vertCount: s.vertCount,
      triCount: s.triCount,
      faceIds: [],
    }
    const pctx = buildParamContext(shell)
    const uv = lscm(pctx)
    contexts.push({ ctx: pctx, uv, shellId: s.id })
    const out = Float32Array.from(uv)
    post({ type: 'init', jobId, shellId: s.id, uv: out }, [out.buffer])
  }

  // 2. Round-robin ARAP relaxation, paced for a visible "peel" animation.
  for (let iter = 0; iter < iterations; iter++) {
    if (activeJob !== jobId) return
    for (const c of contexts) {
      arapIterate(c.ctx, c.uv)
      const out = Float32Array.from(c.uv)
      post({ type: 'iter', jobId, shellId: c.shellId, iter, uv: out }, [out.buffer])
    }
    post({ type: 'progress', jobId, iter: iter + 1, total: iterations })
    await sleep(pace)
  }

  if (activeJob === jobId) post({ type: 'done', jobId })
}
