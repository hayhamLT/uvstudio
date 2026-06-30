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
        className="group/orb flex flex-col items-center justify-center gap-5 rounded-3xl p-6 outline-none"
      >
        {/* interactive import orb */}
        <span className="relative flex h-36 w-36 items-center justify-center transition-transform duration-300 group-hover/orb:scale-105 group-active/orb:scale-95">
          {/* rings — brighten + spread on hover */}
          <span className={`absolute inset-0 rounded-full border border-brand-500/30 transition duration-300 group-hover/orb:border-brand-500/60 ${dragging ? 'animate-ping' : ''}`} />
          <span
            className="absolute inset-3 rounded-full border border-brand-500/20 transition duration-300 group-hover/orb:inset-1 group-hover/orb:border-brand-500/40"
            style={{ animation: 'spin 18s linear infinite' }}
          />
          {/* core */}
          <span
            className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-linear-to-br from-brand-400 to-brand-600 text-ink-950 shadow-lg shadow-black/30 transition-transform duration-200 ${
              dragging ? 'scale-110' : 'group-hover/orb:scale-110'
            }`}
          >
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200 group-hover/orb:-translate-y-px">
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

        <span className="text-sm font-medium tracking-tight text-fog-300 transition-colors group-hover/orb:text-fog-100">
          {dragging ? 'Drop to import' : 'Import'}
        </span>
      </button>

      <input ref={inputRef} type="file" accept=".glb,.gltf,.psd,image/*" multiple className="hidden" onChange={onPick} />
    </div>
  )
}
