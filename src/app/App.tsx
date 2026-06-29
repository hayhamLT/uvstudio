import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useStore } from '../state/store'
import { live } from '../state/live'
import Viewport3D from '../viewport3d/Viewport3D'
import Viewport2D from '../viewport2d/Viewport2D'
import TopBar from '../ui/TopBar'
import MapPanel from '../ui/MapPanel'
import StatusBar from '../ui/StatusBar'
import HelpOverlay from '../ui/HelpOverlay'
import FloatingWindow from '../ui/FloatingWindow'
import ImportDialog from '../ui/ImportDialog'
import LinkWizard from '../ui/LinkWizard'
import Landing from '../ui/Landing'
import Preferences from '../ui/Preferences'
import UpdateBanner from '../ui/UpdateBanner'
import { watchIncoming, restore as restoreLink, isDesktop, refreshPluginSilently, focusWindow } from '../bridge/link'
import { loadSceneFile } from '../mesh/loadFile'
import { sceneFromSidecar } from '../bridge/roundtrip'
import { checkForUpdate, type UpdateInfo } from './updater'

export default function App() {
  const [help, setHelp] = useState(false)
  const [prefs, setPrefs] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [primary, setPrimary] = useState<'2d' | '3d'>(() => {
    try {
      return (localStorage.getItem('uvstudio.primary') as '2d' | '3d') || '2d'
    } catch {
      return '2d'
    }
  })
  const [docked, setDocked] = useState<boolean>(() => {
    try {
      return localStorage.getItem('uvstudio.docked') === '1'
    } catch {
      return false
    }
  })
  const [split, setSplitRaw] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('uvstudio.split')) || 0.6
    } catch {
      return 0.6
    }
  })
  const hasModel = useStore((s) => s.mapObjects.length > 0)
  const lastImportName = useStore((s) => s.lastImportName)
  const booted = useRef(false)

  // Opening a new file resets the orientation so the 3D view lands in the left
  // (secondary) pane — primary '2d' means the 2D map is main, 3D is secondary.
  useEffect(() => {
    if (!lastImportName) return
    setPrimary('2d')
    try {
      localStorage.setItem('uvstudio.primary', '2d')
    } catch {
      /* ignore */
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
  }, [lastImportName])

  useEffect(() => {
    if (booted.current) return
    booted.current = true
    // Start empty — the user imports a GLB to begin. Nudge R3F (react-use-measure
    // listens to window resize) so canvases size correctly on first paint.
    const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 150)
    const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  // desktop: re-attach the link folder chosen on a previous launch (set once)
  useEffect(() => {
    void restoreLink()
  }, [])

  // desktop: on launch, keep the bundled C4D plugin current in the latest C4D,
  // and check for a newer app version (prompt to download if so).
  useEffect(() => {
    if (!isDesktop()) return
    void refreshPluginSilently()
    void checkForUpdate().then((u) => {
      if (u) setUpdate(u)
    })
  }, [])

  // C4D → app: when the link folder is connected, auto-load any model the C4D
  // plugin drops into to_app/ (the round-trip "send to app" side).
  useEffect(() => {
    return watchIncoming(
      async (inc) => {
        try {
          // Lossless path: build geometry 1:1 from the forward sidecar so UVs can
          // be written straight back onto C4D's objects. Legacy/manual: parse GLB.
          const objects = inc.sidecar
            ? sceneFromSidecar(inc.sidecar)
            : await loadSceneFile(new File([inc.glb!], 'from-c4d.glb', { type: 'model/gltf-binary' }))
          // From C4D the selection IS the screens — load straight into the scene
          // (skip the screen-picker dialog) so it shows immediately.
          useStore.getState().loadScene(objects, { screenNames: objects.map((o) => o.name) })
          useStore.getState().setStatus(`Loaded ${objects.length} object(s) from Cinema 4D`)
          void focusWindow() // C4D sent geometry — bring the app forward
        } catch {
          /* ignore an unreadable payload */
        }
      },
      (ack) => {
        // C4D confirmed the returned UVs landed — close the round-trip loop.
        const plural = ack.applied === 1 ? '' : 's'
        useStore
          .getState()
          .setStatus(
            ack.missed.length
              ? `Cinema 4D applied UVs to ${ack.applied} object${plural} · skipped ${ack.missed.length}`
              : `Cinema 4D applied UVs to ${ack.applied} object${plural}`,
          )
      },
    )
  }, [])

  useKeyboardShortcuts(setHelp)

  const swap = () => {
    setPrimary((p) => {
      const next = p === '2d' ? '3d' : '2d'
      try {
        localStorage.setItem('uvstudio.primary', next)
      } catch {
        /* ignore */
      }
      return next
    })
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
  }

  useSwapKey(swap)

  const setSplit = (f: number) => {
    const v = Math.min(0.8, Math.max(0.2, f))
    setSplitRaw(v)
    try {
      localStorage.setItem('uvstudio.split', String(v))
    } catch {
      /* ignore */
    }
  }

  const setDock = (d: boolean) => {
    setDocked(d)
    try {
      localStorage.setItem('uvstudio.docked', d ? '1' : '0')
    } catch {
      /* ignore */
    }
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60)
  }

  const iconBtnCls =
    'flex h-5 w-5 items-center justify-center rounded text-fog-400 hover:bg-ink-600 hover:text-fog-100'
  const swapBtn = (
    <button onClick={swap} title="Swap the two views (Tab)" className={iconBtnCls}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 3l4 4-4 4" />
        <path d="M20 7H7a4 4 0 0 0-4 4" />
        <path d="M8 21l-4-4 4-4" />
        <path d="M4 17h13a4 4 0 0 0 4-4" />
      </svg>
    </button>
  )
  const dockBtn = (
    <button onClick={() => setDock(true)} title="Dock — snap into a split view" className={iconBtnCls}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M14 4v16" />
      </svg>
    </button>
  )
  const undockBtn = (
    <button onClick={() => setDock(false)} title="Float — pop out as a movable window" className={iconBtnCls}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        <path d="M14 4h6v6M20 4l-9 9" />
      </svg>
    </button>
  )

  return (
    <div className="flex h-full flex-col bg-ink-950 text-fog-200">
      <TopBar onHelp={() => setHelp(true)} onPrefs={() => setPrefs(true)} />
      <div className="flex min-h-0 flex-1">
        {!hasModel ? (
          <Landing />
        ) : (
          <>
        <div className="relative min-w-0 flex-1">
          {docked ? (
            <DockedSplit
              primary={primary}
              split={split}
              setSplit={setSplit}
              secondaryTitle={primary === '2d' ? '3D' : '2D map'}
              actions={
                <>
                  {swapBtn}
                  {undockBtn}
                </>
              }
            />
          ) : (
            <>
              <div className="absolute inset-0">{primary === '2d' ? <Viewport2D /> : <Viewport3D />}</div>
              <FloatingWindow
                title={primary === '2d' ? '3D' : '2D map'}
                actions={
                  <>
                    {swapBtn}
                    {dockBtn}
                  </>
                }
                defaultRect={{ x: 16, y: 16, w: 420, h: 320 }}
              >
                {primary === '2d' ? <Viewport3D /> : <Viewport2D />}
              </FloatingWindow>
            </>
          )}
        </div>
        <MapPanel />
          </>
        )}
      </div>
      <StatusBar />
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      <Preferences open={prefs} onClose={() => setPrefs(false)} />
      {update && <UpdateBanner info={update} onClose={() => setUpdate(null)} />}
      <ImportDialog />
      <LinkWizard />
    </div>
  )
}

