import * as THREE from 'three'
import type { HEMesh, PolyMesh } from '../mesh/types'

/** Build an indexed, triangulated surface geometry + a triangle→face map. */
export function buildSurfaceGeometry(mesh: PolyMesh): {
  geometry: THREE.BufferGeometry
  faceOfTri: Int32Array
} {
  const indices: number[] = []
  const faceOfTri: number[] = []
  for (let f = 0; f < mesh.faces.length; f++) {
    const verts = mesh.faces[f]
    for (let i = 1; i + 1 < verts.length; i++) {
      indices.push(verts[0], verts[i], verts[i + 1])
      faceOfTri.push(f)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return { geometry, faceOfTri: Int32Array.from(faceOfTri) }
}

const pairKey = (a: number, b: number, V: number) =>
  a < b ? a * V + b : b * V + a

/** Map an undirected vertex pair to its edge id. */
export function buildEdgeMap(he: HEMesh): Map<number, number> {
  const V = he.vertexCount
  const map = new Map<number, number>()
  for (let e = 0; e < he.edgeCount; e++) {
    map.set(pairKey(he.edgeA[e], he.edgeB[e], V), e)
  }
  return map
}

/** Closest polygon edge of `face` to a 3D point. */
export function closestEdgeOnFace(
  he: HEMesh,
  edgeMap: Map<number, number>,
  face: number,
  point: THREE.Vector3,
  allow?: Set<number>, // when given, only consider edges in this set (feature edges)
): number {
  const verts = he.mesh.faces[face]
  const pos = he.mesh.positions
  const V = he.vertexCount
  let best = -1
  let bestD = Infinity
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ap = new THREE.Vector3()
  for (let i = 0; i < verts.length; i++) {
    const v0 = verts[i]
    const v1 = verts[(i + 1) % verts.length]
    const edge = edgeMap.get(pairKey(v0, v1, V)) ?? -1
    if (allow && !allow.has(edge)) continue // skip diagonals when filtering
    a.set(pos[v0 * 3], pos[v0 * 3 + 1], pos[v0 * 3 + 2])
    b.set(pos[v1 * 3], pos[v1 * 3 + 1], pos[v1 * 3 + 2])
    ab.subVectors(b, a)
    ap.subVectors(point, a)
    const t = Math.max(0, Math.min(1, ap.dot(ab) / (ab.lengthSq() || 1e-9)))
    ab.multiplyScalar(t).add(a) // closest point on segment
    const d = ab.distanceToSquared(point)
    if (d < bestD) {
      bestD = d
      best = edge
    }
  }
  return best
}


export function faceNormal(pos: Float32Array, verts: number[]): [number, number, number] {
  // Newell's method — robust for triangles and n-gons
  let nx = 0,
    ny = 0,
    nz = 0
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]
    const b = verts[(i + 1) % verts.length]
    const ax = pos[a * 3],
      ay = pos[a * 3 + 1],
      az = pos[a * 3 + 2]
    const bx = pos[b * 3],
      by = pos[b * 3 + 1],
      bz = pos[b * 3 + 2]
    nx += (ay - by) * (az + bz)
    ny += (az - bz) * (ax + bx)
    nz += (ax - bx) * (ay + by)
  }
  const l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

/**
 * Structural edges only: every boundary edge, plus any edge whose two faces
 * aren't (nearly) coplanar. On a triangulated mesh this drops the triangulation
 * diagonals (their two triangles are coplanar) while keeping real geometry edges
 * — even gentle ones like a cylinder's segment edges — so the user sees a clean
 * edge cage, not triangles. `degThreshold` is the dihedral angle below which an
 * edge counts as flat (a diagonal).
 */
export function featureEdgeSet(he: HEMesh, degThreshold = 1): Set<number> {
  const pos = he.mesh.positions
  const normals = he.mesh.faces.map((f) => faceNormal(pos, f))
  const cosThresh = Math.cos((degThreshold * Math.PI) / 180)
  const set = new Set<number>()
  for (let e = 0; e < he.edgeCount; e++) {
    const hh = he.edgeHe[e]
    const tw = he.heTwin[hh]
    if (tw < 0) {
      set.add(e) // boundary edge
      continue
    }
    const n0 = normals[he.heFace[hh]]
    const n1 = normals[he.heFace[tw]]
    const d = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]
    if (d < cosThresh) set.add(e) // non-coplanar → real edge
  }
  return set
}

/** Wireframe positions for just the given edges. */
export function edgeSetSegments(he: HEMesh, edges: Set<number>): Float32Array {
  const pos = he.mesh.positions
  const out = new Float32Array(edges.size * 6)
  let i = 0
  for (const e of edges) {
    const a = he.edgeA[e]
    const b = he.edgeB[e]
    out[i++] = pos[a * 3]
    out[i++] = pos[a * 3 + 1]
    out[i++] = pos[a * 3 + 2]
    out[i++] = pos[b * 3]
    out[i++] = pos[b * 3 + 1]
    out[i++] = pos[b * 3 + 2]
  }
  return out
}

/** Positions for all polygon edges (wireframe). */
export function allEdgeSegments(he: HEMesh): Float32Array {
  const pos = he.mesh.positions
  const out = new Float32Array(he.edgeCount * 6)
  for (let e = 0; e < he.edgeCount; e++) {
    const a = he.edgeA[e]
    const b = he.edgeB[e]
    out[e * 6] = pos[a * 3]
    out[e * 6 + 1] = pos[a * 3 + 1]
    out[e * 6 + 2] = pos[a * 3 + 2]
    out[e * 6 + 3] = pos[b * 3]
    out[e * 6 + 4] = pos[b * 3 + 1]
    out[e * 6 + 5] = pos[b * 3 + 2]
  }
  return out
}
