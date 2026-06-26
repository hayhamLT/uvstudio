// ---------------------------------------------------------------------------
// Core mesh data types for UV Studio.
//
// A PolyMesh keeps faces as polygons (quads/n-gons), because UVLayout's
// signature edge-loop seam cutting only makes sense on quad topology. We only
// triangulate when we hand a shell to the parameterizer or the GPU.
// ---------------------------------------------------------------------------

/** A polygon mesh: flat vertex positions + variable-length polygon faces. */
export interface PolyMesh {
  name: string
  /** xyz per vertex, length = 3 * vertexCount */
  positions: Float32Array
  /** each face is a list of vertex indices, wound CCW */
  faces: number[][]
}

/** One named object within a multi-object scene (e.g. a single LED screen). */
export interface SceneObject {
  name: string
  mesh: PolyMesh
  /** imported per-vertex UVs (aligned to mesh.positions), if the source had them */
  uvs?: Float32Array
  /** imported base-colour texture image, if the source had one */
  textureImage?: CanvasImageSource
  /** imported texture aspect (w / h) */
  textureAspect?: number
  /**
   * Stable id of the source DCC object, set when the object came in via the
   * lossless bridge (a forward sidecar). Lets the plugin re-find the exact object
   * to write UVs back onto. When present, mesh vertices/faces are 1:1 with the
   * DCC's points/polygons (built from the sidecar, not the welded glTF).
   */
  c4dGuid?: string
}

/**
 * Half-edge connectivity built over a PolyMesh. Stored as parallel typed
 * arrays for cache-friendly traversal.
 */
export interface HEMesh {
  mesh: PolyMesh
  vertexCount: number
  faceCount: number
  halfEdgeCount: number

  // Per half-edge
  heV: Int32Array // origin vertex
  heFace: Int32Array // owning face
  heNext: Int32Array // next half-edge around the face loop
  hePrev: Int32Array // previous half-edge around the face loop
  heTwin: Int32Array // opposite half-edge, or -1 on a boundary
  heEdge: Int32Array // undirected edge id

  // Per face
  faceHe: Int32Array // one half-edge belonging to the face
  faceDegree: Int32Array // number of sides

  // Per undirected edge
  edgeA: Int32Array // endpoint a (a < b)
  edgeB: Int32Array // endpoint b
  edgeHe: Int32Array // a representative half-edge on the edge
  edgeCount: number
}

/**
 * A UV shell (island): a connected patch of faces separated from the rest by
 * seams or mesh boundaries. Vertices are re-indexed locally, duplicated where
 * seams cut them apart.
 */
export interface Shell {
  id: number
  /** local vertex 3D positions, xyz, length 3 * vertCount */
  positions: Float32Array
  /** triangles, 3 local-vertex indices each */
  triangles: Uint32Array
  /** original polygon faces as local-vertex loops (for edge/face editing) */
  polygons: number[][]
  /** for each local vertex, the original PolyMesh vertex it came from */
  toOrigVertex: Int32Array
  vertCount: number
  triCount: number
  /** original face ids contained in this shell */
  faceIds: number[]
}

/** UV coordinates for a shell, 2 floats per local vertex. */
export interface ShellUV {
  id: number
  uv: Float32Array // length 2 * vertCount
}

/** Per-corner UV assignment used to push UVs back onto the original mesh. */
export interface UVAssignment {
  /** maps (faceId, cornerSlot) -> uv index; stored flattened per face */
  faceCornerUV: Float32Array[] // faceCornerUV[faceId] = [u0,v0,u1,v1,...]
}