/** Side-by-side split: primary view on the left, secondary in a docked panel on
 *  the right, with a draggable divider. The alternative to the floating window. */
function DockedSplit({
  primary,
  split,
  setSplit,
  secondaryTitle,
  actions,
}: {
  primary: '2d' | '3d'
  split: number
  setSplit: (f: number) => void
  secondaryTitle: string
  actions: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !ref.current) return
      const r = ref.current.getBoundingClientRect()
      setSplit((e.clientX - r.left) / r.width)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      window.dispatchEvent(new Event('resize')) // R3F canvases re-measure
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [setSplit])

  // keep canvases sized as the ratio changes (covers keyboard/programmatic moves)
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('resize')), 0)
    return () => clearTimeout(t)
  }, [split])

  const Main = primary === '2d' ? Viewport2D : Viewport3D
  const Secondary = primary === '2d' ? Viewport3D : Viewport2D

  return (
    <div ref={ref} className="absolute inset-0 flex">
      <div className="glass relative flex min-w-0 flex-col" style={{ width: `${split * 100}%` }}>
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-ink-850/80 px-2.5 text-[11px] font-medium uppercase tracking-wider text-fog-400 select-none">
          {secondaryTitle}
          <span className="ml-auto flex items-center gap-0.5">{actions}</span>
        </div>
        <div className="relative min-h-0 flex-1">
          <Secondary />
        </div>
      </div>
      <div
        onPointerDown={(e) => {
          dragging.current = true
          document.body.style.cursor = 'col-resize'
          e.preventDefault()
        }}
        title="Drag to resize"
        className="relative z-20 w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-brand-500"
      />
      <div className="relative min-w-0 flex-1">
        <Main />
      </div>
    </div>
  )
}

