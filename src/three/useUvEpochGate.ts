import { useRef } from 'react'
import { live } from '../state/live'

/**
 * Gate for the per-frame "stream `live.uv` into GPU buffers" loops.
 *
 * Those loops rewrite EVERY shell's vertex buffer on every frame. That was
 * fine when the canvases only rendered during a relax, but `ActiveFrameloop`
 * wakes both of them for ~700ms after any `pointermove` anywhere in the window
 * — so simply moving the cursor over a side-panel button drove a full
 * CPU-side rewrite of every buffer in both viewports at 60fps.
 *
 * `live.uvEpoch` is bumped by every writer that touches `live.uv`, so a
 * consumer that has already uploaded the current epoch has nothing to do.
 * `deps` covers the inputs OTHER than the UVs themselves (the geometry
 * objects, the display aspect, a source rect…): when any of them changes the
 * gate re-opens once, because a freshly built BufferGeometry starts empty.
 *
 * Returns a function to call at the top of `useFrame`; `false` means skip.
 */
export function useUvEpochGate(deps: readonly unknown[]): () => boolean {
  const lastEpoch = useRef(-1)
  const lastDeps = useRef<readonly unknown[]>([])
  return () => {
    const d = deps
    const p = lastDeps.current
    if (d.length !== p.length || d.some((v, i) => !Object.is(v, p[i]))) {
      lastDeps.current = d
      lastEpoch.current = -1
    }
    if (lastEpoch.current === live.uvEpoch) return false
    lastEpoch.current = live.uvEpoch
    return true
  }
}
