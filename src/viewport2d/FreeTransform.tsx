import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../state/store'
import { live } from '../state/live'

// ---------------------------------------------------------------------------
// Photoshop-style free-transform gizmo for the 2D UV view.
//
// Behaves like PS's Edit ▸ Free Transform:
//   • an ORIENTED bounding box that rotates with the content (not an AABB),
//     so rotate → scale → move compose like a real transform session;
//   • drag a CORNER → scale (proportional, from the CENTRE — headus-style;
//     Shift = non-uniform; Alt = anchor the opposite corner instead);
//   • drag an EDGE handle → stretch that one axis;
//   • hover just OUTSIDE a corner → the rotate cursor appears; drag to rotate
//     about the box centre (Shift = snap to 15°);
//   • drag INSIDE → move.
//   • context cursors: directional resize arrows on handles (rotated to match
//     the box), a curved rotate cursor outside corners, the move cursor inside.
//
// The box is kept as { O, U, V }: a point at normalised (a,b) maps to
// O + a·U + b·V. All math is in DISPLAY space (x = u·aspect, y = v) — the space
// the user sees — then written back to raw u,v.
// ---------------------------------------------------------------------------

type Vec = { x: number; y: number }
type Region =
  | { type: 'scale'; nu: number; nv: number }
  | { type: 'stretch'; nu: number; nv: number }
  | { type: 'rotate'; nu: number; nv: number }
  | { type: 'move' }
  | null

type Session = {
  items: { uv: Float32Array; indices: number[]; norm: Float32Array }[]
  O: Vec
  U: Vec
  V: Vec
}

const CORNERS: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]
const MIDS: [number, number][] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
]

/** White square handle with a thin grey border — the Photoshop handle look. */
function makeSquareSprite(): THREE.Texture {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#5b6675'
  ctx.fillRect(8, 8, s - 16, s - 16)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(11, 11, s - 22, s - 22)
  const tex = new THREE.CanvasTexture(cv)
  tex.needsUpdate = true
  return tex
}

// curved double-arrow rotate cursor (white halo + black line → visible anywhere)
const ROTATE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">' +
  '<g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6 9a7 7 0 0 1 12-1.5"/><path d="M18 3.5V8h-4.5"/>' +
  '<path d="M18 15a7 7 0 0 1-12 1.5"/><path d="M6 20.5V16h4.5"/></g>' +
  '<g fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M6 9a7 7 0 0 1 12-1.5"/><path d="M18 3.5V8h-4.5"/>' +
  '<path d="M18 15a7 7 0 0 1-12 1.5"/><path d="M6 20.5V16h4.5"/></g></svg>'
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(ROTATE_SVG)}") 13 13, auto`

