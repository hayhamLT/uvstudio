import { useRef, type ChangeEvent, type PointerEvent } from 'react'
import { handleViewportDrop, importModelFile, isModelFile, openModelPicker } from './importMap'
import { useFileDrop } from './useFileDrop'
import { isEmbeddedHost } from './env'

const embedded = isEmbeddedHost()

export default function Landing() {
  const inputRef = useRef<HTMLInputElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const { dragging, ref: dropRef } = useFileDrop(handleViewportDrop)

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    const model = files.find(isModelFile)
    if (model) await importModelFile(model, null, files.filter((f) => f !== model && !isModelFile(f)))
    e.target.value = ''
  }

  // glow + parallax follow the cursor
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const host = e.currentTarget
    const r = host.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    host.style.setProperty('--mx', `${x * 100}%`)
    host.style.setProperty('--my', `${y * 100}%`)
    host.style.setProperty('--px', `${(x - 0.5) * 22}px`)
    host.style.setProperty('--py', `${(y - 0.5) * 22}px`)
  }

  return (
    <div
      ref={dropRef}
      onPointerMove={onMove}
      className="group/landing relative min-h-0 flex-1 overflow-hidden"
      style={{ ['--mx' as string]: '50%', ['--my' as string]: '42%' }}
    >
      {/* cursor-reactive glow */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 transition-[background] duration-200"
        style={{
          background:
            'radial-gradient(480px circle at var(--mx) var(--my), color-mix(in srgb, var(--color-brand-500) 20%, transparent), transparent 60%)',
        }}
      />

      <button
        onClick={() => openModelPicker(inputRef.current)}
        className="absolute inset-0 flex flex-col items-center justify-center gap-7 outline-none"
        style={{ transform: 'translate(var(--px,0), var(--py,0))', transition: 'transform 120ms ease-out' }}
      >
        {/* interactive import orb */}
        <span className="relative flex h-40 w-40 items-center justify-center">
          {/* pulsing rings */}
          <span className={`absolute inset-0 rounded-full border border-brand-500/30 ${dragging ? 'animate-ping' : ''}`} />
          <span
            className="absolute inset-4 rounded-full border border-brand-500/20"
            style={{ animation: 'spin 18s linear infinite' }}
          />
          <span className="absolute inset-0 rounded-full bg-brand-500/5 transition group-hover/landing:bg-brand-500/10" />
          {/* core */}
          <span
            className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-linear-to-br from-brand-400 to-brand-600 text-ink-950 shadow-xl shadow-brand-600/40 transition-transform duration-200 ${
              dragging ? 'scale-110' : 'group-hover/landing:scale-105'
            }`}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
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

        {/* minimal label */}
        <span className="flex flex-col items-center gap-2">
          <span className="text-lg font-medium tracking-tight text-fog-50">
            {dragging ? 'Drop to import' : 'Import model + media'}
          </span>
          <span className="max-w-xs text-center text-xs text-fog-400">
            {embedded ? 'Select' : 'Drop or select'} your model and its screen maps together — you'll
            link each layer to its screen next.
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-fog-500">
            <Pill>GLB</Pill>
            <Pill>glTF</Pill>
            <span className="text-fog-600">+</span>
            <Pill>PSD</Pill>
            <Pill>images</Pill>
          </span>
        </span>
      </button>

      <input ref={inputRef} type="file" accept=".glb,.gltf,.psd,image/*" multiple className="hidden" onChange={onPick} />
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-ink-700/60 px-1.5 py-0.5 text-fog-400">{children}</span>
}
