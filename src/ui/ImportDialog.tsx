import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { classifyScreens, isNamedScreen } from '../map/classify'

/** Lets the user pick which objects from an imported file become screens, so a
 *  busy scene doesn't flood the pipeline. Screens are auto-detected on open. */
export default function ImportDialog() {
  const pending = useStore((s) => s.pendingImport)
  const confirmImport = useStore((s) => s.confirmImport)
  const cancelImport = useStore((s) => s.cancelImport)
  const [sel, setSel] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (pending) setSel(classifyScreens(pending.objects))
  }, [pending])

  // auto-detection is meaningful only when it didn't just select everything
  const autoDetected = !!pending && sel.size > 0 && sel.size < pending.objects.length

  if (!pending) return null
  const objs = pending.objects
  const toggle = (n: string) =>
    setSel((p) => {
      const x = new Set(p)
      x.has(n) ? x.delete(n) : x.add(n)
      return x
    })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
      <div className="glass flex max-h-[80vh] w-[460px] max-w-[92vw] flex-col rounded-2xl p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fog-100">Choose screens</h2>
          <span className="truncate pl-3 text-xs text-fog-400/70">{pending.fileName}</span>
        </div>
        <p className="mb-3 text-xs text-fog-400">
          {autoDetected && (
            <span className="font-medium text-good">Auto-detected {sel.size} screen{sel.size === 1 ? '' : 's'}. </span>
          )}
          Checked objects become mappable <span className="text-fog-200">screens</span>. Everything else is
          still imported as dimmable <span className="text-fog-200">reference geometry</span>.
        </p>

        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-fog-300">
            <span className="font-medium text-fog-100">{sel.size}</span> screen{sel.size === 1 ? '' : 's'} ·{' '}
            {objs.length - sel.size} reference
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setSel(new Set(objs.map((o) => o.name)))}
              className="rounded px-2 py-0.5 text-fog-300 hover:bg-ink-700 hover:text-fog-100"
            >
              Select all
            </button>
            <button
              onClick={() => setSel(new Set())}
              className="rounded px-2 py-0.5 text-fog-300 hover:bg-ink-700 hover:text-fog-100"
            >
              Deselect all
            </button>
          </div>
        </div>

        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-ink-950/40 p-1">
          {objs.map((o) => {
            const on = sel.has(o.name)
            const verts = o.mesh.positions.length / 3
            return (
              <li key={o.name}>
                <button
                  onClick={() => toggle(o.name)}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition',
                    on ? 'bg-brand-500/10 text-fog-100' : 'text-fog-400 hover:bg-ink-700/50',
                  )}
                >
                  <span
                    className={clsx(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      on ? 'border-brand-400 bg-brand-500/80 text-ink-950' : 'border-line',
                    )}
                  >
                    {on && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5L20 6" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{o.name}</span>
                  {isNamedScreen(o.name) && (
                    <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">screen</span>
                  )}
                  {o.textureImage && (
                    <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-medium text-good">textured</span>
                  )}
                  <span className="text-[10px] tabular-nums text-fog-500">{verts} v</span>
                </button>
              </li>
            )
          })}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={cancelImport}
            className="rounded-md px-3 py-1.5 text-sm text-fog-300 hover:bg-ink-700 hover:text-fog-100"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmImport([...sel])}
            className="rounded-md bg-brand-500/90 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-400"
          >
            Import {objs.length} object{objs.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  )
}
