import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Persisted extends Rect {
  collapsed: boolean
}

function load(key: string): Partial<Persisted> | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Persisted) : null
  } catch {
    return null
  }
}
function save(key: string, p: Persisted) {
  try {
    localStorage.setItem(key, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

/** A draggable + resizable + collapsible floating panel; remembers its state. */
export default function FloatingWindow({
  title,
  children,
  actions,
  defaultRect,
  storageKey = 'uvstudio.float',
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  defaultRect?: Rect
  storageKey?: string
}) {
  const saved = load(storageKey)
  const [rect, setRect] = useState<Rect>({
    x: saved?.x ?? defaultRect?.x ?? 16,
    y: saved?.y ?? defaultRect?.y ?? 16,
    w: saved?.w ?? defaultRect?.w ?? 400,
    h: saved?.h ?? defaultRect?.h ?? 300,
  })
  const [collapsed, setCollapsed] = useState<boolean>(saved?.collapsed ?? false)
  const mode = useRef<null | 'move' | 'resize'>(null)
  const startPtr = useRef<[number, number]>([0, 0])
  const startRect = useRef<Rect>(rect)
  const latestRect = useRef(rect)
  latestRect.current = rect
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!mode.current) return
      const dx = e.clientX - startPtr.current[0]
      const dy = e.clientY - startPtr.current[1]
      const r = startRect.current
      if (mode.current === 'move') {
        setRect({ ...r, x: Math.max(0, r.x + dx), y: Math.max(0, r.y + dy) })
      } else {
        setRect({ ...r, w: Math.max(240, r.w + dx), h: Math.max(160, r.h + dy) })
      }
    }
    const onUp = () => {
      if (mode.current) save(storageKey, { ...latestRect.current, collapsed: collapsedRef.current })
      mode.current = null
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [storageKey])

  const begin = (m: 'move' | 'resize') => (e: React.PointerEvent) => {
    mode.current = m
    startPtr.current = [e.clientX, e.clientY]
    startRect.current = rect
    document.body.style.cursor = m === 'move' ? 'grabbing' : 'nwse-resize'
    e.preventDefault()
    e.stopPropagation()
  }

  const toggleCollapse = () => {
    const next = !collapsed
    setCollapsed(next)
    save(storageKey, { ...rect, collapsed: next })
  }

  return (
    <div
      className="glass absolute z-30 flex flex-col overflow-hidden rounded-xl shadow-2xl"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: collapsed ? 28 : rect.h }}
    >
      <div
        onPointerDown={begin('move')}
        className="flex h-7 shrink-0 cursor-grab items-center gap-2 border-b border-line bg-ink-850/80 px-2.5 text-[11px] font-medium uppercase tracking-wider text-fog-400 select-none active:cursor-grabbing"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" className="opacity-60">
          <circle cx="2" cy="2" r="1" />
          <circle cx="6" cy="2" r="1" />
          <circle cx="10" cy="2" r="1" />
          <circle cx="2" cy="6" r="1" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="10" cy="6" r="1" />
        </svg>
        {title}
        <span className="ml-auto flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
          {actions}
          <button
            onClick={toggleCollapse}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="flex h-5 w-5 items-center justify-center rounded text-fog-400 hover:bg-ink-600 hover:text-fog-100"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {collapsed ? <path d="M6 9l6 6 6-6" /> : <path d="M5 12h14" />}
            </svg>
          </button>
        </span>
      </div>
      {!collapsed && <div className="relative min-h-0 flex-1">{children}</div>}
      {!collapsed && (
        <div
          onPointerDown={begin('resize')}
          title="Drag to resize"
          className="absolute bottom-0 right-0 z-40 h-5 w-5 cursor-nwse-resize"
        >
          <svg viewBox="0 0 16 16" className="absolute bottom-0.5 right-0.5 text-fog-400/70" width="12" height="12">
            <path d="M14 6 L6 14 M14 11 L11 14" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}
