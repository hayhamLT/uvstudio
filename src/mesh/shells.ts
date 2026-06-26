import { UnionFind } from './halfedge'
import type { HEMesh, Shell } from './types'

export interface ShellSet {
  shells: Shell[]
  /** shell id for each half-edge's owning face (-1 if unassigned) */
  cornerShell: Int32Array
  /** local vertex index (within its shell) for each half-edge corner */
  cornerLocal: Int32Array
}

/**
 * Split a mesh into UV shells given a set of seam edge ids.
 *
 * A "cut" is any seam edge or boundary edge. Faces connected through non-cut
 * interior edges form one shell. Vertices are duplicated wherever a seam passes
 * through them (so the shell can be flattened like peeled skin).
 */
export function extractShells(he: HEMesh, seams: Set<number> = new Set()): ShellSet {
  const heCount = he.halfEdgeCount
  const isCut = (edge: number) =>
    seams.has(edge) || he.heTwin[he.edgeHe[edge]] === -1

  // 1. Union corners (half-edges) that share a UV vertex: same original
  //    vertex, not separated by a cut edge.
  const cornerUF = new UnionFind(heCount)
  for (let h = 0; h < heCount; h++) {
    const t = he.heTwin[h]
    if (t === -1) continue
    if (isCut(he.heEdge[h])) continue
    // h has origin v; the matching corner at v in the twin's face is next(t).
    cornerUF.union(h, he.heNext[t])
  }

  // 2. Union faces connected across non-cut interior edges -> shells.
  const faceUF = new UnionFind(he.faceCount)
  for (let h = 0; h < heCount; h++) {
    const t = he.heTwin[h]
    if (t === -1) continue
    if (isCut(he.heEdge[h])) continue
    faceUF.union(he.heFace[h], he.heFace[t])
  }

  // Group faces by shell root.
  const shellOfFaceRoot = new Map<number, number>()
  const faceShell = new Int32Array(he.faceCount)
  let shellCount = 0
  for (let f = 0; f < he.faceCount; f++) {
    const r = faceUF.find(f)
    let s = shellOfFaceRoot.get(r)
    if (s === undefined) {
      s = shellCount++
      shellOfFaceRoot.set(r, s)
    }
    faceShell[f] = s
  }

  // 3. Per-shell local vertex indexing from corner roots.
  const cornerShell = new Int32Array(heCount).fill(-1)
  const cornerLocal = new Int32Array(heCount).fill(-1)
  const localOfRoot: Array<Map<number, number>> = Array.from(
    { length: shellCount },
    () => new Map<number, number>(),
  )
  const shellVerts: number[][] = Array.from({ length: shellCount }, () => [])
  const shellFaceIds: number[][] = Array.from({ length: shellCount }, () => [])
  const shellTris: number[][] = Array.from({ length: shellCount }, () => [])
  const shellPolys: number[][][] = Array.from({ length: shellCount }, () => [])

  for (let f = 0; f < he.faceCount; f++) {
    const s = faceShell[f]
    shellFaceIds[s].push(f)
    // Gather face corners (half-edges) in loop order.
    const corners: number[] = []
    let h = he.faceHe[f]
    do {
      corners.push(h)
      h = he.heNext[h]
    } while (h !== he.faceHe[f])

    const local: number[] = []
    for (const c of corners) {
      const root = cornerUF.find(c)
      let li = localOfRoot[s].get(root)
      if (li === undefined) {
        li = shellVerts[s].length
        localOfRoot[s].set(root, li)
        shellVerts[s].push(he.heV[c]) // original vertex for this UV vertex
      }
      cornerShell[c] = s
      cornerLocal[c] = li
      local.push(li)
    }
    // Keep the polygon loop (for edge/face editing) and fan-triangulate it.
    shellPolys[s].push(local.slice())
    for (let i = 1; i + 1 < local.length; i++) {
      shellTris[s].push(local[0], local[i], local[i + 1])
    }
  }

  // 4. Materialize Shell objects.
  const pos = he.mesh.positions
  const shells: Shell[] = []
  for (let s = 0; s < shellCount; s++) {
    const verts = shellVerts[s]
    const vc = verts.length
    const positions = new Float32Array(vc * 3)
    const toOrig = new Int32Array(vc)
    for (let i = 0; i < vc; i++) {
      const ov = verts[i]
      toOrig[i] = ov
      positions[i * 3] = pos[ov * 3]
      positions[i * 3 + 1] = pos[ov * 3 + 1]
      positions[i * 3 + 2] = pos[ov * 3 + 2]
    }
    shells.push({
      id: s,
      positions,
      triangles: Uint32Array.from(shellTris[s]),
      polygons: shellPolys[s],
      toOrigVertex: toOrig,
      vertCount: vc,
      triCount: shellTris[s].length / 3,
      faceIds: shellFaceIds[s],
    })
  }

  return { shells, cornerShell, cornerLocal }
}
