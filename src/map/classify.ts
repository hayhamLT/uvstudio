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

/** Built-in words that strongly imply a screen surface in event/venue scenes.
 *  Single source of truth — the import dialog shows these as the baseline that
 *  user keywords extend. */
export const BUILTIN_SCREEN_KEYWORDS = [
  'screen',
  'led',
  'display',
  'ribbon',
  'board',
  'jumbotron',
  'video wall',
  'monitor',
] as const

/** A panel this flat (relative to its size) is treated as a candidate screen. */
const FLAT_TOL = 0.04

/** Escape a user-typed word for safe use inside a RegExp, but let a written
 *  space match any single separator so "video wall" also hits "VideoWall". */
function keywordToPattern(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '.?')
}

/** Build the detector: the built-in words, OR'd with any user-added ones
 *  (comma-separated) — additive, so existing scenes never regress when someone
 *  adds their own naming convention. */
function screenNameRe(extraKeywords: string[] = []): RegExp {
  const words = [...BUILTIN_SCREEN_KEYWORDS, ...extraKeywords.map((k) => k.trim()).filter(Boolean)]
  return new RegExp(words.map(keywordToPattern).join('|'), 'i')
}

export function isNamedScreen(name: string, extraKeywords: string[] = []): boolean {
  return screenNameRe(extraKeywords).test(name)
}

/** Split an object name into words: on separators (_ - . space), camelCase, and
 *  letter↔digit boundaries, dropping single chars and pure numbers
 *  ("WALL_SCREEN_01" → WALL, SCREEN; "VideoWall" → Video, Wall;
 *  "Outside1" → Outside). */
export function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // letter → digit
    .replace(/(\d)([a-zA-Z])/g, '$1 $2') // digit → letter
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t))
}

/** Words that recur across ≥2 of the given object names — surfaced in the import
 *  dialog as one-click filter chips. Each token counted once per object; sorted
 *  by how many objects share it (then alphabetically), capped at `limit`. */
export function commonWords(names: string[], limit = 10): { label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>()
  for (const name of names) {
    const seen = new Set<string>()
    for (const tok of tokenize(name)) {
      const key = tok.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const cur = map.get(key)
      if (cur) cur.count++
      else map.set(key, { label: tok, count: 1 })
    }
  }
  return [...map.values()]
    .filter((t) => t.count >= 2)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/** Best-guess set of screen object names from a freshly imported scene. */
export function classifyScreens(objects: SceneObject[], extraKeywords: string[] = []): Set<string> {
  // 1. name-based — if any object is named like a screen, trust names entirely
  const named = objects.filter((o) => isNamedScreen(o.name, extraKeywords))
  if (named.length) return new Set(named.map((o) => o.name))

  // 2. flatness-based — flat panels, but only if it actually discriminates
  //    (i.e. some objects are flat and some aren't)
  const flat = objects.filter((o) => planeDeviation(o.mesh.positions, o.mesh.faces) < FLAT_TOL)
  if (flat.length && flat.length < objects.length) return new Set(flat.map((o) => o.name))

  // 3. nothing to go on — select everything (previous default)
  return new Set(objects.map((o) => o.name))
}
