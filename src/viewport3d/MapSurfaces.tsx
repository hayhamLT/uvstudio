import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { live } from '../state/live'
import { checkerForAspect } from '../three/checker'
import { computeDistortion } from '../unwrap/distortion'
import { stretchColor } from '../three/colors'

function objColor(name: string): THREE.Color {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return new THREE.Color(`hsl(${h} 45% 58%)`)
}

// 3D area of a triangle
function tri3DArea(p: Float32Array, i: number, j: number, k: number): number {
  const ax = p[j * 3] - p[i * 3],
    ay = p[j * 3 + 1] - p[i * 3 + 1],
    az = p[j * 3 + 2] - p[i * 3 + 2]
  const bx = p[k * 3] - p[i * 3],
    by = p[k * 3 + 1] - p[i * 3 + 1],
    bz = p[k * 3 + 2] - p[i * 3 + 2]
  const cx = ay * bz - az * by,
    cy = az * bx - ax * bz,
    cz = ax * by - ay * bx
  return 0.5 * Math.hypot(cx, cy, cz)
}

// signed UV area in PIXEL space (u scaled by the texture aspect)
function triUVArea(uv: Float32Array, i: number, j: number, k: number, aspect: number): number {
  const ax = (uv[j * 2] - uv[i * 2]) * aspect,
    ay = uv[j * 2 + 1] - uv[i * 2 + 1]
  const bx = (uv[k * 2] - uv[i * 2]) * aspect,
    by = uv[k * 2 + 1] - uv[i * 2 + 1]
  return 0.5 * (ax * by - ay * bx)
}

