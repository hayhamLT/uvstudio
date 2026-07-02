import { useEffect, useMemo, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import ActiveFrameloop from '../three/ActiveFrameloop'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { live } from '../state/live'
import { makeAlphaChecker } from '../three/checker'
import { useFileDrop } from '../ui/useFileDrop'
import { isEmbeddedHost } from '../ui/env'
import { handleViewportDrop } from '../ui/importMap'
import UVEditLayer from './UVEditLayer'
import FreeTransform from './FreeTransform'

function boundaryEdges(tris: Uint32Array): number[] {
  const count = new Map<number, number>()
  const order: [number, number][] = []
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b),
      hi = Math.max(a, b)
    const k = lo * 1e7 + hi
    if (!count.has(k)) order.push([lo, hi])
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  for (let t = 0; t < tris.length; t += 3) {
    add(tris[t], tris[t + 1])
    add(tris[t + 1], tris[t + 2])
    add(tris[t + 2], tris[t])
  }
  const out: number[] = []
  for (const [a, b] of order) if (count.get(a * 1e7 + b) === 1) out.push(a, b)
  return out
}

function objColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return new THREE.Color(`hsl(${h} 60% 60%)`)
}

type SrcRect = { x0: number; y0: number; x1: number; y1: number }

function Scene({
  aspect,
  srcRect,
  srcTex,
}: {
  aspect: number
  srcRect: SrcRect | null
  srcTex: THREE.Texture | null
}) {
  const mapShells = useStore((s) => s.mapShells)
  const regions = useStore((s) => s.regions)
  const assignment = useStore((s) => s.assignment)
  const selectedObject = useStore((s) => s.selectedObject)
  const layeredMode = useStore((s) => s.layeredMode)
  const editMode = useStore((s) => s.editMode)
  const uvVersion = useStore((s) => s.uvVersion)
  // when the selected screen is one chunk of a larger PSD, show the WHOLE PSD
  const bgTex = srcTex ?? (layeredMode ? live.objTextures.get(selectedObject ?? '') ?? null : live.atlasTexture)
  const alphaChecker = useMemo(makeAlphaChecker, [])
  alphaChecker.repeat.set(Math.max(1, Math.round(aspect * 9)), 9)

  const geos = useMemo(
    () =>
      (layeredMode ? mapShells.filter((ms) => ms.objName === selectedObject) : mapShells).map((ms) => {
        const position = new THREE.BufferAttribute(new Float32Array(ms.shell.vertCount * 3), 3)
        const fill = new THREE.BufferGeometry()
        fill.setAttribute('position', position)
        fill.setIndex(Array.from(ms.shell.triangles))
        const bnd = new THREE.BufferGeometry()
        bnd.setAttribute('position', position)
        bnd.setIndex(boundaryEdges(ms.shell.triangles))
        return { id: ms.id, objName: ms.objName, position, fill, bnd, vc: ms.shell.vertCount }
      }),
    [mapShells, layeredMode, selectedObject],
  )
  useEffect(
    () => () =>
      geos.forEach((g) => {
        g.fill.dispose()
        g.bnd.dispose()
      }),
    [geos],
  )

  useFrame(() => {
    const r = srcRect
    geos.forEach((g) => {
      const uv = live.uv.get(g.id)
      if (!uv) return
      const arr = g.position.array as Float32Array
      for (let v = 0; v < g.vc; v++) {
        const u = uv[v * 2]
        const vv = uv[v * 2 + 1]
        if (r) {
          // place the screen's [0..1] UVs into its slice of the full PSD
          arr[v * 3] = (r.x0 + u * (r.x1 - r.x0)) * aspect
          arr[v * 3 + 1] = 1 - r.y1 + vv * (r.y1 - r.y0)
        } else {
          arr[v * 3] = u * aspect
          arr[v * 3 + 1] = vv
        }
        arr[v * 3 + 2] = 0
      }
      g.position.needsUpdate = true
    })
  })

  // region outline rectangles (image y-down -> y-up display)
  const regionLines = useMemo(() => {
    const assignedIds = new Set(Object.values(assignment))
    return regions.map((r) => {
      const x0 = r.x0 * aspect,
        x1 = r.x1 * aspect
      const yt = 1 - r.y0,
        yb = 1 - r.y1
      const pts = [x0, yb, 0, x1, yb, 0, x1, yt, 0, x0, yt, 0, x0, yb, 0]
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3))
      return { g, assigned: assignedIds.has(r.id) }
    })
  }, [regions, assignment, aspect])
  useEffect(() => () => regionLines.forEach((r) => r.g.dispose()), [regionLines])

  // The rectangle of the displayed image the selected screen covers = the bbox of
  // its UVs, taken RAW (no wrap/clamp) so the box can be dragged anywhere — even
  // out past the edges, just like a free object. Stored PSD-norm (image y-down);
  // the box renderer applies the 1-y flip. Screens that use their WHOLE texture
  // (FLOOR, PILLAR…) still get a box around the full image so you can see the UVs.
  const markerRect = useMemo<SrcRect | null>(() => {
    if (!layeredMode || !selectedObject) return null
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity
    for (const g of geos) {
      const uv = live.uv.get(g.id)
      if (!uv) continue
      for (let i = 0; i < uv.length; i += 2) {
        const u = uv[i],
          v = uv[i + 1]
        if (u < u0) u0 = u
        if (u > u1) u1 = u
        if (v < v0) v0 = v
        if (v > v1) v1 = v
      }
    }
    if (!isFinite(u0)) return null
    return { x0: u0, y0: 1 - v1, x1: u1, y1: 1 - v0 }
  }, [layeredMode, selectedObject, geos, uvVersion])

  const markerBox = useMemo(() => {
    if (!markerRect) return null
    const x0 = markerRect.x0 * aspect,
      x1 = markerRect.x1 * aspect
    const yb = 1 - markerRect.y1,
      yt = 1 - markerRect.y0
    // 4 corners — drawn as a lineLoop, which closes the rectangle for us
    const pts = [x0, yb, 0, x1, yb, 0, x1, yt, 0, x0, yt, 0]
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pts), 3))
    return g
  }, [markerRect, aspect])
  useEffect(() => () => markerBox?.dispose(), [markerBox])

  return (
    <group>
      {/* transparency checkerboard behind the layer/atlas (shows through alpha) */}
      {bgTex && (
        <mesh position={[aspect / 2, 0.5, -0.03]}>
          <planeGeometry args={[aspect, 1]} />
          <meshBasicMaterial map={alphaChecker} toneMapped={false} />
        </mesh>
      )}
      {/* atlas / active-layer background */}
      {bgTex && (
        <mesh position={[aspect / 2, 0.5, -0.02]}>
          <planeGeometry args={[aspect, 1]} />
          <meshBasicMaterial map={bgTex} toneMapped={false} transparent />
        </mesh>
      )}
      {/* detected region outlines */}
      {regionLines.map((r, i) => (
        <lineSegments key={i} geometry={lineLoopToSegments(r.g)} renderOrder={2}>
          <lineBasicMaterial
            color={r.assigned ? '#5cc8ff' : '#4a5666'}
            transparent
            opacity={r.assigned ? 0.9 : 0.5}
            depthTest={false}
          />
        </lineSegments>
      ))}
      {/* Layered mode: ONE clean yellow box on the covered sub-region — and
          nothing at all when the screen fills the whole image (no full-image
          box). Atlas mode keeps the per-object footprints. */}
      {!layeredMode
        ? geos.map((g) => {
            const sel = selectedObject === g.objName
            const col = objColor(g.objName)
            return (
              <group key={g.id}>
                <mesh geometry={g.fill} renderOrder={3}>
                  <meshBasicMaterial
                    color={sel ? '#ffd23f' : col}
                    transparent
                    opacity={sel ? 0.25 : 0.16}
                    side={THREE.DoubleSide}
                    depthTest={false}
                  />
                </mesh>
                <lineSegments geometry={g.bnd} renderOrder={4}>
                  <lineBasicMaterial color={sel ? '#ffd23f' : col} transparent opacity={1} depthTest={false} />
                </lineSegments>
              </group>
            )
          })
        : markerRect && (
            <>
              {/* the fill is a coverage highlight; hide it while editing
                  vertices/edges/faces so it never sits over the mesh */}
              {(editMode === 'object' || editMode === 'transform') && (
                <mesh
                  position={[
                    ((markerRect.x0 + markerRect.x1) / 2) * aspect,
                    1 - (markerRect.y0 + markerRect.y1) / 2,
                    -0.005,
                  ]}
                  renderOrder={5}
                >
                  <planeGeometry
                    args={[(markerRect.x1 - markerRect.x0) * aspect, markerRect.y1 - markerRect.y0]}
                  />
                  <meshBasicMaterial color="#ffd23f" transparent opacity={0.2} depthTest={false} toneMapped={false} />
                </mesh>
              )}
              {markerBox && (
                <lineLoop geometry={markerBox} renderOrder={6}>
                  <lineBasicMaterial color="#ffd23f" depthTest={false} />
                </lineLoop>
              )}
            </>
          )}
      <group visible={false} userData={{ uvVersion }} />
    </group>
  )
}

