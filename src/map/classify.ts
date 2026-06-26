import type { SceneObject } from '../mesh/types'
import { planeDeviation } from './fit'

// ---------------------------------------------------------------------------
// Auto-classify which imported objects are SCREENS (mappable) vs reference
// geometry (structure, props). Tailored for venue/stadium scenes where most
// objects are NOT screens, so the import dialog shouldn't default to "all".
//
// Signal priority:
//   1. Name — the strongest, most reliable hint (SCREEN/LED/BOARD/RIBBON/…).
//   2. Flatness — failing names, flat thin panels are likely LED screens.
//   3. Fallback — if nothing is distinguishable, select all (old behaviour),
//      so the user is never left with an empty selection.
// ---------------------------------------------------------------------------

/** Names that strongly imply a screen surface in event/venue scenes. */
const SCREEN_NAME_RE = /screen|led|display|ribbon|board|jumbotron|video.?wall|monitor/i

/** A panel this flat (relative to its size) is treated as a candidate screen. */
const FLAT_TOL = 0.04

export function isNamedScreen(name: string): boolean {
  return SCREEN_NAME_RE.test(name)
}

/** Best-guess set of screen object names from a freshly imported scene. */
export function classifyScreens(objects: SceneObject[]): Set<string> {
  // 1. name-based — if any object is named like a screen, trust names entirely
  const named = objects.filter((o) => isNamedScreen(o.name))
  if (named.length) return new Set(named.map((o) => o.name))

  // 2. flatness-based — flat panels, but only if it actually discriminates
  //    (i.e. some objects are flat and some aren't)
  const flat = objects.filter((o) => planeDeviation(o.mesh.positions, o.mesh.faces) < FLAT_TOL)
  if (flat.length && flat.length < objects.length) return new Set(flat.map((o) => o.name))

  // 3. nothing to go on — select everything (previous default)
  return new Set(objects.map((o) => o.name))
}