export default function MapSurfaces() {
  const mapShells = useStore((s) => s.mapShells)
  const mapObjects = useStore((s) => s.mapObjects)
  const mappedObjects = useStore((s) => s.mappedObjects)
  const selectedObject = useStore((s) => s.selectedObject)
  const selectObject = useStore((s) => s.selectObject)
  const layeredMode = useStore((s) => s.layeredMode)
  const view3d = useStore((s) => s.view3d)
  const cullBackface = useStore((s) => s.cullBackface)
  const uvVersion = useStore((s) => s.uvVersion)
  const screenOrder = useStore((s) => s.screenOrder)
  const hiddenScreens = useStore((s) => s.hiddenScreens)
  const soloScreen = useStore((s) => s.soloScreen)

  const hiddenSet = useMemo(() => new Set(hiddenScreens), [hiddenScreens])
  const orderIndex = useMemo(() => {
    const m = new Map<string, number>()
    screenOrder.forEach((n, i) => m.set(n, i))
    return m
  }, [screenOrder])

  // aspect (w/h) of the texture a screen samples — checker cells & distortion
  // are judged in that pixel space so non-square maps read honestly.
  const aspectFor = (objName: string) =>
    layeredMode ? live.objAspect.get(objName) ?? 1 : live.atlasAspect || 1

  // C4D-sourced objects had Z negated on import (left- → right-handed), which
  // reverses triangle winding. Flip the winding for RENDERING only (so normals
  // face out / shading is right) — the unwrap and the UVs sent back are untouched.
  const flippedObjs = useMemo(() => {
    const s = new Set<string>()
    for (const o of mapObjects) if (o.source === 'c4d') s.add(o.name)
    return s
  }, [mapObjects])

  const geoms = useMemo(() => {
    return mapShells.map((ms) => {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(ms.shell.positions.slice(), 3))
      const tris = Array.from(ms.shell.triangles)
      if (flippedObjs.has(ms.objName)) {
        for (let i = 0; i + 2 < tris.length; i += 3) {
          const t = tris[i + 1]
          tris[i + 1] = tris[i + 2]
          tris[i + 2] = t
        }
      }
      geo.setIndex(tris)
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ms.shell.vertCount * 2), 2))
      geo.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(ms.shell.vertCount * 3).fill(1), 3),
      )
      geo.computeVertexNormals()
      const wire = new THREE.WireframeGeometry(geo)
      const edges = new THREE.EdgesGeometry(geo, 25) // silhouette for selection outline
      return { geo, wire, edges }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapShells, flippedObjs])

  useEffect(
    () => () =>
      geoms.forEach((g) => {
        g.geo.dispose()
        g.wire.dispose()
        g.edges.dispose()
      }),
    [geoms],
  )

  const mappedSet = useMemo(() => new Set(mappedObjects), [mappedObjects])

  // Distortion vertex colors (recomputed when the mapping changes).
  //
  // Signed texel-density (stretch) map. Each shell remembers the texel density
  // (3D area ÷ pixel-space UV area) it had at its MAPPED baseline; here we show
  // how far the CURRENT UVs deviate from that. Scaling a screen's UV up spreads
  // its texels (under-sampled) → blue; scaling it down packs them → red. Local
  // shear / non-uniform stretch from the existing metric biases toward red so a
  // genuinely distorted (not just resized) map still reads as bad.
  useEffect(() => {
    if (view3d !== 'distortion') return
    const col = new THREE.Color()
    const K = Math.log(2.5) // UV area ~2.5× bigger/smaller → near full blue/red
    mapShells.forEach((ms, i) => {
      const uv = live.uv.get(ms.id)
      const attr = geoms[i].geo.getAttribute('color') as THREE.BufferAttribute
      if (!uv) return
      const A = aspectFor(ms.objName)
      const pos = ms.shell.positions
      const tris = ms.shell.triangles
      const vc = ms.shell.vertCount
      const triCount = tris.length / 3

      // per-triangle areas + shell totals
      const a3 = new Float64Array(triCount)
      const auv = new Float64Array(triCount)
      let a3Tot = 0
      let auvTot = 0
      for (let t = 0; t < triCount; t++) {
        const ia = tris[t * 3],
          ib = tris[t * 3 + 1],
          ic = tris[t * 3 + 2]
        const A3 = tri3DArea(pos, ia, ib, ic)
        const Auv = Math.abs(triUVArea(uv, ia, ib, ic, A))
        a3[t] = A3
        auv[t] = Auv
        a3Tot += A3
        auvTot += Auv
      }
      const dens = auvTot > 1e-12 ? a3Tot / auvTot : 1 // 3D per UV-pixel area
      let ref = live.refDensity.get(ms.id)
      if (ref == null || !isFinite(ref) || ref <= 0) {
        ref = dens // first look after a map = the baseline
        live.refDensity.set(ms.id, dens)
      }

      // shear / local-stretch badness (unsigned 0..1) from the existing metric
      const d = computeDistortion(pos, uv, tris, A)

      // accumulate signed scale deviation per vertex (avg of incident triangles)
      const signed = new Float64Array(vc)
      const cnt = new Float64Array(vc)
      for (let t = 0; t < triCount; t++) {
        const densT = auv[t] > 1e-12 ? a3[t] / auv[t] : dens
        // UV bigger than the baseline → densT < ref → expansion > 0 → blue
        const s = Math.tanh(Math.log(ref / Math.max(densT, 1e-9)) / K)
        const ia = tris[t * 3],
          ib = tris[t * 3 + 1],
          ic = tris[t * 3 + 2]
        signed[ia] += s
        signed[ib] += s
        signed[ic] += s
        cnt[ia]++
        cnt[ib]++
        cnt[ic]++
      }
      for (let v = 0; v < vc; v++) {
        const sc = cnt[v] ? signed[v] / cnt[v] : 0
        const bad = d.perVertex[v] // shear / local distortion (always "bad")
        // shear dominates → red; otherwise the signed resize (blue up / red down)
        const val = bad > Math.abs(sc) ? -bad : sc
        stretchColor(val, col)
        attr.setXYZ(v, col.r, col.g, col.b)
      }
      attr.needsUpdate = true
    })
  }, [geoms, mapShells, view3d, uvVersion])

  // Stream the REAL content UVs onto the surface each frame — the checker
  // samples these too, so it honestly shows any stretch/skew in the UVs.
  useFrame(() => {
    mapShells.forEach((ms, i) => {
      const uv = live.uv.get(ms.id)
      if (!uv) return
      const attr = geoms[i].geo.getAttribute('uv') as THREE.BufferAttribute
      ;(attr.array as Float32Array).set(uv)
      attr.needsUpdate = true
    })
  })

  return (
    <group>
      {geoms.map(({ geo, wire, edges }, i) => {
        const ms = mapShells[i]
        // visibility: hidden screens off; when soloing, only that screen shows
        const visible = !hiddenSet.has(ms.objName) && (soloScreen === null || soloScreen === ms.objName)
        if (!visible) return <group key={ms.id} visible={false} />

        const tex = layeredMode ? live.objTextures.get(ms.objName) ?? null : live.atlasTexture
        const hasUV = live.uv.has(ms.id)
        const contentTextured = !!tex && hasUV && (layeredMode || mappedSet.has(ms.objName))
        const isSel = selectedObject === ms.objName
        // draw order for overlapping screens: later in screenOrder = on top
        const order = orderIndex.get(ms.objName) ?? i

        let map: THREE.Texture | null = null
        let vertexColors = false
        let color = '#ffffff'
        let transparent = false
        if (view3d === 'checker' && hasUV) {
          map = checkerForAspect(aspectFor(ms.objName))
        } else if (view3d === 'distortion' && hasUV) {
          vertexColors = true
        } else {
          // shaded (content)
          map = contentTextured ? tex : null
          color = contentTextured
            ? '#ffffff'
            : layeredMode
              ? '#2b3140' // layered screen with no content yet → dim placeholder
              : `#${objColor(ms.objName).getHexString()}`
          transparent = layeredMode && contentTextured
        }

        return (
          <group key={ms.id}>
            <mesh
              geometry={geo}
              renderOrder={order}
              onClick={(e) => {
                e.stopPropagation()
                if (live.dragMoved3d) return // was an orbit drag, not a click
                selectObject(ms.objName)
              }}
            >
              <meshBasicMaterial
                key={`${view3d}-${layeredMode ? 'lay' : 'atl'}-${map ? 'm' : 'n'}`}
                map={map}
                vertexColors={vertexColors}
                color={isSel && !contentTextured ? '#9fd8ff' : color}
                transparent={transparent}
                alphaTest={transparent ? 0.02 : 0}
                side={cullBackface ? THREE.FrontSide : THREE.DoubleSide}
                toneMapped={false}
                polygonOffset
                polygonOffsetFactor={-order}
                polygonOffsetUnits={-order}
              />
            </mesh>
            {view3d === 'distortion' && (
              <lineSegments geometry={wire} renderOrder={2}>
                <lineBasicMaterial color="#0a0e14" transparent opacity={0.25} />
              </lineSegments>
            )}
            {/* selection outline — bright silhouette drawn over everything */}
            {isSel && (
              <lineSegments geometry={edges} renderOrder={1000}>
                <lineBasicMaterial color="#ffd23f" depthTest={false} transparent />
              </lineSegments>
            )}
          </group>
        )
      })}
      <group visible={false} userData={{ uvVersion }} />
    </group>
  )
}
