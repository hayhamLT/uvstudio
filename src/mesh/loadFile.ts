import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { PolyMesh, SceneObject } from './types'

/** Load a glTF / GLB file into a PolyMesh. */
export async function loadMeshFile(file: File): Promise<PolyMesh> {
  const name = file.name.replace(/\.[^.]+$/, '')
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'gltf' || ext === 'glb') {
    const buf = await file.arrayBuffer()
    return await gltfToPolyMesh(buf, name)
  }
  throw new Error(`Unsupported format: .${ext}`)
}

/** Load a file as a multi-object scene (named objects) for Screen Map mode. */
export async function loadSceneFile(file: File): Promise<SceneObject[]> {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'gltf' || ext === 'glb') {
    return await gltfToScene(await file.arrayBuffer())
  }
  throw new Error(`Unsupported format: .${ext}`)
}

/** Draw a three.js texture's image onto a fresh canvas (normalises ImageBitmap,
 *  HTMLImageElement, etc. and gives us reliable width/height). */
function textureToCanvas(tex: THREE.Texture | null | undefined): HTMLCanvasElement | null {
  const img = tex?.image as
    | (CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number })
    | undefined
  if (!img) return null
  const w = (img.width as number) || (img.videoWidth as number) || 0
  const h = (img.height as number) || (img.videoHeight as number) || 0
  if (!w || !h) return null
  try {
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return cv
  } catch {
    return null
  }
}

function gltfToScene(buffer: ArrayBuffer): Promise<SceneObject[]> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => {
        const objects: SceneObject[] = []
        const v = new THREE.Vector3()
        gltf.scene.updateMatrixWorld(true)
        let idx = 0
        gltf.scene.traverse((obj) => {
          const m = obj as THREE.Mesh
          if (!m.isMesh || !m.geometry) return
          const geo = m.geometry as THREE.BufferGeometry
          const pos = geo.getAttribute('position') as THREE.BufferAttribute
          if (!pos) return
          const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
          const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as
            | THREE.MeshStandardMaterial
            | undefined
          const texCanvas = uvAttr ? textureToCanvas(mat?.map) : null
          const hasUV = !!uvAttr && !!texCanvas

          const positions: number[] = []
          const uvs: number[] = []
          const faces: number[][] = []
          const map = new Map<string, number>()
          // Weld by position (and UV when present, to keep UV seams intact).
          const addVert = (x: number, y: number, z: number, u: number, w2: number) => {
            const key = hasUV
              ? `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)},${Math.round(u * 1e4)},${Math.round(w2 * 1e4)}`
              : `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
            const e = map.get(key)
            if (e !== undefined) return e
            const i = positions.length / 3
            positions.push(x, y, z)
            // glTF UVs use a top-left origin (V down); our textures are flipY=true
            // (OpenGL, V up). Flip V so imported content lands upright like in C4D.
            if (hasUV) uvs.push(u, 1 - w2)
            map.set(key, i)
            return i
          }
          const index = geo.getIndex()
          const triCount = index ? index.count / 3 : pos.count / 3
          for (let t = 0; t < triCount; t++) {
            const tri: number[] = []
            for (let c = 0; c < 3; c++) {
              const i = index ? index.getX(t * 3 + c) : t * 3 + c
              v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
              const u = uvAttr ? uvAttr.getX(i) : 0
              const w2 = uvAttr ? uvAttr.getY(i) : 0
              tri.push(addVert(v.x, v.y, v.z, u, w2))
            }
            if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) faces.push(tri)
          }
          if (faces.length) {
            const name = m.name || obj.name || `object_${++idx}`
            const so: SceneObject = { name, mesh: { name, positions: Float32Array.from(positions), faces } }
            if (hasUV && texCanvas) {
              so.uvs = Float32Array.from(uvs)
              so.textureImage = texCanvas
              so.textureAspect = texCanvas.width / Math.max(texCanvas.height, 1)
            }
            objects.push(so)
          }
        })
        if (objects.length === 0) reject(new Error('No mesh geometry in glTF'))
        else resolve(objects)
      },
      (err) => reject(err),
    )
  })
}

function gltfToPolyMesh(buffer: ArrayBuffer, name: string): Promise<PolyMesh> {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (gltf) => {
        const positions: number[] = []
        const faces: number[][] = []
        const map = new Map<string, number>()
        const v = new THREE.Vector3()
        const addVert = (x: number, y: number, z: number) => {
          const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`
          const e = map.get(key)
          if (e !== undefined) return e
          const idx = positions.length / 3
          positions.push(x, y, z)
          map.set(key, idx)
          return idx
        }
        gltf.scene.updateMatrixWorld(true)
        gltf.scene.traverse((obj) => {
          const m = obj as THREE.Mesh
          if (!m.isMesh || !m.geometry) return
          const geo = m.geometry as THREE.BufferGeometry
          const pos = geo.getAttribute('position') as THREE.BufferAttribute
          if (!pos) return
          const index = geo.getIndex()
          const triCount = index ? index.count / 3 : pos.count / 3
          for (let t = 0; t < triCount; t++) {
            const ia = index ? index.getX(t * 3) : t * 3
            const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1
            const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2
            const tri: number[] = []
            for (const i of [ia, ib, ic]) {
              v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
              tri.push(addVert(v.x, v.y, v.z))
            }
            if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) faces.push(tri)
          }
        })
        if (faces.length === 0) reject(new Error('No mesh geometry in glTF'))
        else resolve({ name, positions: Float32Array.from(positions), faces })
      },
      (err) => reject(err),
    )
  })
}