// Convert a polyline (loop) geometry to LINES segments so we can use lineSegments.
function lineLoopToSegments(loop: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = loop.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const out: number[] = []
  for (let i = 0; i < n - 1; i++) {
    out.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(out), 3))
  return g
}

const VPath = <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
const EPath = <path d="M5 19 19 5" />
const FPath = <rect x="5" y="5" width="14" height="14" rx="1" fill="currentColor" stroke="none" />
// Cube — matches the app logo so "Object" reads as a whole 3D screen.
const ObjPath = (
  <>
    <path d="M12 3 21 8v8l-9 5-9-5V8l9-5Z" strokeLinejoin="round" />
    <path d="M3.5 8 12 13l8.5-5M12 13v8" strokeLinejoin="round" />
  </>
)
// Free transform — bounding box with corner handles.
const XformPath = (
  <>
    <rect x="6" y="6" width="12" height="12" rx="0.5" />
    <rect x="3.5" y="3.5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="17.5" y="3.5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="3.5" y="17.5" width="3" height="3" fill="currentColor" stroke="none" />
    <rect x="17.5" y="17.5" width="3" height="3" fill="currentColor" stroke="none" />
  </>
)

function EditToolbar() {
  const editMode = useStore((s) => s.editMode)
  const setEditMode = useStore((s) => s.setEditMode)
  const modes: {
    id: 'object' | 'vertex' | 'edge' | 'face'
    label: string
    hot: string
    icon: JSX.Element
  }[] = [
    { id: 'vertex', label: 'Vertex', hot: '1', icon: VPath },
    { id: 'edge', label: 'Edge', hot: '2', icon: EPath },
    { id: 'face', label: 'Face (polygon)', hot: '3', icon: FPath },
    { id: 'object', label: 'Object (whole screen)', hot: '4', icon: ObjPath },
  ]
  return (
    <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-line bg-ink-850/90 p-1 shadow-xl backdrop-blur">
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => setEditMode(m.id)}
          title={`${m.label} (${m.hot})`}
          className={
            'group relative flex h-8 w-8 items-center justify-center rounded-md transition ' +
            (editMode === m.id
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

function TBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={
        'btn-press flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ' +
        (active ? 'bg-brand-500/20 text-brand-400' : 'text-fog-400 hover:bg-ink-700 hover:text-fog-100')
      }
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-line" />
}

/** Per-screen transform tools for the selected screen, docked at the bottom of
 *  the 2D viewer: rotate / flip / scale / reset / solo / auto-map. */
function ScreenTransformBar() {
  const name = useStore((s) => s.selectedObject)
  const isScreen = useStore((s) => !!name && s.mapObjects.some((o) => o.name === name))
  const projection = useStore((s) => s.mapProjection[name ?? ''] ?? 'auto')
  const setObjectProjection = useStore((s) => s.setObjectProjection)
  const rotateObject = useStore((s) => s.rotateObject)
  const flipObject = useStore((s) => s.flipObject)
  const runMappingFor = useStore((s) => s.runMappingFor)
  const editMode = useStore((s) => s.editMode)
  const setEditMode = useStore((s) => s.setEditMode)
  if (!name || !isScreen) return null
  return (
    <div className="no-scrollbar absolute bottom-3 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-ink-850/90 p-1 shadow-xl backdrop-blur">
      <button
        onClick={() => runMappingFor(name)}
        title="Auto-map this screen (M)"
        className="btn-press shrink-0 whitespace-nowrap rounded-md bg-ink-700/70 px-2 py-1 text-[11px] font-medium text-fog-100 hover:bg-ink-600"
      >
        Auto-map
      </button>
      <Divider />
      <TBtn title="Rotate CCW (⇧R)" onClick={() => rotateObject(name, 'ccw')}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 3v5h5" />
      </TBtn>
      <TBtn title="Rotate CW (R)" onClick={() => rotateObject(name, 'cw')}>
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v5h-5" />
      </TBtn>
      <Divider />
      <TBtn title="Flip horizontal (F)" onClick={() => flipObject(name, 'x')}>
        <path d="M12 3v18" strokeDasharray="2 2" />
        <path d="M8 7 4 12l4 5V7ZM16 7l4 5-4 5V7Z" />
      </TBtn>
      <TBtn title="Flip vertical (⇧F)" onClick={() => flipObject(name, 'y')}>
        <path d="M3 12h18" strokeDasharray="2 2" />
        <path d="M7 8 12 4l5 4H7ZM7 16l5 4 5-4H7Z" />
      </TBtn>
      <Divider />
      <TBtn
        title="Free transform — scale / rotate / move (T)"
        active={editMode === 'transform'}
        onClick={() => setEditMode(editMode === 'transform' ? 'object' : 'transform')}
      >
        {XformPath}
      </TBtn>
      <Divider />
      <select
        value={projection}
        onChange={(e) =>
          setObjectProjection(name, e.target.value as 'auto' | 'planar' | 'cylindrical' | 'spherical')
        }
        title="Unwrap projection (Auto keeps imported UVs)"
        className="shrink-0 rounded-md border border-line bg-ink-800 px-1.5 py-1 text-[11px] text-fog-200 ring-focus"
      >
        <option value="auto">Auto</option>
        <option value="planar">Planar</option>
        <option value="cylindrical">Cylindrical</option>
        <option value="spherical">Spherical</option>
      </select>
    </div>
  )
}

function FitCamera({ aspect }: { aspect: number }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const o = camera as THREE.OrthographicCamera
    o.zoom = (Math.min(size.width / aspect, size.height) * 0.82) / 1
    o.position.set(aspect / 2, 0.5, 10)
    o.updateProjectionMatrix()
  }, [camera, size.width, size.height, aspect])
  return null
}

