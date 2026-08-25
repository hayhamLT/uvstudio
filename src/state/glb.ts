// ---------------------------------------------------------------------------
// Export side of the app: the per-screen render spec, the sidecar manifest,
// and the mapped GLB itself. Shared by "Export GLB" and by "Send" over the
// Cinema 4D / Blender bridge, so both always describe a scene identically.
// ---------------------------------------------------------------------------
import * as THREE from 'three'
import { live } from './live'
import type { MapShell, ScreenSpec } from './types'

/** Just the slice of app state the render sizes are derived from — named
 *  structurally so this module never has to import the store. */
export interface ScreenResSource {
  mappedObjects: string[]
  screenRes: Record<string, { w: number; h: number }>
}

/** The LED render size for each mapped screen: the manual RES override if set,
 *  else the applied media's pixel dimensions. Feeds the export sidecar + bridge
 *  manifest so a render pipeline / C4D gets the exact pixel sizes. */
export function screenSpecs(g: ScreenResSource): ScreenSpec[] {
  const dims = (i?: { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number }) => ({
    w: i?.naturalWidth || i?.width || 0,
    h: i?.naturalHeight || i?.height || 0,
  })
  return g.mappedObjects.map((name) => {
    let w = 0
    let h = 0
    const ov = g.screenRes[name]
    if (ov?.w && ov?.h) {
      // explicit RES override — always wins
      w = ov.w
      h = ov.h
    } else {
      const f = dims(live.objTextures.get(name)?.image as { width?: number; height?: number })
      const cr = live.objContentRect.get(name)
      if (cr && (cr.u1 - cr.u0 < 0.999 || cr.v1 - cr.v0 < 0.999)) {
        // chunk screen: samples a sub-region of a bigger image via UVs → the
        // slice's pixel size is that fraction of the full image
        w = Math.round((cr.u1 - cr.u0) * f.w)
        h = Math.round((cr.v1 - cr.v0) * f.h)
      } else {
        w = f.w
        h = f.h
      }
    }
    return { name, w, h, aspect: h ? w / h : live.objAspect.get(name) ?? 1 }
  })
}

/** Sidecar manifest (pretty JSON) listing every screen's render size. */
export function screenManifest(specs: ScreenSpec[]): string {
  return JSON.stringify({ v: 1, app: 'UV Studio', kind: 'screen-map', screens: specs }, null, 2)
}

/** Build a binary glTF (GLB) of all mapped screens — geometry + per-screen UVs
 *  and textures, with each screen's render resolution in its node `extras`.
 *  Returns null when there is nothing mapped yet. Shared by "GLB" + "Send". */
export async function buildMappedGlb(
  mapShells: MapShell[],
  layeredMode: boolean,
  specByName?: Map<string, ScreenSpec>,
): Promise<ArrayBuffer | null> {
  if (!mapShells.length) return null
  const group = new THREE.Group()
  for (const ms of mapShells) {
    const uv = live.uv.get(ms.id)
    if (!uv) continue
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(ms.shell.positions.slice(), 3))
    geo.setIndex(Array.from(ms.shell.triangles))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2))
    geo.computeVertexNormals()
    const tex = layeredMode ? live.objTextures.get(ms.objName) ?? null : live.atlasTexture
    const mat = new THREE.MeshStandardMaterial({
      map: tex ?? null,
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: layeredMode,
      roughness: 0.7,
      metalness: 0,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = ms.objName
    // GLTFExporter writes userData → node.extras, so the LED size travels in the GLB
    const spec = specByName?.get(ms.objName)
    if (spec) mesh.userData = { uvstudio: { resolution: [spec.w, spec.h], aspect: spec.aspect } }
    group.add(mesh)
  }
  if (!group.children.length) return null
  // The exporter is only ever reached by Export / Send — keep it out of the
  // bundle the landing page has to download.
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  return new Promise((resolve) => {
    new GLTFExporter().parse(
      group,
      (result) => resolve(result as ArrayBuffer),
      () => resolve(null),
      { binary: true, onlyVisible: false },
    )
  })
}