function useSwapKey(swap: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        swap()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [swap])
}

function useKeyboardShortcuts(setHelp: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      const s = useStore.getState()
      const active = s.selectedObject
      const key = e.key.toLowerCase()

      // Undo / redo (and don't let other Cmd/Ctrl combos trigger single-key tools)
      if (e.metaKey || e.ctrlKey) {
        if (key === 'z') {
          e.preventDefault()
          e.shiftKey ? s.redo() : s.undo()
        } else if (key === 'y') {
          e.preventDefault()
          s.redo()
        }
        return
      }

      switch (key) {
        case '`':
        case '0':
          s.setEditMode('none')
          break
        // 1/2/3 are context-aware: 3D view modes when hovering the 3D pane,
        // else UV edit modes (4 = object, 2D only).
        case '1':
          if (live.hoverPane === '3d') s.setView3d('shaded')
          else s.setEditMode('vertex')
          break
        case '2':
          if (live.hoverPane === '3d') s.setView3d('distortion')
          else s.setEditMode('edge')
          break
        case '3':
          if (live.hoverPane === '3d') s.setView3d('checker')
          else s.setEditMode('face')
          break
        case '4':
          if (live.hoverPane !== '3d') s.setEditMode('object')
          break
        case 't':
          // free-transform gizmo (2D UV view)
          if (live.hoverPane !== '3d') s.setEditMode('transform')
          break
        case 'm':
          if (active) s.runMappingFor(active)
          break
        case '=':
        case '+':
          if (s.mapSelection.size) s.scaleSelection(1.05)
          else if (active) s.scaleObject(active, 1.05)
          break
        case '-':
        case '_':
          if (s.mapSelection.size) s.scaleSelection(1 / 1.05)
          else if (active) s.scaleObject(active, 1 / 1.05)
          break
        case 's':
          // toggle interactive mouse-scale of the active screen (Esc/click ends it)
          if (active) s.setScaleMode(!s.scaleMode)
          break
        case 'r':
          if (active) s.rotateObject(active, e.shiftKey ? 'ccw' : 'cw')
          break
        case 'f':
          if (active) s.flipObject(active, e.shiftKey ? 'y' : 'x')
          break
        case 'x':
          if (active) s.resetObjectOrient(active)
          break
        case 'h':
          setHelp((p) => !p)
          break
        case 'escape':
          if (s.mapSelection.size) s.clearMapSelection()
          else s.setEditMode('none')
          setHelp(() => false)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setHelp])
}
