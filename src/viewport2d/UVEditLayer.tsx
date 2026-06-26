import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useStore } from '../state/store'
import { live } from '../state/live'

// ---------------------------------------------------------------------------
// UV component editing for Screen Map mode, with high-contrast overlays:
//  - Vertices: big dots with a dark outline ring (visible on any background).
//  - Selected: bright yellow, larger.
//  - Edge/Face: bright guide lines, selected lit; selected verts shown as dots.
//  - Object: bright outline + translucent fill on the active screen.
// ---------------------------------------------------------------------------

const key = (shellId: number, v: number) => `${shellId}:${v}`

/** A round point sprite: white core + black ring → tints to any colour but
 *  keeps a dark outline, so it's visible over light OR dark backgrounds. */
function makePointSprite(): THREE.Texture {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')!
  const cx = s / 2
  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.arc(cx, cx, s * 0.46, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cx, s * 0.34, 0, Math.PI * 2)
  ctx.fill()
  const tex = new THREE.CanvasTexture(cv)
  tex.needsUpdate = true
  return tex
}

export default function UVEditLayer({ aspect }: { aspect: number }) {
  const editMode = useStore((s) => s.editMode)
  const allShells = useStore((s) => s.mapShells)
  const layeredMode = useStore((s) => s.layeredMode)
  const selectedObject = useStore((s) => s.selectedObject)
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scaleMode = useStore((s) => s.scaleMode)
  const sprite = useMemo(makePointSprite, [])

  const mapShells = useMemo(
    () => (layeredMode ? allShells.filter((ms) => ms.objName === selectedObject) : allShells),
    [allShells, layeredMode, selectedObject],
  )

  const topo = useMemo(() => {
    const verts: { shellId: number; v: number }[] = []
    const seamEdges: { shellId: number; a: number; b: number }[] = []
    const creaseEdges: { shellId: number; a: number; b: number }[] = []
    // a "face" is an original polygon: the group of triangles merged across
    // their coplanar diagonals (so a quad is one face, not two triangles)
    const faces: { shellId: number; tris: [number, number, number][]; verts: number[] }[] = []
    const shellObj = new Map<number, string>()
    const objKeys = new Map<string, string[]>()
    for (const ms of mapShells) {
      shellObj.set(ms.id, ms.objName)
      const ok = objKeys.get(ms.objName) ?? []
      for (let v = 0; v < ms.shell.vertCount; v++) {
        verts.push({ shellId: ms.id, v })
        ok.push(key(ms.id, v))
      }
      objKeys.set(ms.objName, ok)
      // Classify edges from the TRIANGLES and group triangles into polygons.
      // A boundary edge (one triangle) is a UV seam; an interior edge between two
      // COPLANAR triangles is a triangulation diagonal (hidden — and it MERGES the
      // two triangles into one polygon); an interior edge with a real dihedral
      // angle is a crease (shown thin, a real polygon boundary).
      const tris = ms.shell.triangles
      const P = ms.shell.positions
      const triNormal = (i0: number, i1: number, i2: number): [number, number, number] => {
        const ax = P[i1 * 3] - P[i0 * 3],
          ay = P[i1 * 3 + 1] - P[i0 * 3 + 1],
          az = P[i1 * 3 + 2] - P[i0 * 3 + 2]
        const bx = P[i2 * 3] - P[i0 * 3],
          by = P[i2 * 3 + 1] - P[i0 * 3 + 1],
          bz = P[i2 * 3 + 2] - P[i0 * 3 + 2]
        const nx = ay * bz - az * by,
          ny = az * bx - ax * bz,
          nz = ax * by - ay * bx
        const l = Math.hypot(nx, ny, nz) || 1
        return [nx / l, ny / l, nz / l]
      }
      const em = new Map<number, { a: number; b: number; n: [number, number, number][]; t: number[] }>()
      for (let t = 0; t < tris.length; t += 3) {
        const ti = t / 3
        const i0 = tris[t],
          i1 = tris[t + 1],
          i2 = tris[t + 2]
        const n = triNormal(i0, i1, i2)
        const pairs: [number, number][] = [
          [i0, i1],
          [i1, i2],
          [i2, i0],
        ]
        for (const [a, b] of pairs) {
          const lo = Math.min(a, b),
            hi = Math.max(a, b)
          const ek = lo * 100000 + hi
          let e = em.get(ek)
          if (!e) {
            e = { a: lo, b: hi, n: [], t: [] }
            em.set(ek, e)
          }
          e.n.push(n)
          e.t.push(ti)
        }
      }
      const triCount = tris.length / 3
      const parent = new Int32Array(triCount)
      for (let i = 0; i < triCount; i++) parent[i] = i
      const find = (x: number): number => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]]
          x = parent[x]
        }
        return x
      }
      // Each triangle's LONGEST edge is its triangulation diagonal (the
      // hypotenuse). Only that edge — coplanar and longest in BOTH triangles —
      // is hidden and merges the pair into a quad; a quad's actual sides (shorter
      // edges between adjacent quads) stay visible as thin edges.
      const len3 = (a: number, b: number) =>
        (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2
      const triLong = new Array<number>(triCount)
      for (let t = 0; t < triCount; t++) {
        const i0 = tris[t * 3],
          i1 = tris[t * 3 + 1],
          i2 = tris[t * 3 + 2]
        const e01 = len3(i0, i1),
          e12 = len3(i1, i2),
          e20 = len3(i2, i0)
        let pa = i0,
          pb = i1,
          mx = e01
        if (e12 > mx) {
          mx = e12
          pa = i1
          pb = i2
        }
        if (e20 > mx) {
          pa = i2
          pb = i0
        }
        triLong[t] = Math.min(pa, pb) * 100000 + Math.max(pa, pb)
      }
      for (const e of em.values()) {
        const ekey = e.a * 100000 + e.b
        if (e.n.length === 1) {
          seamEdges.push({ shellId: ms.id, a: e.a, b: e.b })
          continue
        }
        if (e.n.length !== 2) continue
        const d = e.n[0][0] * e.n[1][0] + e.n[0][1] * e.n[1][1] + e.n[0][2] * e.n[1][2]
        const coplanar = Math.abs(d) >= 0.9995
        const isDiagonal = coplanar && triLong[e.t[0]] === ekey && triLong[e.t[1]] === ekey
        if (isDiagonal) parent[find(e.t[0])] = find(e.t[1]) // merge the quad's two triangles
        else creaseEdges.push({ shellId: ms.id, a: e.a, b: e.b }) // quad side or crease — show thin
      }
      const groups = new Map<number, { tris: [number, number, number][]; verts: Set<number> }>()
      for (let ti = 0; ti < triCount; ti++) {
        const r = find(ti)
        let g = groups.get(r)
        if (!g) {
          g = { tris: [], verts: new Set() }
          groups.set(r, g)
        }
        const a = tris[ti * 3],
          b = tris[ti * 3 + 1],
          c = tris[ti * 3 + 2]
        g.tris.push([a, b, c])
        g.verts.add(a).add(b).add(c)
      }
      for (const g of groups.values()) faces.push({ shellId: ms.id, tris: g.tris, verts: [...g.verts] })
    }
    const objList = [...objKeys.entries()].map(([name, keys]) => ({ name, keys }))

    const attr = (n: number, comps = 3) => new THREE.BufferAttribute(new Float32Array(n * comps), comps)
    const pointsGeo = new THREE.BufferGeometry()
    pointsGeo.setAttribute('position', attr(verts.length))
    const selGeo = new THREE.BufferGeometry()
    selGeo.setAttribute('position', attr(verts.length))
    // edges as fat lines (LineSegments2) — seams thicker, creases thinner
    const mkLines = (count: number, width: number) => {
      const pos = new Float32Array(Math.max(1, count) * 6)
      const col = new Float32Array(Math.max(1, count) * 6)
      const geo = new LineSegmentsGeometry()
      geo.setPositions(pos)
      geo.setColors(col)
      const mat = new LineMaterial({ linewidth: width, vertexColors: true, transparent: true, depthTest: false })
      const lines = new LineSegments2(geo, mat)
      lines.frustumCulled = false
      lines.renderOrder = 5
      return { pos, col, geo, mat, lines }
    }
    const seam = mkLines(seamEdges.length, 2.8)
    const crease = mkLines(creaseEdges.length, 1.2)

    const objGeo = new THREE.BufferGeometry()
    objGeo.setAttribute('position', attr(objList.length * 8))
    objGeo.setAttribute('color', attr(objList.length * 8))
    const fillGeo = new THREE.BufferGeometry()
    fillGeo.setAttribute('position', attr(6))
    // selected-face highlight (face mode): fill for the selected polygons
    const faceTris = faces.reduce((a, f) => a + f.tris.length, 0)
    const faceFillGeo = new THREE.BufferGeometry()
    faceFillGeo.setAttribute('position', attr(Math.max(1, faceTris) * 3))

    return {
      verts,
      edges: [...seamEdges, ...creaseEdges],
      seamEdges,
      creaseEdges,
      faces,
      shellObj,
      objKeys,
      objList,
      pointsGeo,
      selGeo,
      seam,
      crease,
      objGeo,
      fillGeo,
      faceFillGeo,
    }
  }, [mapShells])

  useEffect(
    () => () => {
      topo.pointsGeo.dispose()
      topo.selGeo.dispose()
      topo.seam.geo.dispose()
      topo.seam.mat.dispose()
      topo.crease.geo.dispose()
      topo.crease.mat.dispose()
      topo.objGeo.dispose()
      topo.fillGeo.dispose()
      topo.faceFillGeo.dispose()
    },
    [topo],
  )

  const worldOf = (shellId: number, v: number): [number, number] | null => {
    const uv = live.uv.get(shellId)
    if (!uv) return null
    return [uv[v * 2] * aspect, uv[v * 2 + 1]]
  }

  // ---- pointer interaction ----
  const drag = useRef<null | 'move' | 'marquee'>(null)
  const moved = useRef(false)
  const last = useRef<[number, number]>([0, 0])
  const start = useRef<[number, number]>([0, 0])
  const [marquee, setMarquee] = useState<null | [number, number, number, number]>(null)
  const pxThreshold = () => 11 / (camera.zoom || 1)

  const pickVertex = (wx: number, wy: number) => {
    const t = pxThreshold()
    let best: { shellId: number; v: number } | null = null
    let bestD = t * t
    for (const vt of topo.verts) {
      const w = worldOf(vt.shellId, vt.v)
      if (!w) continue
      const d = (w[0] - wx) ** 2 + (w[1] - wy) ** 2
      if (d < bestD) {
        bestD = d
        best = vt
      }
    }
    return best
  }
  const pickEdge = (wx: number, wy: number) => {
    const t = pxThreshold()
    let best: { shellId: number; a: number; b: number } | null = null
    let bestD = t * t
    for (const e of topo.edges) {
      const A = worldOf(e.shellId, e.a)
      const B = worldOf(e.shellId, e.b)
      if (!A || !B) continue
      const dx = B[0] - A[0],
        dy = B[1] - A[1]
      const len2 = dx * dx + dy * dy || 1e-9
      let s = ((wx - A[0]) * dx + (wy - A[1]) * dy) / len2
      s = Math.max(0, Math.min(1, s))
      const px = A[0] + s * dx,
        py = A[1] + s * dy
      const d = (px - wx) ** 2 + (py - wy) ** 2
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }
  const pointInTri = (
    px: number,
    py: number,
    A: [number, number],
    B: [number, number],
    C: [number, number],
  ) => {
    const d1 = (px - B[0]) * (A[1] - B[1]) - (A[0] - B[0]) * (py - B[1])
    const d2 = (px - C[0]) * (B[1] - C[1]) - (B[0] - C[0]) * (py - C[1])
    const d3 = (px - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (py - A[1])
    const neg = d1 < 0 || d2 < 0 || d3 < 0
    const pos = d1 > 0 || d2 > 0 || d3 > 0
    return !(neg && pos)
  }
  // pick the POLYGON (merged coplanar triangles) under the cursor, not a triangle
  const pickFace = (wx: number, wy: number) => {
    for (const f of topo.faces) {
      for (const [a, b, c] of f.tris) {
        const A = worldOf(f.shellId, a),
          B = worldOf(f.shellId, b),
          C = worldOf(f.shellId, c)
        if (A && B && C && pointInTri(wx, wy, A, B, C)) return f
      }
    }
    return null
  }

  const componentKeys = (wx: number, wy: number): string[] | null => {
    if (editMode === 'object') {
      const f = pickFace(wx, wy)
      const obj = f ? topo.shellObj.get(f.shellId) : null
      return obj ? topo.objKeys.get(obj) ?? null : null
    }
    if (editMode === 'vertex') {
      const v = pickVertex(wx, wy)
      return v ? [key(v.shellId, v.v)] : null
    }
    if (editMode === 'edge') {
      const e = pickEdge(wx, wy)
      return e ? [key(e.shellId, e.a), key(e.shellId, e.b)] : null
    }
    if (editMode === 'face') {
      const f = pickFace(wx, wy)
      return f ? f.verts.map((v) => key(f.shellId, v)) : null
    }
    return null
  }

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || editMode === 'none') return
    e.stopPropagation()
    const wx = e.point.x,
      wy = e.point.y
    const shift = e.shiftKey
    const hit = componentKeys(wx, wy)
    const cur = useStore.getState().mapSelection
    if (hit) {
      if (editMode === 'object') {
        const owner = topo.shellObj.get(Number(hit[0].split(':')[0]))
        if (owner) useStore.getState().selectObject(owner)
      }
      let next: Set<string>
      const allSelected = hit.every((k) => cur.has(k))
      if (shift) {
        next = new Set(cur)
        if (allSelected) hit.forEach((k) => next.delete(k))
        else hit.forEach((k) => next.add(k))
      } else {
        next = allSelected ? new Set(cur) : new Set(hit)
      }
      useStore.getState().setMapSelection(next)
      // Chunk screens now sit ON their slice in UV space, so dragging the object
      // slides the slice across the PSD (re-target) — a genuine UV edit.
      drag.current = 'move'
      moved.current = false
      last.current = [wx, wy]
    } else {
      if (!shift) useStore.getState().clearMapSelection()
      drag.current = 'marquee'
      start.current = [wx, wy]
      setMarquee([wx, wy, wx, wy])
    }
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    const wx = e.point.x,
      wy = e.point.y
    if (drag.current === 'move') {
      if (!moved.current) {
        useStore.getState().pushUndo()
        moved.current = true
      }
      const du = (wx - last.current[0]) / aspect
      const dv = wy - last.current[1]
      last.current = [wx, wy]
      const sel = useStore.getState().mapSelection
      for (const k of sel) {
        const [sid, vs] = k.split(':')
        const uv = live.uv.get(Number(sid))
        if (!uv) continue
        const vi = Number(vs)
        uv[vi * 2] += du
        uv[vi * 2 + 1] += dv
      }
      live.dirty = true
      // the 2D coverage marker (and RES readout) are memoised on uvVersion — bump
      // it so the yellow box physically follows the drag in the 2D view.
      useStore.setState({ uvVersion: useStore.getState().uvVersion + 1 })
    } else if (drag.current === 'marquee') {
      setMarquee([start.current[0], start.current[1], wx, wy])
    }
  }

  const finishMarquee = (shift: boolean) => {
    if (!marquee) return
    const [x0, y0, x1, y1] = marquee
    const minX = Math.min(x0, x1),
      maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1),
      maxY = Math.max(y0, y1)
    const inBox = (w: [number, number]) =>
      w[0] >= minX && w[0] <= maxX && w[1] >= minY && w[1] <= maxY
    const next = shift ? new Set(useStore.getState().mapSelection) : new Set<string>()
    if (editMode === 'object') {
      for (const { keys } of topo.objList) {
        const all = keys.every((k) => {
          const [sid, v] = k.split(':')
          const w = worldOf(Number(sid), Number(v))
          return w && inBox(w)
        })
        if (all) keys.forEach((k) => next.add(k))
      }
    } else if (editMode === 'vertex') {
      for (const vt of topo.verts) {
        const w = worldOf(vt.shellId, vt.v)
        if (w && inBox(w)) next.add(key(vt.shellId, vt.v))
      }
    } else if (editMode === 'edge' || editMode === 'face') {
      for (const e of topo.edges) {
        const A = worldOf(e.shellId, e.a),
          B = worldOf(e.shellId, e.b)
        if (A && B && inBox(A) && inBox(B)) {
          next.add(key(e.shellId, e.a))
          next.add(key(e.shellId, e.b))
        }
      }
    }
    useStore.getState().setMapSelection(next)
  }

  useEffect(() => {
    const up = (ev: PointerEvent) => {
      if (drag.current === 'marquee') finishMarquee(ev.shiftKey)
      drag.current = null
      setMarquee(null)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marquee, editMode, aspect, topo])

  // ---- interactive mouse-scale (press S, move mouse, click to set, Esc cancels) ----
  useEffect(() => {
    if (!scaleMode) return
    const objName = useStore.getState().selectedObject
    if (!objName) {
      useStore.getState().setScaleMode(false)
      return
    }
    // capture the active screen's shells + their original UVs and centre
    const ids = allShells.filter((ms) => ms.objName === objName).map((ms) => ms.id)
    const orig = new Map<number, Float32Array>()
    let mnx = Infinity,
      mxx = -Infinity,
      mny = Infinity,
      mxy = -Infinity
    for (const id of ids) {
      const uv = live.uv.get(id)
      if (!uv) continue
      orig.set(id, uv.slice())
      for (let i = 0; i < uv.length; i += 2) {
        if (uv[i] < mnx) mnx = uv[i]
        if (uv[i] > mxx) mxx = uv[i]
        if (uv[i + 1] < mny) mny = uv[i + 1]
        if (uv[i + 1] > mxy) mxy = uv[i + 1]
      }
    }
    if (!orig.size || !isFinite(mnx)) {
      useStore.getState().setScaleMode(false)
      return
    }
    const cu = (mnx + mxx) / 2
    const cv = (mny + mxy) / 2
    const cwx = cu * aspect // island centre in world/display space
    const cwy = cv
    const rect = gl.domElement.getBoundingClientRect()
    const toWorld = (clientX: number, clientY: number): [number, number] => {
      const ndcx = ((clientX - rect.left) / rect.width) * 2 - 1
      const ndcy = -(((clientY - rect.top) / rect.height) * 2 - 1)
      const v = new THREE.Vector3(ndcx, ndcy, 0).unproject(camera)
      return [v.x, v.y]
    }
    let startDist = 0
    const apply = (factor: number) => {
      for (const [id, o] of orig) {
        const uv = live.uv.get(id)
        if (!uv) continue
        for (let i = 0; i < o.length; i += 2) {
          uv[i] = cu + (o[i] - cu) * factor
          uv[i + 1] = cv + (o[i + 1] - cv) * factor
        }
      }
      live.dirty = true
      useStore.setState({ uvVersion: useStore.getState().uvVersion + 1 })
    }
    const onMoveWin = (ev: PointerEvent) => {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY)
      const d = Math.hypot(wx - cwx, wy - cwy)
      if (startDist === 0) {
        startDist = d || 1e-6
        useStore.getState().pushUndo() // one undo step for the whole gesture
        return
      }
      apply(Math.max(0.02, d / startDist))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMoveWin)
      window.removeEventListener('pointerdown', onDownWin, true)
      window.removeEventListener('keydown', onKey, true)
    }
    const commit = () => {
      cleanup()
      useStore.getState().setScaleMode(false)
      useStore.setState({ status: `Scaled ${objName}` })
    }
    const cancel = () => {
      for (const [id, o] of orig) live.uv.get(id)?.set(o)
      live.dirty = true
      useStore.setState({ uvVersion: useStore.getState().uvVersion + 1 })
      cleanup()
      useStore.getState().setScaleMode(false)
    }
    const onDownWin = (ev: PointerEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      ev.button === 2 ? cancel() : commit()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopImmediatePropagation()
        cancel()
      } else if (ev.key === 'Enter') {
        ev.preventDefault()
        ev.stopImmediatePropagation()
        commit()
      }
    }
    window.addEventListener('pointermove', onMoveWin)
    window.addEventListener('pointerdown', onDownWin, true)
    window.addEventListener('keydown', onKey, true)
    useStore.setState({ status: `Scaling ${objName} — move mouse, click to set, Esc to cancel` })
    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleMode, aspect, allShells, camera, gl])

  // ---- per-frame overlay rendering ----
  const cVert = new THREE.Color('#5cc8ff')
  const cEdge = new THREE.Color('#9fe0ff')
  const cSeam = new THREE.Color('#ff7a3c')
  const cSel = new THREE.Color('#ffffff') // selected vertices / edges — high contrast
  const cObj = new THREE.Color('#8fd6ff')
  useFrame(() => {
    const sel = useStore.getState().mapSelection
    const active = useStore.getState().selectedObject

    // all-vertex dots (vertex mode only)
    if (editMode === 'vertex') {
      const pa = topo.pointsGeo.getAttribute('position').array as Float32Array
      topo.verts.forEach((vt, i) => {
        const w = worldOf(vt.shellId, vt.v)
        if (!w) {
          pa[i * 3] = -9999
          return
        }
        pa[i * 3] = w[0]
        pa[i * 3 + 1] = w[1]
        pa[i * 3 + 2] = 0.2
      })
      topo.pointsGeo.getAttribute('position').needsUpdate = true
    }

    // selected vertices as big dots (vertex / edge / face modes)
    if (editMode === 'vertex' || editMode === 'edge' || editMode === 'face') {
      const sa = topo.selGeo.getAttribute('position').array as Float32Array
      let n = 0
      for (const k of sel) {
        const [sid, v] = k.split(':')
        const w = worldOf(Number(sid), Number(v))
        if (!w) continue
        sa[n * 3] = w[0]
        sa[n * 3 + 1] = w[1]
        sa[n * 3 + 2] = 0.3
        n++
      }
      topo.selGeo.setDrawRange(0, n)
      topo.selGeo.getAttribute('position').needsUpdate = true
    }

    // edge guides (fat lines) — seams (boundary) and creases, drawn separately
    if (editMode === 'edge' || editMode === 'face') {
      const drawEdges = (
        list: { shellId: number; a: number; b: number }[],
        set: { pos: Float32Array; col: Float32Array; geo: LineSegmentsGeometry; mat: LineMaterial },
        base: THREE.Color,
      ) => {
        if (!list.length) return
        const pa = set.pos
        const ca = set.col
        list.forEach((e, i) => {
          const A = worldOf(e.shellId, e.a),
            B = worldOf(e.shellId, e.b)
          const o = i * 6
          if (!A || !B) {
            pa[o] = pa[o + 3] = -9999
            return
          }
          pa[o] = A[0]
          pa[o + 1] = A[1]
          pa[o + 2] = 0.12
          pa[o + 3] = B[0]
          pa[o + 4] = B[1]
          pa[o + 5] = 0.12
          const lit = sel.has(key(e.shellId, e.a)) && sel.has(key(e.shellId, e.b))
          const c = lit ? cSel : base
          for (let k = 0; k < 2; k++) {
            ca[o + k * 3] = c.r
            ca[o + k * 3 + 1] = c.g
            ca[o + k * 3 + 2] = c.b
          }
        })
        set.geo.setPositions(pa)
        set.geo.setColors(ca)
        set.mat.resolution.set(size.width, size.height)
      }
      drawEdges(topo.seamEdges, topo.seam, cSeam)
      drawEdges(topo.creaseEdges, topo.crease, cEdge)
    }

    // selected-face fills (face mode) — a polygon is selected when all its
    // corners are in the selection (pickFace selects exactly a face's corners)
    if (editMode === 'face') {
      const fa = topo.faceFillGeo.getAttribute('position').array as Float32Array
      let n = 0
      for (const f of topo.faces) {
        if (!f.verts.every((v) => sel.has(key(f.shellId, v)))) continue
        for (const [a, b, c] of f.tris) {
          const A = worldOf(f.shellId, a),
            B = worldOf(f.shellId, b),
            C = worldOf(f.shellId, c)
          if (!A || !B || !C) continue
          fa[n * 3] = A[0]
          fa[n * 3 + 1] = A[1]
          fa[n * 3 + 2] = 0.15
          fa[n * 3 + 3] = B[0]
          fa[n * 3 + 4] = B[1]
          fa[n * 3 + 5] = 0.15
          fa[n * 3 + 6] = C[0]
          fa[n * 3 + 7] = C[1]
          fa[n * 3 + 8] = 0.15
          n += 3
        }
      }
      topo.faceFillGeo.setDrawRange(0, n)
      topo.faceFillGeo.getAttribute('position').needsUpdate = true
    }

    // object outlines + active fill — atlas mode only. In screen-mapping
    // (layered) mode the MapView2D slice marker is the single source of truth;
    // this layer draws at RAW uv coords which sit full-screen / off-canvas for
    // tiled or panorama-filling UVs, so we skip it entirely.
    if (editMode === 'object' && !layeredMode) {
      const pa = topo.objGeo.getAttribute('position').array as Float32Array
      const ca = topo.objGeo.getAttribute('color').array as Float32Array
      const fa = topo.fillGeo.getAttribute('position').array as Float32Array
      let activeBox: [number, number, number, number] | null = null
      topo.objList.forEach((obj, i) => {
        let mnx = Infinity,
          mxx = -Infinity,
          mny = Infinity,
          mxy = -Infinity
        for (const k of obj.keys) {
          const [sid, v] = k.split(':')
          const w = worldOf(Number(sid), Number(v))
          if (!w) continue
          if (w[0] < mnx) mnx = w[0]
          if (w[0] > mxx) mxx = w[0]
          if (w[1] < mny) mny = w[1]
          if (w[1] > mxy) mxy = w[1]
        }
        const valid = Number.isFinite(mnx)
        if (!valid) mnx = mxx = mny = mxy = 0 // not yet mapped → degenerate, no NaN
        const corners = [
          [mnx, mny],
          [mxx, mny],
          [mxx, mny],
          [mxx, mxy],
          [mxx, mxy],
          [mnx, mxy],
          [mnx, mxy],
          [mnx, mny],
        ]
        const base = i * 24
        const isActive = active === obj.name
        const c = isActive ? cSel : cObj
        corners.forEach((p, k) => {
          pa[base + k * 3] = p[0]
          pa[base + k * 3 + 1] = p[1]
          pa[base + k * 3 + 2] = 0.25
          ca[base + k * 3] = c.r
          ca[base + k * 3 + 1] = c.g
          ca[base + k * 3 + 2] = c.b
        })
        if (isActive && valid) activeBox = [mnx, mny, mxx, mxy]
      })
      topo.objGeo.getAttribute('position').needsUpdate = true
      topo.objGeo.getAttribute('color').needsUpdate = true
      const ab = activeBox as [number, number, number, number] | null
      if (ab) {
        const [mnx, mny, mxx, mxy] = ab
        // two triangles covering the active object's bounding box
        const pts = [
          [mnx, mny],
          [mxx, mny],
          [mxx, mxy],
          [mnx, mny],
          [mxx, mxy],
          [mnx, mxy],
        ]
        pts.forEach((p, k) => {
          fa[k * 3] = p[0]
          fa[k * 3 + 1] = p[1]
          fa[k * 3 + 2] = 0.1
        })
        topo.fillGeo.setDrawRange(0, 6)
      } else {
        topo.fillGeo.setDrawRange(0, 0)
      }
      topo.fillGeo.getAttribute('position').needsUpdate = true
    }
  })

  // 'transform' is owned by the FreeTransform gizmo — stay out of its way.
  if (editMode === 'none' || editMode === 'transform') return null
  // vertex dots belong to vertex mode only — edge mode shows edges, face mode
  // shows face fills (C4D-style: each mode isolates its component)
  const showSelDots = editMode === 'vertex'

  return (
    <group>
      <mesh position={[0, 0, 0.5]} onPointerDown={onDown} onPointerMove={onMove}>
        <planeGeometry args={[10000, 10000]} />
        <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
      </mesh>

      {(editMode === 'edge' || editMode === 'face') && (
        <>
          {topo.creaseEdges.length > 0 && <primitive object={topo.crease.lines} />}
          {topo.seamEdges.length > 0 && <primitive object={topo.seam.lines} />}
        </>
      )}
      {editMode === 'face' && (
        <mesh geometry={topo.faceFillGeo} renderOrder={4}>
          <meshBasicMaterial color="#ffe14d" transparent opacity={0.32} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {editMode === 'object' && !layeredMode && (
        <>
          <mesh geometry={topo.fillGeo} renderOrder={4}>
            <meshBasicMaterial color="#ffe14d" transparent opacity={0.18} depthTest={false} side={THREE.DoubleSide} />
          </mesh>
          <lineSegments geometry={topo.objGeo} renderOrder={5}>
            <lineBasicMaterial vertexColors transparent opacity={0.98} depthTest={false} />
          </lineSegments>
        </>
      )}
      {editMode === 'vertex' && (
        <points geometry={topo.pointsGeo} renderOrder={6}>
          <pointsMaterial map={sprite} color="#5cc8ff" size={7} sizeAttenuation={false} transparent alphaTest={0.5} depthTest={false} />
        </points>
      )}
      {showSelDots && (
        <points geometry={topo.selGeo} renderOrder={7}>
          <pointsMaterial map={sprite} color="#ffffff" size={12} sizeAttenuation={false} transparent alphaTest={0.5} depthTest={false} />
        </points>
      )}

      {marquee && <Marquee box={marquee} />}
    </group>
  )
}

function Marquee({ box }: { box: [number, number, number, number] }) {
  const [x0, y0, x1, y1] = box
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  const arr = geo.getAttribute('position').array as Float32Array
  const pts = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
  pts.forEach((p, i) => {
    arr[i * 3] = p[0]
    arr[i * 3 + 1] = p[1]
    arr[i * 3 + 2] = 0.4
  })
  geo.getAttribute('position').needsUpdate = true
  return (
    <lineLoop geometry={geo} renderOrder={8}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.95} depthTest={false} />
    </lineLoop>
  )
}
