/** A detected (or supplied) rectangular region of the map/atlas image. */
export interface Region {
  id: number
  /** normalized image coords, origin top-left, y downward, all in [0,1] */
  x0: number
  y0: number
  x1: number
  y1: number
  /** mean color 0–255 */
  color: [number, number, number]
  /** label read from the image (OCR) or supplied by a layout file */
  label?: string
  /** fraction of the whole image this region covers */
  areaFrac: number
}

export const regionWidth = (r: Region) => r.x1 - r.x0
export const regionHeight = (r: Region) => r.y1 - r.y0
export const regionAspect = (r: Region) =>
  (r.x1 - r.x0) / Math.max(r.y1 - r.y0, 1e-6)
