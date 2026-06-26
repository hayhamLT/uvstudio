import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { live } from '../state/live'
import MapView2D from './MapView2D'
import { makeCheckerTexture } from '../three/checker'
import { distortionColor, THEME } from '../three/colors'
import ActiveFrameloop from '../three/ActiveFrameloop'

interface ShellGeo {
  id: number
  position: THREE.BufferAttribute
  color: THREE.BufferAttribute
  fill: THREE.BufferGeometry
  edges: THREE.BufferGeometry
  boundary: THREE.BufferGeometry
  vertCount: number
}

function uniqueEdges(tris: Uint32Array): { all: number[]; boundary: number[] } {
  const count = new Map<number, number>()
  const order: [number, number][] = []
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const k = lo * 1e7 + hi
    if (!count.has(k)) order.push([lo, hi])
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  for (let t = 0; t < tris.length; t += 3) {
    add(tris[t], tris[t + 1])
    add(tris[t + 1], tris[t + 2])
    add(tris[t + 2], tris[t])
  }
  const all: number[] = []
  const boundary: number[] = []
  for (const [a, b] of order) {
    all.push(a, b)
    const k = a * 1e7 + b
    if (count.get(k) === 1) boundary.push(a, b)
  }
  return { all, boundary }
}

function UVScene() {
  const shells = useStore((s) => s.shells)
  const display = useStore((s) => s.display)
  const isPacked = useStore((s) => s.isPacked)
  const selectedShells = useStore((s) => s.selectedShells)
  const uvVersion = useStore((s) => s.uvVersion)
  const checker = useMemo(() => makeCheckerTexture(1024, 24), [])

  // Cache per-shell display scale for the unpacked grid so islands don't jump.
  const scaleCache = useRef(new Map<number, number>())

  const geos = useMemo<ShellGeo[]>(() => {
    scaleCache.current.clear()
    return shells.map((s) => {
      const position = new THREE.BufferAttribute(new Float32Array(s.vertCount * 3), 3)
      const color = new THREE.BufferAttribute(new Float32Array(s.vertCount * 3).fill(0.6), 3)
      const { all, boundary } = uniqueEdges(s.triangles)
      const fill = new THREE.BufferGeometry()
      fill.setAttribute('position', position)
      fill.setAttribute('color', color)
      fill.setIndex(Array.from(s.triangles))
      const edges = new THREE.BufferGeometry()
      edges.setAttribute('position', position)
      edges.setIndex(all)
      const bnd = new THREE.BufferGeometry()
      bnd.setAttribute('position', position)
      bnd.setIndex(boundary)
      return { id: s.id, position, color, fill, edges, boundary: bnd, vertCount: s.vertCount }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shells])

  useEffect(
    () => () =>
      geos.forEach((g) => {
        g.fill.dispose()
        g.edges.dispose()
        g.boundary.dispose()
      }),
    [geos],
  )

  // Grid layout for the unpacked view.
  const grid = Math.max(1, Math.ceil(Math.sqrt(shells.length)))
  const cell = 1 / grid

  // Refresh distortion vertex colors when relax completes.
  useEffect(() => {
    const col = new THREE.Color()
    shells.forEach((s, i) => {
      const g = geos[i]
      const d = live.distortion.get(s.id)
      const base = selectedShells.has(s.id) ? THEME.shellSelected : THEME.shell
      for (let v = 0; v < g.vertCount; v++) {
        if (display.distortion && d) distortionColor(d.perVertex[v], col)
        else col.copy(base)
        g.color.setXYZ(v, col.r, col.g, col.b)
      }
      g.color.needsUpdate = true
    })
  }, [geos, shells, display.distortion, selectedShells, uvVersion])

  useFrame(() => {
    shells.forEach((s, i) => {
      const g = geos[i]
      const packed = live.packed?.get(s.id)
      const raw = live.uv.get(s.id)
      const arr = g.position.array as Float32Array
      if (isPacked && packed) {
        for (let v = 0; v < g.vertCount; v++) {
          arr[v * 3] = packed[v * 2]
          arr[v * 3 + 1] = packed[v * 2 + 1]
          arr[v * 3 + 2] = 0
        }
      } else if (raw) {
        // center in grid cell at fixed scale
        let cx = 0,
          cy = 0,
          maxD = 0
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity
        for (let v = 0; v < g.vertCount; v++) {
          const x = raw[v * 2]
          const y = raw[v * 2 + 1]
          cx += x
          cy += y
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
        cx /= g.vertCount
        cy /= g.vertCount
        maxD = Math.max(maxX - minX, maxY - minY, 1e-6)
        let scale = scaleCache.current.get(s.id)
        if (scale === undefined) {
          scale = (cell * 0.82) / maxD
          scaleCache.current.set(s.id, scale)
        }
        const col = i % grid
        const row = Math.floor(i / grid)
        const centerX = (col + 0.5) * cell
        const centerY = 1 - (row + 0.5) * cell
        for (let v = 0; v < g.vertCount; v++) {
          arr[v * 3] = (raw[v * 2] - cx) * scale + centerX
          arr[v * 3 + 1] = (raw[v * 2 + 1] - cy) * scale + centerY
          arr[v * 3 + 2] = 0
        }
      }
      g.position.needsUpdate = true
    })
  })

  const onShellDown = (id: number) => (e: ThreeEvent<PointerEvent>) => {
    if (useStore.getState().tool !== 'select') return
    e.stopPropagation()
    useStore.getState().selectShell(id, e.shiftKey)
  }

  return (
    <group>
      <UnitSquare checker={display.checker ? checker : null} grid={display.grid} />
      {geos.map((g, i) => {
        const selected = selectedShells.has(shells[i].id)
        return (
          <group key={g.id}>
            <mesh geometry={g.fill} renderOrder={1} onPointerDown={onShellDown(g.id)}>
              <meshBasicMaterial
                vertexColors
                transparent
                opacity={selected ? 0.55 : 0.34}
                side={THREE.DoubleSide}
                depthTest={false}
              />
            </mesh>
            <lineSegments geometry={g.edges} renderOrder={2}>
              <lineBasicMaterial
                color="#0a0e14"
                transparent
                opacity={0.25}
                depthTest={false}
              />
            </lineSegments>
            <lineSegments geometry={g.boundary} renderOrder={3}>
              <lineBasicMaterial
                color={selected ? '#5cc8ff' : '#8fa3bd'}
                transparent
                opacity={0.95}
                depthTest={false}
              />
            </lineSegments>
          </group>
        )
      })}
    </group>
  )
}

function UnitSquare({ checker, grid }: { checker: THREE.Texture | null; grid: boolean }) {
  const lines = useMemo(() => {
    const pts: number[] = []
    // border
    const border = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]
    for (let i = 0; i < border.length - 1; i++) {
      pts.push(border[i][0], border[i][1], 0, border[i + 1][0], border[i + 1][1], 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3))
    return g
  }, [])

  const gridGeom = useMemo(() => {
    const pts: number[] = []
    for (let i = 1; i < 4; i++) {
      const t = i / 4
      pts.push(t, 0, 0, t, 1, 0, 0, t, 0, 1, t, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3))
    return g
  }, [])

  return (
    <group>
      {checker && (
        <mesh position={[0.5, 0.5, -0.02]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={checker} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
      {grid && (
        <lineSegments geometry={gridGeom} renderOrder={0}>
          <lineBasicMaterial color="#1c2531" transparent opacity={0.7} depthTest={false} />
        </lineSegments>
      )}
      <lineSegments geometry={lines} renderOrder={1}>
        <lineBasicMaterial color="#3a4655" depthTest={false} />
      </lineSegments>
    </group>
  )
}

function FitCamera() {
  const { camera, size } = useThree()
  useEffect(() => {
    const ortho = camera as THREE.OrthographicCamera
    ortho.zoom = Math.min(size.width, size.height) * 0.78
    ortho.position.set(0.5, 0.5, 10)
    ortho.updateProjectionMatrix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height])
  return null
}

export default function Viewport2D() {
  const hasUV = useStore((s) => s.hasUV)
  const isRelaxing = useStore((s) => s.isRelaxing)
  const mode = useStore((s) => s.mode)
  if (mode === 'map') return <MapView2D />
  return (
    <div className="relative h-full w-full">
      <Canvas
        orthographic
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [0.5, 0.5, 10], near: 0.001, far: 100, zoom: 500 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <ActiveFrameloop />
        <color attach="background" args={['#090c11']} />
        <FitCamera />
        <OrbitControls
          enableRotate={false}
          enablePan
          screenSpacePanning
          mouseButtons={{
            LEFT: undefined as unknown as THREE.MOUSE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
          target={[0.5, 0.5, 0]}
        />
        <UVScene />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 select-none rounded-md bg-ink-900/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-fog-400 backdrop-blur">
        2D · UV {isRelaxing && <span className="ml-2 text-brand-400 normal-case tracking-normal">relaxing…</span>}
      </div>
      {!hasUV && !isRelaxing && <EmptyUV />}
    </div>
  )
}

function EmptyUV() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
      <div className="text-sm text-fog-400">No UVs yet</div>
    </div>
  )
}
