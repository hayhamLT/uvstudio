// ---------------------------------------------------------------------------
// Undo / redo.
//
// A snapshot is the editable "document": the UVs, plus the mapping metadata,
// plus shell GEOMETRY — a cylindrical/spherical projection seam-splits a shell,
// so restoring UVs without the topology they belong to desyncs the mesh.
// ---------------------------------------------------------------------------
import type { Shell } from '../mesh/types'
import type { Projection } from '../map/fit'
import { live } from './live'
import type { MapShell } from './types'

/** What restoreDoc writes back onto the store. */
export type RestorePatch = HistorySource & { uvVersion: number }

/** The document fields a snapshot captures, named structurally so history
 *  never has to import the store. */
export interface HistorySource {
  mapShells: MapShell[]
  assignment: Record<string, number>
  mapOrient: Record<string, { rot: number; flipX: boolean; flipY: boolean }>
  mapObjFit: Record<string, 'fill' | 'aspect'>
  mapProjection: Record<string, Projection>
  mappedObjects: string[]
  mapFitInfo: Record<string, { stretch: number }>
  importedObjects: string[]
}

// --- undo / redo: snapshot the editable "document" (uv + mapping metadata) ---
// shell geometry can change topology (seam-split on cylindrical/spherical), so
// undo must restore it too — otherwise UVs and the mesh desync after an undo.
export type GeomSnap = Pick<
  Shell,
  'positions' | 'triangles' | 'toOrigVertex' | 'vertCount' | 'triCount' | 'polygons' | 'faceIds'
>

export interface DocSnapshot {
  uv: Map<number, Float32Array>
  shells: Map<number, GeomSnap>
  assignment: Record<string, number>
  mapOrient: Record<string, { rot: number; flipX: boolean; flipY: boolean }>
  mapObjFit: Record<string, 'fill' | 'aspect'>
  mapProjection: Record<string, Projection>
  mappedObjects: string[]
  mapFitInfo: Record<string, { stretch: number }>
  importedObjects: string[]
  /** retained size of this snapshot's UV copies, for the byte budget below */
  bytes: number
}

export const undoStack: DocSnapshot[] = []

export const redoStack: DocSnapshot[] = []

const UNDO_LIMIT = 60

/**
 * Undo is ALSO capped by size, not just by step count. Every snapshot deep-
 * copies each shell's UV array (geometry is captured by reference, UVs cannot
 * be — they are mutated in place by dragging), so 60 steps on a show with a
 * few hundred thousand mapped vertices retains hundreds of MB of typed arrays
 * that nothing will ever free. Whichever limit bites first wins; we always
 * keep at least one step so undo is never a no-op.
 */
const UNDO_BYTE_BUDGET = 96 * 1024 * 1024

/** Drop the oldest entries until the stack is inside both limits. */
export function trimHistory(stack: DocSnapshot[]) {
  while (stack.length > UNDO_LIMIT) stack.shift()
  let total = 0
  for (const s of stack) total += s.bytes
  while (stack.length > 1 && total > UNDO_BYTE_BUDGET) total -= stack.shift()!.bytes
}

export function snapshotDoc(g: HistorySource): DocSnapshot {
  const uv = new Map<number, Float32Array>()
  let bytes = 0
  for (const [k, a] of live.uv) {
    uv.set(k, a.slice())
    bytes += a.byteLength
  }
  // shell arrays are only ever reassigned wholesale (never mutated in place), so
  // capturing references here is safe and cheap — undo restores those references.
  const shells = new Map<number, GeomSnap>()
  for (const m of g.mapShells) {
    const s = m.shell
    shells.set(m.id, {
      positions: s.positions,
      triangles: s.triangles,
      toOrigVertex: s.toOrigVertex,
      vertCount: s.vertCount,
      triCount: s.triCount,
      polygons: s.polygons,
      faceIds: s.faceIds,
    })
  }
  return {
    uv,
    shells,
    assignment: { ...g.assignment },
    mapOrient: structuredClone(g.mapOrient),
    mapObjFit: { ...g.mapObjFit },
    mapProjection: { ...g.mapProjection },
    mappedObjects: [...g.mappedObjects],
    mapFitInfo: structuredClone(g.mapFitInfo),
    importedObjects: [...g.importedObjects],
    bytes,
  }
}

export function restoreDoc(
  snap: DocSnapshot,
  set: (p: Partial<RestorePatch>) => void,
  g: HistorySource & { uvVersion: number },
) {
  live.uv.clear()
  for (const [k, a] of snap.uv) live.uv.set(k, a.slice())
  // restore shell geometry; if any topology changed, hand mapShells a fresh array
  // ref so the 3D/2D geometry rebuilds at the restored vertex count.
  let topoChanged = false
  for (const m of g.mapShells) {
    const geom = snap.shells.get(m.id)
    if (!geom) continue
    if (m.shell.vertCount !== geom.vertCount) topoChanged = true
    m.shell.positions = geom.positions
    m.shell.triangles = geom.triangles
    m.shell.toOrigVertex = geom.toOrigVertex
    m.shell.vertCount = geom.vertCount
    m.shell.triCount = geom.triCount
    m.shell.polygons = geom.polygons
    m.shell.faceIds = geom.faceIds
  }
  live.uvEpoch++
  set({
    assignment: { ...snap.assignment },
    mapOrient: structuredClone(snap.mapOrient),
    mapObjFit: { ...snap.mapObjFit },
    mapProjection: { ...snap.mapProjection },
    mappedObjects: [...snap.mappedObjects],
    mapFitInfo: structuredClone(snap.mapFitInfo),
    importedObjects: [...snap.importedObjects],
    ...(topoChanged ? { mapShells: [...g.mapShells] } : {}),
    uvVersion: g.uvVersion + 1,
  })
}
