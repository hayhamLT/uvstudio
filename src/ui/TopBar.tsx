import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { importModelFile, isModelFile, openModelPicker, refreshModel } from './importMap'
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
        <div className="absolute left-0 top-10 z-50 w-52 animate-menu-pop rounded-lg border border-line bg-ink-800 p-1 shadow-2xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function MenuItem({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm text-fog-200 enabled:hover:bg-brand-500/20 enabled:hover:text-brand-400 disabled:opacity-35"
    >
      {children}
    </button>
  )
}

export default function TopBar({ onHelp, onPrefs }: { onHelp: () => void; onPrefs: () => void }) {
  const exportGltf = useStore((s) => s.exportGltf)
  const sendToC4D = useStore((s) => s.sendToC4D)
  const lastImportName = useStore((s) => s.lastImportName)
  const mappedCount = useStore((s) => s.mappedObjects.length)
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
      <div className="flex items-center gap-2 pr-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-linear-to-br from-brand-400 to-brand-600 text-ink-950 shadow-lg shadow-brand-600/30">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 3 21 8v8l-9 5-9-5V8l9-5Z" strokeLinejoin="round" />
            <path d="M3.5 8 12 13l8.5-5M12 13v8" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight text-fog-100">UV Studio</div>
          <div className="-mt-0.5 text-[10px] uppercase tracking-widest text-fog-400/70">screen map</div>
        </div>
      </div>

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
        {(close) => (
          <>
            <MenuItem disabled={!mappedCount} onClick={() => { close(); exportGltf() }}>GLB</MenuItem>
            <MenuItem disabled={!mappedCount} onClick={() => { close(); sendToC4D() }}>Send to Cinema 4D</MenuItem>
          </>
        )}
      </Menu>

      <button
        onClick={() => refreshModel(modelRef.current)}
        disabled={!lastImportName}
        title={lastImportName ? `Refresh “${lastImportName}” from disk` : 'Refresh model (import one first)'}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-fog-200 enabled:hover:bg-ink-700/70 disabled:opacity-35 ring-focus"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        Refresh
      </button>

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
