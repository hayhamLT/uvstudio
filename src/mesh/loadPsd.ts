import { readPsd } from 'ag-psd'

// ---------------------------------------------------------------------------
// Parse a layered PSD into named layer images (with alpha). Each leaf layer
// becomes one screen's content; the layer name is the matching clue.
// ---------------------------------------------------------------------------

export interface PsdLayer {
  name: string
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** layer bounds within the full canvas, in pixels (top-left origin) */
  left: number
  top: number
  right: number
  bottom: number
}

export interface PsdResult {
  width: number
  height: number
  composite: HTMLCanvasElement | null
  layers: PsdLayer[]
}

/** Composite a PSD's layers onto a single canvas — fallback for files that have
 *  no baked composite (ag-psd's `psd.canvas` is null). Honours layer position. */
export function flattenPsdLayers(psd: PsdResult): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, psd.width)
  canvas.height = Math.max(1, psd.height)
  const ctx = canvas.getContext('2d')!
  // draw bottom-to-top in the order ag-psd reported them
  for (const l of psd.layers) ctx.drawImage(l.canvas, l.left, l.top)
  return canvas
}

export async function loadPsdFile(file: File): Promise<PsdResult> {
  const buf = await file.arrayBuffer()
  // ag-psd renders each layer to its own <canvas> (with alpha) in the browser.
  const psd = readPsd(buf, { skipThumbnail: true })
  const layers: PsdLayer[] = []
  const walk = (nodes: typeof psd.children) => {
    for (const n of nodes ?? []) {
      if (n.children) walk(n.children)
      else if (n.canvas && n.canvas.width > 0 && n.canvas.height > 0) {
        const left = n.left ?? 0
        const top = n.top ?? 0
        layers.push({
          name: (n.name ?? '').trim() || `layer_${layers.length + 1}`,
          canvas: n.canvas,
          width: n.canvas.width,
          height: n.canvas.height,
          left,
          top,
          right: n.right ?? left + n.canvas.width,
          bottom: n.bottom ?? top + n.canvas.height,
        })
      }
    }
  }
  walk(psd.children)
  return {
    width: psd.width,
    height: psd.height,
    composite: psd.canvas ?? null,
    layers,
  }
}
