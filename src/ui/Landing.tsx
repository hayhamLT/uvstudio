import { useRef, type ChangeEvent } from 'react'
import { handleViewportDrop, importModelFile, isModelFile, openModelPicker } from './importMap'
import { useFileDrop } from './useFileDrop'
import { openExternal } from '../bridge/link'

export default function Landing({
  onHelp,
  onPrefs,
}: {
  onHelp: () => void
  onPrefs: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { dragging, ref: dropRef } = useFileDrop(handleViewportDrop)

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const model = files.find(isModelFile)
    if (model) await importModelFile(model, null, files.filter((f) => f !== model && !isModelFile(f)))
    e.target.value = ''
  }

  const iconBtn =
    'flex h-9 w-9 items-center justify-center rounded-xl text-fog-400 transition hover:bg-ink-700/60 hover:text-fog-100 active:scale-95 ring-focus'

  return (
    <div
      ref={dropRef}
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-ink-950"
    >
      {/* import orb */}
      <button
        onClick={() => openModelPicker(inputRef.current)}
        aria-label="Import model"
        className="group/orb flex items-center justify-center rounded-full p-4 outline-none"
      >
        <span className="relative flex h-24 w-24 items-center justify-center transition-transform duration-500 ease-out group-hover/orb:scale-105 group-active/orb:scale-95">
          {/* organic expanding "ripple" lines (staggered, continuous) */}
          <span className="absolute inset-0 rounded-full border border-brand-500/40 animate-orb-ripple" />
          <span className="absolute inset-0 rounded-full border border-brand-500/40 animate-orb-ripple" style={{ animationDelay: '1.4s' }} />
          <span className="absolute inset-0 rounded-full border border-brand-500/40 animate-orb-ripple" style={{ animationDelay: '2.8s' }} />
          {/* slow, eased drifting ring */}
          <span className={`absolute inset-2 rounded-full border border-brand-500/25 animate-orb-drift ${dragging ? 'border-brand-400/60' : ''}`} />
          {/* breathing core */}
          <span className="animate-orb-breathe">
            <span
              className={`relative flex h-14 w-14 items-center justify-center rounded-full bg-linear-to-br from-brand-400 to-brand-600 text-ink-950 shadow-lg shadow-black/30 transition-transform duration-300 ${
                dragging ? 'scale-110' : 'group-hover/orb:scale-110'
              }`}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" className="transition-transform duration-300 group-hover/orb:-translate-y-0.5">
                {dragging ? (
                  <path d="M12 16V4m-5 5 5-5 5 5M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  /* UV checker — the UV Studio mark (matches the app icon + favicon) */
                  <g fill="#ffffff">
                    <rect x="5" y="5" width="4" height="4" rx="0.6" />
                    <rect x="13" y="5" width="4" height="4" rx="0.6" />
                    <rect x="9" y="9" width="4" height="4" rx="0.6" />
                    <rect x="5" y="13" width="4" height="4" rx="0.6" />
                    <rect x="13" y="13" width="4" height="4" rx="0.6" />
                    <g opacity="0.28">
                      <rect x="9" y="5" width="4" height="4" rx="0.6" />
                      <rect x="5" y="9" width="4" height="4" rx="0.6" />
                      <rect x="13" y="9" width="4" height="4" rx="0.6" />
                      <rect x="9" y="13" width="4" height="4" rx="0.6" />
                    </g>
                  </g>
                )}
              </svg>
            </span>
          </span>
        </span>
      </button>

      {/* secondary actions, right under the orb */}
      <div className="mt-5 flex items-center gap-1">
        <button onClick={onPrefs} title="Preferences" aria-label="Preferences" className={iconBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
        </button>
        <button onClick={onHelp} title="Help" aria-label="Help" className={iconBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2-2.5 3.5" />
            <path d="M12 17h.01" />
          </svg>
        </button>
      </div>

      {/* credit, pinned to the bottom (links open in the default browser) */}
      <div className="absolute bottom-6 flex items-center gap-1 text-[11px] text-fog-500">
        <span>Created by</span>
        <a
          href="https://motion.hamlt.com"
          onClick={(e) => {
            e.preventDefault()
            void openExternal('https://motion.hamlt.com')
          }}
          className="font-medium text-fog-400 transition hover:text-fog-200 ring-focus"
        >
          hamLT
        </a>
        <span className="px-0.5">·</span>
        <span>Powered by</span>
        <a
          href="https://toyrobotmedia.com"
          onClick={(e) => {
            e.preventDefault()
            void openExternal('https://toyrobotmedia.com')
          }}
          className="font-medium text-fog-400 transition hover:text-fog-200 ring-focus"
        >
          Toy Robot Media
        </a>
      </div>

      <input ref={inputRef} type="file" accept=".glb,.gltf,.psd,image/*" multiple className="hidden" onChange={onPick} />
    </div>
  )
}