export default function MapView2D() {
  const atlas = useStore((s) => s.atlas)
  const layeredMode = useStore((s) => s.layeredMode)
  const selectedObject = useStore((s) => s.selectedObject)
  useStore((s) => s.uvVersion) // re-evaluate aspect after a PSD load
  // if the selected screen is one chunk of a bigger PSD, show the WHOLE PSD
  const src = layeredMode && selectedObject ? live.objSource.get(selectedObject) ?? null : null
  const aspect = src
    ? src.aspect
    : layeredMode
      ? selectedObject
        ? live.objAspect.get(selectedObject) ?? 1
        : 1
      : atlas
        ? atlas.width / atlas.height
        : 2
  const mappedCount = useStore((s) => s.mappedObjects.length)

  // A screen is selected in layered mode but has no image / UVs yet.
  const noContentScreen = layeredMode && !!selectedObject && !live.objTextures.has(selectedObject)
  // In an embedded host (Electron preview) the OS captures file drops before the
  // page, so steer the hints toward the click-to-pick controls instead.
  const embedded = isEmbeddedHost()

  // Dropping a single image applies it to the active (or name-matched) screen,
  // auto-generating its UVs. See handleViewportDrop for the full routing.
  const { dragging, ref: dropRef } = useFileDrop(handleViewportDrop)

  return (
    <div
      className="relative h-full w-full"
      ref={dropRef}
      onPointerEnter={() => {
        live.hoverPane = '2d'
      }}
    >
      <Canvas
        orthographic
        frameloop="demand"
        dpr={[1, 1.5]}
        camera={{ position: [aspect / 2, 0.5, 10], near: 0.001, far: 100, zoom: 400 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <ActiveFrameloop />
        <color attach="background" args={['#090c11']} />
        <FitCamera aspect={aspect} />
        <OrbitControls
          enableRotate={false}
          enablePan
          screenSpacePanning
          mouseButtons={{
            LEFT: undefined as unknown as THREE.MOUSE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN,
          }}
          target={[aspect / 2, 0.5, 0]}
        />
        <Scene aspect={aspect} srcRect={src?.rect ?? null} srcTex={src?.tex ?? null} />
        <UVEditLayer aspect={aspect} />
        <FreeTransform aspect={aspect} />
      </Canvas>
      <EditToolbar />
      <ScreenTransformBar />
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-500/10 px-4 text-center text-sm font-medium text-brand-300 backdrop-blur-sm">
          {layeredMode && selectedObject ? (
            <span>
              Drop an image → <span className="font-semibold text-brand-200">{selectedObject}</span>
              <span className="text-brand-300/70"> · multiple files / PSD match by file name</span>
            </span>
          ) : (
            'Drop map image(s) or a PSD'
          )}
        </div>
      )}
      {!atlas && !layeredMode && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-fog-400/70">
          {embedded ? 'Import a map image (or PSD) to begin' : 'Import or drop a map image (or PSD) to begin'}
        </div>
      )}
      {noContentScreen && !dragging && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <div className="text-sm text-fog-300">
            <span className="font-medium text-fog-100">{selectedObject}</span> has no content yet
          </div>
          <div className="max-w-xs text-xs leading-relaxed text-fog-400/70">
            {embedded ? (
              <>
                Click the <span className="font-medium text-fog-200">image ＋</span> button on this
                screen in the Screens list to add an image — its UVs are generated automatically.
              </>
            ) : (
              <>
                Drop an image here, or click ＋ Add image in the Screens list — its UVs are generated
                automatically.
              </>
            )}
          </div>
        </div>
      )}
      {!layeredMode && atlas && mappedCount === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs text-fog-400/70">
          Assign objects to regions, then “Map UVs”
        </div>
      )}
      {layeredMode && !selectedObject && mappedCount === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs text-fog-400/70">
          {embedded
            ? 'Select a screen, then click its image ＋ button to map it'
            : 'Select a screen, then drop an image here to map it'}
        </div>
      )}
    </div>
  )
}
