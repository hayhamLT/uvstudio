import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useStore } from '../state/store'

// Shared "last input" timestamp across both canvases.
let lastActivity = 0

/**
 * Render-on-demand driver. Pair with `<Canvas frameloop="demand">`.
 *
 * A standalone webview (WKWebView / WebView2) is much slower at WebGL than
 * Chrome, and rendering TWO canvases at 60fps nonstop crawls. This keeps a
 * canvas rendering only for a short window after any input or store change, then
 * lets it idle — so a still scene costs ~0 GPU instead of 60fps forever.
 */
export default function ActiveFrameloop({ ms = 700 }: { ms?: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const wake = () => {
      lastActivity = performance.now()
      invalidate() // schedule a render now; useFrame keeps it alive for `ms`
    }
    wake() // initial paint
    const evs = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown']
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }))
    const unsub = useStore.subscribe(wake) // any state change → render
    const onResize = () => wake()
    window.addEventListener('resize', onResize)
    return () => {
      evs.forEach((e) => window.removeEventListener(e, wake))
      window.removeEventListener('resize', onResize)
      unsub()
    }
  }, [invalidate])

  // while recent activity, keep requesting frames; otherwise idle
  useFrame((state) => {
    if (performance.now() - lastActivity < ms) state.invalidate()
  })
  return null
}
