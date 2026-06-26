import type { HEMesh, PolyMesh } from './types'

/**
 * Build half-edge connectivity from a polygon mesh.
 *
 * Half-edges are emitted face by face. Twins are matched by looking up the
 * reverse directed edge (w -> u). Non-manifold edges (more than two faces on an
 * edge) keep only the first matched twin pair; extras stay boundary-like, which
 * is fine for our parameterization purposes.
 */
export function buildHalfEdge(mesh: PolyMesh): HEMesh {
  const { faces } = mesh
  const vertexCount = mesh.positions.length / 3
  const faceCount = faces.length

  let heCount = 0
  for (const f of faces) heCount += f.length

  const heV = new Int32Array(heCount)
  const heFace = new Int32Array(heCount)
  const heNext = new Int32Array(heCount)
  const hePrev = new Int32Array(heCount)
  const heTwin = new Int32Array(heCount).fill(-1)
  const heEdge = new Int32Array(heCount).fill(-1)
  const faceHe = new Int32Array(faceCount)
  const faceDegree = new Int32Array(faceCount)

  // Map "u,w" directed edge -> half-edge index, for twin matching.
  const dirMap = new Map<number, number>()
  const key = (a: number, b: number) => a * vertexCount + b

  let h = 0
  for (let f = 0; f < faceCount; f++) {
    const verts = faces[f]
    const n = verts.length
    faceHe[f] = h
    faceDegree[f] = n
    const base = h
    for (let i = 0; i < n; i++) {
      const cur = base + i
      const u = verts[i]
      const w = verts[(i + 1) % n]
      heV[cur] = u
      heFace[cur] = f
      heNext[cur] = base + ((i + 1) % n)
      hePrev[cur] = base + ((i + n - 1) % n)
      dirMap.set(key(u, w), cur)
    }
    h += n
  }

  // Match twins + assign undirected edge ids.
  const edgeA: number[] = []
  const edgeB: number[] = []
  const edgeHe: number[] = []
  for (let he = 0; he < heCount; he++) {
    if (heEdge[he] !== -1) continue
    const u = heV[he]
    const w = heV[heNext[he]]
    const eid = edgeA.length
    edgeA.push(Math.min(u, w))
    edgeB.push(Math.max(u, w))
    edgeHe.push(he)
    heEdge[he] = eid
    const twin = dirMap.get(key(w, u))
    if (twin !== undefined && twin !== he) {
      heTwin[he] = twin
      heTwin[twin] = he
      heEdge[twin] = eid
    }
  }

  return {
    mesh,
    vertexCount,
    faceCount,
    halfEdgeCount: heCount,
    heV,
    heFace,
    heNext,
    hePrev,
    heTwin,
    heEdge,
    faceHe,
    faceDegree,
    edgeA: Int32Array.from(edgeA),
    edgeB: Int32Array.from(edgeB),
    edgeHe: Int32Array.from(edgeHe),
    edgeCount: edgeA.length,
  }
}

/** The destination vertex of a half-edge. */
export function heDest(he: HEMesh, h: number): number {
  return he.heV[he.heNext[h]]
}

/** Is this edge on the mesh boundary (only one adjacent face)? */
export function isBoundaryEdge(he: HEMesh, edge: number): boolean {
  return he.heTwin[he.edgeHe[edge]] === -1
}

/**
 * Walk a quad edge loop from a seed edge, returning the set of edge ids in the
 * loop. On non-quad topology this degrades gracefully to just the seed edge.
 *
 * The loop continues by crossing the twin into the adjacent face and taking the
 * opposite side of that quad (next.next). We walk forward from the seed and
 * from its twin to capture both directions of an open loop.
 */
export function edgeLoop(he: HEMesh, seedEdge: number): number[] {
  const result = new Set<number>([seedEdge])

  const stepFrom = (h: number) => {
    const t = he.heTwin[h]
    if (t === -1) return -1
    const f = he.heFace[t]
    if (he.faceDegree[f] !== 4) return -1
    return he.heNext[he.heNext[t]] // opposite half-edge in the quad
  }

  for (const start of [he.edgeHe[seedEdge], he.heTwin[he.edgeHe[seedEdge]]]) {
    if (start === -1) continue
    let cur = stepFrom(start)
    let guard = 0
    while (cur !== -1 && guard++ < he.edgeCount + 4) {
      const e = he.heEdge[cur]
      if (result.has(e)) break
      result.add(e)
      cur = stepFrom(cur)
    }
  }
  return [...result]
}

/**
 * Walk a quad edge ring (the band of edges perpendicular to a loop) — useful
 * for "ring" style selections. Continues across the quad via next (not
 * next.next) so it follows the strip of faces.
 */
export function edgeRing(he: HEMesh, seedEdge: number): number[] {
  const result = new Set<number>([seedEdge])
  const stepFrom = (h: number) => {
    const f = he.heFace[h]
    if (he.faceDegree[f] !== 4) return -1
    const opp = he.heNext[he.heNext[h]]
    return he.heTwin[opp]
  }
  for (const start of [he.edgeHe[seedEdge], he.heTwin[he.edgeHe[seedEdge]]]) {
    if (start === -1) continue
    let cur = stepFrom(start)
    let guard = 0
    while (cur !== -1 && guard++ < he.edgeCount + 4) {
      const e = he.heEdge[cur]
      if (result.has(e)) break
      result.add(e)
      cur = stepFrom(cur)
    }
  }
  return [...result]
}

/** Minimal union-find over integers. */
export class UnionFind {
  parent: Int32Array
  rank: Uint8Array
  constructor(n: number) {
    this.parent = new Int32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
    this.rank = new Uint8Array(n)
  }
  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root]
    while (this.parent[x] !== root) {
      const next = this.parent[x]
      this.parent[x] = root
      x = next
    }
    return root
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra
    else {
      this.parent[rb] = ra
      this.rank[ra]++
    }
  }
}
