// Message protocol between the main thread and the unwrap worker.

export interface SerializedShell {
  id: number
  positions: Float32Array
  triangles: Uint32Array
  vertCount: number
  triCount: number
}

export type ToWorker =
  | {
      type: 'unwrap'
      jobId: number
      shells: SerializedShell[]
      iterations: number
      pace: number // ms delay between relax rounds (0 = as fast as possible)
    }
  | { type: 'cancel' }

export type FromWorker =
  | { type: 'init'; jobId: number; shellId: number; uv: Float32Array }
  | { type: 'iter'; jobId: number; shellId: number; iter: number; uv: Float32Array }
  | { type: 'progress'; jobId: number; iter: number; total: number }
  | { type: 'done'; jobId: number }
