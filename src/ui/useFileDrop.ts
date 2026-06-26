import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Global file drag-and-drop, routed by cursor position.
 *
 * We do NOT put listeners on each drop element, because those elements wrap an
 * R3F / WebGL `<canvas>` and in some browsers the `drop` event does not reach a
 * container listener reliably through the canvas. Instead a SINGLE set of
 * `window` listeners handles every drag: `window` always receives drag events
 * regardless of canvas nesting, and we hit-test the cursor against the
 * registered drop zones to decide who gets the files. Handling at the window
 * also stops the browser from hijacking a stray drop (navigating away to open
 * the dropped image), which otherwise looks like "nothing happened".
 *
 * NOTE: native OS file drops only reach the page in a real browser. Inside an
 * embedded host (e.g. the Claude desktop app's preview pane) the host captures
 * file drops at the native window level before the page sees them — there, use
 * the click-to-pick "Add image" controls instead.
 */

type Zone = {
  el: HTMLElement
  onFiles: (files: FileList) => void
  setDragging: (d: boolean) => void
}

const zones: Zone[] = []
let wired = false
let activeZone: Zone | null = null

/** True when a drag is carrying files (robust across the array / DOMStringList
 *  shapes that `DataTransfer.types` can take). */
function dtHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const t = dt.types
  if (!t) return false
  for (let i = 0; i < t.length; i++) if (t[i] === 'Files') return true
  return false
}

/** The most specific (smallest-area) registered zone under the cursor. Uses
 *  elementFromPoint so z-order / visibility is respected (drag overlays are
 *  pointer-events-none, so they're transparent to the hit-test). Falls back to
 *  a bounding-rect test if elementFromPoint yields nothing. */
function zoneAt(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y)
  let best: Zone | null = null
  let bestArea = Infinity
  if (el) {
    for (const z of zones) {
      if (!z.el.contains(el)) continue
      const r = z.el.getBoundingClientRect()
      const a = r.width * r.height
      if (a < bestArea) {
        best = z
        bestArea = a
      }
    }
  }
  if (best) return best
  for (const z of zones) {
    const r = z.el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const a = r.width * r.height
      if (a < bestArea) {
        best = z
        bestArea = a
      }
    }
  }
  return best
}

function setActive(z: Zone | null) {
  if (activeZone === z) return
  if (activeZone) activeZone.setDragging(false)
  activeZone = z
  if (activeZone) activeZone.setDragging(true)
}

function onWinDragEnter(e: DragEvent) {
  e.preventDefault()
}

function onWinDragOver(e: DragEvent) {
  // ALWAYS preventDefault — without it on the final dragover the browser cancels
  // the drop. We do NOT gate this on detecting files, because some browsers
  // (Safari, certain security contexts) don't expose 'Files' in types during
  // dragover, only at drop. Gating here is what makes "overlay shows but drop
  // never fires".
  e.preventDefault()
  const hasFiles = dtHasFiles(e.dataTransfer)
  if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles ? 'copy' : 'none'
  setActive(hasFiles ? zoneAt(e.clientX, e.clientY) : null)
}

function onWinDrop(e: DragEvent) {
  e.preventDefault() // stop the browser from opening the file
  const files = e.dataTransfer?.files
  const z = zoneAt(e.clientX, e.clientY)
  setActive(null)
  if (z && files && files.length) z.onFiles(files)
}

function onWinDragLeave(e: DragEvent) {
  // Only fires meaningfully when the cursor leaves the window (no relatedTarget).
  if (!e.relatedTarget) setActive(null)
}

function onWinDragEnd() {
  setActive(null)
}

function wire() {
  if (wired) return
  wired = true
  window.addEventListener('dragenter', onWinDragEnter)
  window.addEventListener('dragover', onWinDragOver)
  window.addEventListener('drop', onWinDrop)
  window.addEventListener('dragleave', onWinDragLeave)
  window.addEventListener('dragend', onWinDragEnd)
}

/**
 * Register an element as a file drop zone. Returns a `dragging` flag (for a
 * drop-target highlight) and a `ref` to attach to the container element.
 */
export function useFileDrop(onFiles: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false)
  const [node, setNode] = useState<HTMLElement | null>(null)
  const ref = useCallback((n: HTMLElement | null) => setNode(n), [])

  // Keep the latest callback without re-registering the zone every render.
  const onFilesRef = useRef(onFiles)
  onFilesRef.current = onFiles

  useEffect(() => {
    if (!node) return
    wire()
    const zone: Zone = {
      el: node,
      onFiles: (f) => onFilesRef.current(f),
      setDragging,
    }
    zones.push(zone)
    return () => {
      const i = zones.indexOf(zone)
      if (i >= 0) zones.splice(i, 1)
      if (activeZone === zone) activeZone = null
    }
  }, [node])

  return { dragging, ref }
}
