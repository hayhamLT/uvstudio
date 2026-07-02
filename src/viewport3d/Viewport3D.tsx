import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { live } from '../state/live'
import ActiveFrameloop from '../three/ActiveFrameloop'
import { useFileDrop } from '../ui/useFileDrop'
import { handleViewportDrop } from '../ui/importMap'
import MapSurfaces from './MapSurfaces'
import ContextSurfaces from './ContextSurfaces'
import { makeCheckerTexture } from '../three/checker'
import { distortionColor, THEME } from '../three/colors'
import {
  buildSurfaceGeometry,
  allEdgeSegments,
} from './geometry'

function SurfaceAndSeams() {
  const mesh = useStore((s) => s.mesh)
  const he = useStore((s) => s.he)
  const display = useStore((s) => s.display)
  const hasUV = useStore((s) => s.hasUV)

  const surface = useMemo(() => (mesh ? buildSurfaceGeometry(mesh) : null), [mesh])

  const wireGeom = useMemo(() => {
    if (!he) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(allEdgeSegments(he), 3))
    return g
  }, [he])

  if (!surface) return null
  const showSolid = !((display.checker || display.distortion) && hasUV)

  return (
    <group>
      <mesh geometry={surface.geometry}>
        <meshStandardMaterial
          color={showSolid ? THEME.surface : THEME.surfaceDim}
          roughness={0.62}
          metalness={0.04}
          flatShading={display.flatShade}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {hasUV && (display.checker || display.distortion) && <CheckerOverlay />}

      {display.wireframe && wireGeom && (
        <lineSegments geometry={wireGeom}>
          <lineBasicMaterial color={THEME.wire} transparent opacity={0.28} />
        </lineSegments>
      )}
    </group>
  )
}

function CheckerOverlay() {
  const shells = useStore((s) => s.shells)
  const display = useStore((s) => s.display)
  const uvVersion = useStore((s) => s.uvVersion)
  const checker = useMemo(() => makeCheckerTexture(1024, 24), [])
  const groupRef = useRef<THREE.Group>(null)

  const geoms = useMemo(() => {
    return shells.map((s) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(s.positions.slice(), 3))
      g.setIndex(Array.from(s.triangles))
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(s.vertCount * 2), 2))
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.vertCount * 3).fill(1), 3))
      g.computeVertexNormals()
      return g
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shells])

  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms])

  // Refresh distortion vertex colors when a relax pass completes.
  useEffect(() => {
    const col = new THREE.Color()
    shells.forEach((s, i) => {
      const g = geoms[i]
      const d = live.distortion.get(s.id)
      const arr = g.getAttribute('color') as THREE.BufferAttribute
      for (let v = 0; v < s.vertCount; v++) {
        if (d) distortionColor(d.perVertex[v], col)
        else col.set('#ffffff')
        arr.setXYZ(v, col.r, col.g, col.b)
      }
      arr.needsUpdate = true
    })
  }, [geoms, shells, uvVersion])

  // Stream UVs onto the surface during relax.
  useFrame(() => {
    shells.forEach((s, i) => {
      const uv = live.packed?.get(s.id) ?? live.uv.get(s.id)
      if (!uv) return
      const attr = geoms[i].getAttribute('uv') as THREE.BufferAttribute
      ;(attr.array as Float32Array).set(uv)
      attr.needsUpdate = true
    })
  })

  return (
    <group ref={groupRef} renderOrder={2}>
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial
            key={display.distortion ? 'dist' : 'checker'}
            map={display.distortion ? null : checker}
            vertexColors={display.distortion}
            color={display.distortion ? '#ffffff' : '#cfd8e6'}
            roughness={0.7}
            metalness={0.02}
            side={THREE.DoubleSide}
            flatShading={display.flatShade}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
          />
        </mesh>
      ))}
    </group>
  )
}

export default function Viewport3D() {
  const mesh = useStore((s) => s.mesh)
  const mode = useStore((s) => s.mode)
  const mapShells = useStore((s) => s.mapShells)
  const hasContent = mode === 'map' ? mapShells.length > 0 : !!mesh

  const { dragging, ref: dropRef } = useFileDrop(handleViewportDrop)

  // Distinguish a click (select) from a drag (orbit) so releasing an orbit over
  // a different screen doesn't change the selection.
  const downPos = useRef<[number, number] | null>(null)

  return (
    <div
      ref={dropRef}
      className="relative h-full w-full"
      onPointerEnter={() => {
        live.hoverPane = '3d'
      }}
      onPointerDown={(e) => {
        downPos.current = [e.clientX, e.clientY]
        live.dragMoved3d = false
      }}
      onPointerMove={(e) => {
        if (!downPos.current) return
        const dx = e.clientX - downPos.current[0]
        const dy = e.clientY - downPos.current[1]
        if (dx * dx + dy * dy > 25) live.dragMoved3d = true
      }}
      onPointerUp={() => {
        downPos.current = null
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [2.4, 1.8, 2.8], fov: 42, near: 0.01, far: 100 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <ActiveFrameloop />
        <color attach="background" args={['#0b0e14']} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[4, 6, 3]} intensity={0.8} />
        <Controls />
        <CameraRig />
        {mode === 'map' && <ContextSurfaces />}
        {hasContent && (mode === 'map' ? <MapSurfaces /> : <SurfaceAndSeams />)}
        <gridHelper args={[20, 20, '#1a2230', '#121821']} position={[0, -1.6, 0]} />
      </Canvas>
      {mode === 'map' && <View3dToolbar />}
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-500/10 text-sm font-medium text-brand-300 backdrop-blur-sm">
          Drop a model (OBJ / glTF / GLB) — or an image to apply to the active screen
        </div>
      )}
    </div>
  )
}

