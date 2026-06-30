import { useRef, type ChangeEvent } from 'react'
import { handleViewportDrop, importModelFile, isModelFile, openModelPicker } from './importMap'
import { useFileDrop } from './useFileDrop'

export default function Landing() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { dragging, ref: dropRef } = useFileDrop(handleViewportDrop)

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const model = files.find(isModelFile)
    if (model) await importModelFile(model, null, files.filter((f) => f !== model && !isModelFile(f)))
    e.target.value = ''
  }

  return (
    <div ref={dropRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <button
        onClick={() => openModelPicker(inputRef.current)}
        aria-label="Import model"
        className="group/orb flex items-center justify-center rounded-full p-8 outline-none"
      >
        <span className="relative flex h-40 w-40 items-center justify-center transition-transform duration-500 ease-out group-hover/orb:scale-105 group-active/orb:scale-95">
          {/* organic expanding "ripple" lines (staggered, continuous) */}
          <span className="absolute inset-0 rounded-full border border-brand-500/40 animate-orb-ripple" />
          <span className="absolute inset-0 rounded-full border border-brand-500/40 animate-orb-ripple" style={{ animationDelay: '1.4s' }} />
          <span className="absolute inset-0 rounded-full border border-brand-500/40 animate-orb-ripple" style={{ animationDelay: '2.8s' }} />
          {/* a slow, eased drifting ring (alive, not mechanical) */}
          <span className={`absolute inset-3 rounded-full border border-brand-500/25 animate-orb-drift ${dragging ? 'border-brand-400/60' : ''}`} />
          {/* breathing core */}
          <span className="animate-orb-breathe">
            <span
              className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-linear-to-br from-brand-400 to-brand-600 text-ink-950 shadow-lg shadow-black/30 transition-transform duration-300 ${
                dragging ? 'scale-110' : 'group-hover/orb:scale-110'
              }`}
            >
              <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300 group-hover/orb:-translate-y-0.5">
                {dragging ? (
                  <path d="M12 16V4m-5 5 5-5 5 5M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
                ) : (
                  <>
                    <path d="M12 3 21 8v8l-9 5-9-5V8l9-5Z" strokeLinejoin="round" />
                    <path d="M3.5 8 12 13l8.5-5M12 13v8" strokeLinejoin="round" />
                  </>
                )}
              </svg>
            </span>
          </span>
        </span>
      </button>

      <input ref={inputRef} type="file" accept=".glb,.gltf,.psd,image/*" multiple className="hidden" onChange={onPick} />
    </div>
  )
}
