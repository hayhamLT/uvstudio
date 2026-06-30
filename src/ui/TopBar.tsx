import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { importModelFile, isModelFile, openModelPicker } from './importMap'
import { IconUpload, IconExport, IconHelp } from './icons'

function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Close on click/escape outside the menu (robust, no focus/blur races).
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fog-200 hover:bg-ink-700/70 ring-focus"
      >
        {icon} {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="opacity-60">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-64 animate-menu-pop rounded-lg border border-line bg-ink-800 p-1 shadow-2xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}


export default function TopBar({ onHelp, onPrefs }: { onHelp: () => void; onPrefs: () => void }) {
  const exportGltf = useStore((s) => s.exportGltf)
  const sendToC4D = useStore((s) => s.sendToC4D)
  const fromC4D = useStore((s) => s.mapObjects.some((o) => !!o.c4dGuid))
  const mappedCount = useStore((s) => s.mappedObjects.length)
  const runMapping = useStore((s) => s.runMapping)
  const screenCount = useStore((s) => s.mapObjects.length)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const undoCount = useStore((s) => s.undoCount)
  const redoCount = useStore((s) => s.redoCount)

  const modelRef = useRef<HTMLInputElement>(null)

  const onModel = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const model = files.find(isModelFile)
    // import the model + any media (PSD/images) picked with it → link wizard
    if (model) await importModelFile(model, null, files.filter((f) => f !== model && !isModelFile(f)))
    e.target.value = ''
  }

  return (
    <header className="relative z-50 flex h-12 items-center gap-2 border-b border-line bg-ink-900/80 px-3 backdrop-blur">
      <button
        onClick={() => runMapping()}
        disabled={!screenCount}
        title="Auto-map every screen to fit its content"
        className="flex items-center gap-1.5 rounded-md bg-brand-500/90 px-3 py-1.5 text-sm font-semibold text-ink-950 hover:bg-brand-400 disabled:cursor-default disabled:opacity-35 ring-focus"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        Auto-map ALL
      </button>

      <div className="mx-1 h-6 w-px bg-line" />

      <button
        onClick={() => openModelPicker(modelRef.current)}
        title="Import a model with its screen maps — opens the link wizard"
        className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-fog-200 hover:bg-ink-700/70 ring-focus"
      >
        <IconUpload width={16} height={16} /> Import
      </button>
      <input ref={modelRef} type="file" accept=".glb,.gltf,.psd,image/*" multiple className="hidden" onChange={onModel} />

      <Menu label="Export" icon={<IconExport width={16} height={16} />}>
        {(close) => {
          const ready = mappedCount > 0
          const action = fromC4D ? sendToC4D : exportGltf
          const title = fromC4D ? 'Send to Cinema 4D' : 'Export GLB'
          const desc = !ready
            ? 'Map a screen first'
            : fromC4D
              ? 'Apply the mapped UVs back to your C4D scene'
              : 'Download the model + UVs (.glb + LED sizes)'
          // Source-aware: a C4D scene rounds-trips back; a file import exports a GLB.
          const icon = fromC4D ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" />
              <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
            </svg>
          ) : (
            <IconExport width={17} height={17} />
          )
          return (
            <button
              onClick={() => { if (ready) { close(); action() } }}
              disabled={!ready}
              className="group/exp flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition enabled:hover:bg-brand-500/15 disabled:opacity-45 ring-focus"
            >
              <span className="mt-0.5 text-brand-400 transition-transform group-enabled/exp:group-hover/exp:scale-110">
                {icon}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium text-fog-100">{title}</span>
                <span className="text-[11px] leading-snug text-fog-400">{desc}</span>
              </span>
            </button>
          )
        }}
      </Menu>

      <div className="mx-1 h-6 w-px bg-line" />
      <button
        onClick={undo}
        disabled={!undoCount}
        title="Undo (⌘/Ctrl+Z)"
        className="flex h-8 w-8 items-center justify-center rounded-md text-fog-300 enabled:hover:bg-ink-700/70 enabled:hover:text-fog-100 disabled:opacity-30 ring-focus"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
        </svg>
      </button>
      <button
        onClick={redo}
        disabled={!redoCount}
        title="Redo (⌘/Ctrl+Shift+Z)"
        className="flex h-8 w-8 items-center justify-center rounded-md text-fog-300 enabled:hover:bg-ink-700/70 enabled:hover:text-fog-100 disabled:opacity-30 ring-focus"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9a5 5 0 0 0 0 10h1" />
        </svg>
      </button>

      <div className="flex-1" />

      <button
        onClick={onPrefs}
        className="flex h-8 w-8 items-center justify-center rounded-md text-fog-300 hover:bg-ink-700/70 hover:text-fog-100 ring-focus"
        title="Preferences — Cinema 4D setup & defaults"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>

      <button
        onClick={onHelp}
        className="flex h-8 w-8 items-center justify-center rounded-md text-fog-300 hover:bg-ink-700/70 hover:text-fog-100 ring-focus"
        title="Shortcuts (H)"
      >
        <IconHelp width={18} height={18} />
      </button>
    </header>
  )
}