/** Frames the scene once on first load, then persists the camera position in
 *  `live.cam3d` so swapping primary/floating views doesn't re-fly. */
/** Snug near/far around the framed distance so the depth buffer keeps its
 *  precision (a fixed 0.01/1000 gives a ~100k:1 ratio → z-fighting / jagged
 *  edges). Recomputed as the user orbits/zooms so it stays crisp at any range. */
function setClips(camera: THREE.PerspectiveCamera, dist: number) {
  const d = Math.max(dist, 0.1)
  camera.near = d * 0.02
  camera.far = d * 4 + 100
  camera.updateProjectionMatrix()
}

function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3
    update: () => void
    addEventListener: (t: string, f: () => void) => void
    removeEventListener: (t: string, f: () => void) => void
  } | null
  const mapShells = useStore((s) => s.mapShells)
  const contextShells = useStore((s) => s.contextShells)
  // Track whether we've done the initial frame for THIS canvas mount.
  const framed = useRef(false)

  // Restore saved camera or frame from scratch — runs once controls + shells are ready.
  useEffect(() => {
    if (!controls || framed.current) return

    if (live.cam3d) {
      // Restore position from a previous mount (e.g. after Tab swap).
      camera.position.set(...live.cam3d.pos)
      controls.target.set(...live.cam3d.tgt)
      setClips(camera, camera.position.distanceTo(controls.target))
      controls.update()
      framed.current = true
      return
    }

    const all = [...mapShells, ...contextShells]
    if (!all.length) return

    // Compute bounding box of all shells (screens + reference geometry).
    let mnx = Infinity, mny = Infinity, mnz = Infinity
    let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity
    for (const ms of all) {
      const p = ms.shell.positions
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] < mnx) mnx = p[i]; if (p[i] > mxx) mxx = p[i]
        if (p[i+1] < mny) mny = p[i+1]; if (p[i+1] > mxy) mxy = p[i+1]
        if (p[i+2] < mnz) mnz = p[i+2]; if (p[i+2] > mxz) mxz = p[i+2]
      }
    }
    if (!Number.isFinite(mnx)) return

    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2, cz = (mnz + mxz) / 2
    const r = Math.max(
      (mxx - mnx) / 2, (mxy - mny) / 2, (mxz - mnz) / 2, 0.5
    )
    const fovHalf = ((camera.fov * Math.PI) / 180) / 2
    const dist = (r / Math.tan(fovHalf)) * 1.35
    const dir = new THREE.Vector3(1, 0.65, 1).normalize()
    const pos: [number,number,number] = [
      cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist
    ]
    setClips(camera, dist) // snug near/far → no z-fighting on the screen edges
    camera.position.set(...pos)
    controls.target.set(cx, cy, cz)
    controls.update()
    live.cam3d = { pos, tgt: [cx, cy, cz] }
    framed.current = true
  }, [controls, mapShells, contextShells, camera])

  // Save camera whenever the user moves it.
  useEffect(() => {
    if (!controls) return
    const save = () => {
      live.cam3d = {
        pos: camera.position.toArray() as [number,number,number],
        tgt: controls.target.toArray() as [number,number,number],
      }
      // keep depth precision crisp as the user orbits/dollies
      setClips(camera, camera.position.distanceTo(controls.target))
    }
    controls.addEventListener('change', save)
    return () => controls.removeEventListener('change', save)
  }, [controls, camera])

  return null
}

function View3dToolbar() {
  const view3d = useStore((s) => s.view3d)
  const setView3d = useStore((s) => s.setView3d)
  const modes: { id: 'shaded' | 'distortion' | 'checker'; label: string; hot: string; icon: JSX.Element }[] = [
    { id: 'shaded', label: 'Shaded (content)', hot: '1', icon: <circle cx="12" cy="12" r="7.5" fill="currentColor" stroke="none" /> },
    {
      id: 'distortion',
      label: 'Distortion feedback',
      hot: '2',
      icon: (
        <>
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <path d="M4 12h16M12 4v16" />
        </>
      ),
    },
    {
      id: 'checker',
      label: 'Checker',
      hot: '3',
      icon: (
        <>
          <rect x="4" y="4" width="7" height="7" fill="currentColor" stroke="none" />
          <rect x="13" y="13" width="7" height="7" fill="currentColor" stroke="none" />
          <rect x="4" y="4" width="16" height="16" rx="1" fill="none" />
        </>
      ),
    },
  ]
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-ink-850/90 p-1 shadow-xl backdrop-blur">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => setView3d(m.id)}
          title={`${m.label} (${m.hot})`}
          className={
            'flex h-8 w-8 items-center justify-center rounded-md transition ' +
            (view3d === m.id
              ? 'bg-brand-500/20 text-brand-400'
              : 'text-fog-400 hover:bg-ink-700 hover:text-fog-100')
          }
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            {m.icon}
          </svg>
        </button>
      ))}
    </div>
  )
}

function Controls() {
  const tool = useStore((s) => s.tool)
  const mode = useStore((s) => s.mode)
  const rotateWithLeft = mode === 'map' || tool === 'orbit' || tool === 'select'
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.12}
      mouseButtons={{
        LEFT: rotateWithLeft ? THREE.MOUSE.ROTATE : (undefined as unknown as THREE.MOUSE),
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
    />
  )
}