export default function FreeTransform({ aspect }: { aspect: number }) {
  const editMode = useStore((s) => s.editMode)
  const allShells = useStore((s) => s.mapShells)
  const selectedObject = useStore((s) => s.selectedObject)
  const mapSelection = useStore((s) => s.mapSelection)
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const gl = useThree((s) => s.gl)
  const sprite = useMemo(makeSquareSprite, [])

  const boxRef = useRef<THREE.LineLoop>(null)
  const handlesRef = useRef<THREE.Points>(null)
  const sessionRef = useRef<Session | null>(null)
  const gestureRef = useRef<unknown>(null)
  const lastVersionRef = useRef<number>(-1)

  const geo = useMemo(() => {
    const box = new THREE.BufferGeometry()
    box.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3))
    const handles = new THREE.BufferGeometry()
    handles.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3))
    return { box, handles }
  }, [])
  useEffect(
    () => () => {
      geo.box.dispose()
      geo.handles.dispose()
    },
    [geo],
  )

  // The set of UV vertices the gizmo acts on (selection if any, else screen).
  const computeTargets = () => {
    const st = useStore.getState()
    const sel = st.mapSelection
    const out: { uv: Float32Array; indices: number[] }[] = []
    if (sel.size) {
      const byShell = new Map<number, number[]>()
      for (const k of sel) {
        const [sid, v] = k.split(':')
        const id = Number(sid)
        const arr = byShell.get(id) ?? []
        arr.push(Number(v))
        byShell.set(id, arr)
      }
      for (const [id, indices] of byShell) {
        const uv = live.uv.get(id)
        if (uv) out.push({ uv, indices })
      }
    } else if (selectedObject) {
      for (const ms of allShells) {
        if (ms.objName !== selectedObject) continue
        const uv = live.uv.get(ms.id)
        if (!uv) continue
        const indices: number[] = []
        for (let v = 0; v < ms.shell.vertCount; v++) indices.push(v)
        out.push({ uv, indices })
      }
    }
    return out
  }

  // (Re)build the transform session from the current UVs as an axis-aligned box.
  const rebuild = () => {
    const targets = computeTargets()
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (const t of targets)
      for (const v of t.indices) {
        const x = t.uv[v * 2] * aspect
        const y = t.uv[v * 2 + 1]
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    if (!isFinite(x0)) {
      sessionRef.current = null
      lastVersionRef.current = useStore.getState().uvVersion
      return
    }
    const w = x1 - x0
    const h = y1 - y0
    const items = targets.map((t) => {
      const norm = new Float32Array(t.indices.length * 2)
      t.indices.forEach((v, k) => {
        const x = t.uv[v * 2] * aspect
        const y = t.uv[v * 2 + 1]
        norm[k * 2] = w > 1e-9 ? (x - x0) / w : 0
        norm[k * 2 + 1] = h > 1e-9 ? (y - y0) / h : 0
      })
      return { uv: t.uv, indices: t.indices, norm }
    })
    sessionRef.current = { items, O: { x: x0, y: y0 }, U: { x: w, y: 0 }, V: { x: 0, y: h } }
    lastVersionRef.current = useStore.getState().uvVersion
  }

  // Write the current { O, U, V } back onto the UVs.
  const applyToUVs = () => {
    const s = sessionRef.current
    if (!s) return
    const { O, U, V } = s
    for (const it of s.items) {
      it.indices.forEach((v, k) => {
        const nu = it.norm[k * 2]
        const nv = it.norm[k * 2 + 1]
        const wx = O.x + nu * U.x + nv * V.x
        const wy = O.y + nu * U.y + nv * V.y
        it.uv[v * 2] = wx / aspect
        it.uv[v * 2 + 1] = wy
      })
    }
    live.dirty = true
    const nv = useStore.getState().uvVersion + 1
    useStore.setState({ uvVersion: nv })
    lastVersionRef.current = nv
  }

  const pt = (s: Session, nu: number, nv: number): Vec => ({
    x: s.O.x + nu * s.U.x + nv * s.V.x,
    y: s.O.y + nu * s.U.y + nv * s.V.y,
  })

  // Force a rebuild whenever the target or view scale changes.
  useEffect(() => {
    sessionRef.current = null
    lastVersionRef.current = -1
  }, [editMode, selectedObject, mapSelection, aspect])

  // ---- draw the oriented box + handles each frame ----
  useFrame(() => {
    const show = editMode === 'transform'
    if (boxRef.current) boxRef.current.visible = show
    if (handlesRef.current) handlesRef.current.visible = show
    if (!show) return
    // pick up external edits (undo / re-map / panel scale) when idle
    if (!gestureRef.current && useStore.getState().uvVersion !== lastVersionRef.current) rebuild()
    const s = sessionRef.current
    if (!s) {
      if (boxRef.current) boxRef.current.visible = false
      if (handlesRef.current) handlesRef.current.visible = false
      return
    }
    const ba = geo.box.getAttribute('position').array as Float32Array
    CORNERS.forEach(([nu, nv], i) => {
      const p = pt(s, nu, nv)
      ba[i * 3] = p.x
      ba[i * 3 + 1] = p.y
      ba[i * 3 + 2] = 0.5
    })
    geo.box.getAttribute('position').needsUpdate = true

    const ha = geo.handles.getAttribute('position').array as Float32Array
    ;[...CORNERS, ...MIDS].forEach(([nu, nv], i) => {
      const p = pt(s, nu, nv)
      ha[i * 3] = p.x
      ha[i * 3 + 1] = p.y
      ha[i * 3 + 2] = 0.6
    })
    geo.handles.getAttribute('position').needsUpdate = true
  })

  // ---- pointer interaction (hover cursors + drag transforms) ----
  useEffect(() => {
    if (editMode !== 'transform') return
    const el = gl.domElement
    const toWorld = (clientX: number, clientY: number): Vec => {
      const rc = el.getBoundingClientRect()
      const ndcx = ((clientX - rc.left) / rc.width) * 2 - 1
      const ndcy = -(((clientY - rc.top) / rc.height) * 2 - 1)
      const v = new THREE.Vector3(ndcx, ndcy, 0).unproject(camera)
      return { x: v.x, y: v.y }
    }

    // which part of the gizmo is under world-point P?
    const regionAt = (P: Vec): Region => {
      const s = sessionRef.current
      if (!s) return null
      const zoom = camera.zoom || 1
      const cthr = 11 / zoom // corner/edge grab radius
      const rOuter = 26 / zoom // rotate ring outer radius
      // corners first (scale), then rotate ring around them
      for (const [nu, nv] of CORNERS) {
        const c = pt(s, nu, nv)
        if (Math.hypot(P.x - c.x, P.y - c.y) <= cthr) return { type: 'scale', nu, nv }
      }
      for (const [nu, nv] of MIDS) {
        const c = pt(s, nu, nv)
        if (Math.hypot(P.x - c.x, P.y - c.y) <= cthr) return { type: 'stretch', nu, nv }
      }
      // inside parallelogram?
      const det = s.U.x * s.V.y - s.U.y * s.V.x || 1e-9
      const a = ((P.x - s.O.x) * s.V.y - (P.y - s.O.y) * s.V.x) / det
      const b = (s.U.x * (P.y - s.O.y) - s.U.y * (P.x - s.O.x)) / det
      if (a >= 0 && a <= 1 && b >= 0 && b <= 1) return { type: 'move' }
      // just outside a corner → rotate
      for (const [nu, nv] of CORNERS) {
        const c = pt(s, nu, nv)
        if (Math.hypot(P.x - c.x, P.y - c.y) <= rOuter) return { type: 'rotate', nu, nv }
      }
      return null
    }

    // Directional resize cursor for a handle, expressed in the box's LOCAL frame
    // (so a corner always reads as a diagonal regardless of the box aspect) and
    // rotated to follow the box orientation — exactly like Photoshop.
    const resizeCursor = (s: Session, nu: number, nv: number): string => {
      const lU = Math.hypot(s.U.x, s.U.y) || 1
      const lV = Math.hypot(s.V.x, s.V.y) || 1
      const uh = { x: s.U.x / lU, y: s.U.y / lU }
      const vh = { x: s.V.x / lV, y: s.V.y / lV }
      const su = (nu - 0.5) * 2 // -1 / 0 / +1 outward along U
      const sv = (nv - 0.5) * 2 // -1 / 0 / +1 outward along V
      const ox = su * uh.x + sv * vh.x
      const oy = su * uh.y + sv * vh.y
      const ang = Math.atan2(-oy, ox) // to screen space (y down)
      const a = (((ang * 180) / Math.PI) % 180 + 180) % 180
      const bucket = Math.round(a / 45) % 4
      return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][bucket]
    }

    const cursorFor = (r: Region): string => {
      const s = sessionRef.current
      if (!r || !s) return 'default'
      if (r.type === 'move') return 'move'
      if (r.type === 'rotate') return ROTATE_CURSOR
      return resizeCursor(s, r.nu, r.nv) // scale / stretch
    }

    // --- hover: update the cursor ---
    const onHover = (ev: PointerEvent) => {
      if (gestureRef.current) return
      el.style.cursor = cursorFor(regionAt(toWorld(ev.clientX, ev.clientY)))
    }
    const onLeave = () => {
      if (!gestureRef.current) el.style.cursor = 'default'
    }

    // --- drag ---
    type Gesture = {
      region: Exclude<Region, null>
      O0: Vec
      U0: Vec
      V0: Vec
      anchor: Vec
      uHat: Vec
      vHat: Vec
      lenU: number
      lenV: number
      pivot: Vec
      startAngle: number
      start: Vec
      pushed: boolean
    }

    const beginGesture = (r: Exclude<Region, null>, P: Vec): Gesture => {
      const s = sessionRef.current!
      const O0 = { ...s.O }
      const U0 = { ...s.U }
      const V0 = { ...s.V }
      const lenU = Math.hypot(U0.x, U0.y) || 1e-9
      const lenV = Math.hypot(V0.x, V0.y) || 1e-9
      const uHat = { x: U0.x / lenU, y: U0.y / lenU }
      const vHat = { x: V0.x / lenV, y: V0.y / lenV }
      const piv = { x: O0.x + 0.5 * U0.x + 0.5 * V0.x, y: O0.y + 0.5 * U0.y + 0.5 * V0.y }
      // anchor for scale/stretch = the opposite handle (centre when Alt)
      let anchor = piv
      if (r.type === 'scale' || r.type === 'stretch') {
        const au = 1 - r.nu
        const bv = 1 - r.nv
        anchor = { x: O0.x + au * U0.x + bv * V0.x, y: O0.y + au * U0.y + bv * V0.y }
      }
      return {
        region: r,
        O0,
        U0,
        V0,
        anchor,
        uHat,
        vHat,
        lenU,
        lenV,
        pivot: piv,
        startAngle: Math.atan2(P.y - piv.y, P.x - piv.x),
        start: P,
        pushed: false,
      }
    }

    const applyGesture = (g: Gesture, P: Vec, ev: PointerEvent) => {
      const s = sessionRef.current!
      if (!g.pushed) {
        useStore.getState().pushUndo()
        g.pushed = true
      }
      const r = g.region
      if (r.type === 'move') {
        const dx = P.x - g.start.x
        const dy = P.y - g.start.y
        s.O = { x: g.O0.x + dx, y: g.O0.y + dy }
        s.U = g.U0
        s.V = g.V0
      } else if (r.type === 'rotate') {
        let delta = Math.atan2(P.y - g.pivot.y, P.x - g.pivot.x) - g.startAngle
        if (ev.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12) // 15°
        const cos = Math.cos(delta)
        const sin = Math.sin(delta)
        const rot = (v: Vec): Vec => ({ x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos })
        s.U = rot(g.U0)
        s.V = rot(g.V0)
        const rel = { x: g.O0.x - g.pivot.x, y: g.O0.y - g.pivot.y }
        const rr = rot(rel)
        s.O = { x: g.pivot.x + rr.x, y: g.pivot.y + rr.y }
      } else {
        // scale / stretch — headus-style: scale from the CENTRE by default so the
        // island grows/shrinks in place around its middle; hold Alt to anchor the
        // opposite corner/edge instead (classic corner-pinned resize).
        const fromCentre = !ev.altKey
        const anchor = fromCentre ? g.pivot : g.anchor
        const au = fromCentre ? 0.5 : 1 - r.nu
        const bv = fromCentre ? 0.5 : 1 - r.nv
        const dPx = P.x - anchor.x
        const dPy = P.y - anchor.y
        let lU = g.lenU
        let lV = g.lenV
        const affectU = r.nu !== au
        const affectV = r.nv !== bv
        if (r.type === 'scale' && !ev.shiftKey) {
          // proportional: project pointer onto the original anchor→handle diagonal
          const hx = (r.nu - au) * g.U0.x + (r.nv - bv) * g.V0.x
          const hy = (r.nu - au) * g.U0.y + (r.nv - bv) * g.V0.y
          const f = (dPx * hx + dPy * hy) / (hx * hx + hy * hy || 1e-9)
          lU = Math.max(1e-4, f * g.lenU)
          lV = Math.max(1e-4, f * g.lenV)
        } else {
          if (affectU) lU = Math.max(1e-4, (dPx * g.uHat.x + dPy * g.uHat.y) / (r.nu - au))
          if (affectV) lV = Math.max(1e-4, (dPx * g.vHat.x + dPy * g.vHat.y) / (r.nv - bv))
        }
        const U = { x: g.uHat.x * lU, y: g.uHat.y * lU }
        const V = { x: g.vHat.x * lV, y: g.vHat.y * lV }
        s.U = U
        s.V = V
        s.O = { x: anchor.x - au * U.x - bv * V.x, y: anchor.y - au * U.y - bv * V.y }
      }
      applyToUVs()
    }

    const onDragMove = (ev: PointerEvent) => {
      const g = gestureRef.current as Gesture | null
      if (!g) return
      applyGesture(g, toWorld(ev.clientX, ev.clientY), ev)
    }
    const onUp = () => {
      const g = gestureRef.current as Gesture | null
      gestureRef.current = null
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onUp)
      if (g) {
        const obj = useStore.getState().selectedObject
        const nv = useStore.getState().uvVersion + 1
        useStore.setState({
          uvVersion: nv,
          status: obj ? `Transformed ${obj}` : 'Transformed selection',
        })
        // We caused this bump — keep it in sync so the idle rebuild doesn't fire
        // and flatten our oriented box back to an axis-aligned one. The box stays
        // rotated (like Photoshop) until the selection/target actually changes.
        lastVersionRef.current = nv
      }
    }

    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || ev.target !== el) return
      if (!sessionRef.current) rebuild()
      const P = toWorld(ev.clientX, ev.clientY)
      const r = regionAt(P)
      if (!r) return // outside → let pan / nothing happen
      ev.preventDefault()
      ev.stopPropagation()
      const g = beginGesture(r, P)
      gestureRef.current = g
      el.style.cursor = cursorFor(r)
      window.addEventListener('pointermove', onDragMove)
      window.addEventListener('pointerup', onUp)
      const hint =
        r.type === 'move'
          ? 'Moving'
          : r.type === 'rotate'
            ? 'Rotating'
            : r.type === 'scale'
              ? 'Scaling'
              : 'Stretching'
      useStore.setState({ status: `${hint} selection` })
    }

    el.addEventListener('pointermove', onHover)
    el.addEventListener('pointerleave', onLeave)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      el.removeEventListener('pointermove', onHover)
      el.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onUp)
      el.style.cursor = 'default'
      gestureRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, aspect, camera, gl, allShells, selectedObject, mapSelection])

  if (editMode !== 'transform') return null

  return (
    <group>
      <lineLoop ref={boxRef} geometry={geo.box} renderOrder={9}>
        <lineBasicMaterial color="#bcd4ff" transparent opacity={0.95} depthTest={false} />
      </lineLoop>
      <points ref={handlesRef} geometry={geo.handles} renderOrder={11}>
        <pointsMaterial
          map={sprite}
          color="#ffffff"
          size={10}
          sizeAttenuation={false}
          transparent
          depthTest={false}
        />
      </points>
    </group>
  )
}
