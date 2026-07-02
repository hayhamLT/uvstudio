import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../state/store'
import { classifyScreens, isNamedScreen, BUILTIN_SCREEN_KEYWORDS } from '../map/classify'

/** Lets the user pick which imported objects become screens. Screens are
 *  auto-detected by name on open; the detection keywords, a search filter, and
 *  per-object toggles are all editable here so a busy scene stays manageable. */
export default function ImportDialog() {
  const pending = useStore((s) => s.pendingImport)
  const confirmImport = useStore((s) => s.confirmImport)
  const cancelImport = useStore((s) => s.cancelImport)
  // detection keywords are a persisted preference — edit them here at import
  // time OR in Preferences ▸ Screen detection; both write the same setting.
  const keywords = useStore((s) => s.screenKeywords)
  const setScreenKeywords = useStore((s) => s.setScreenKeywords)

  const extraKeywords = useMemo(
    () => keywords.split(',').map((k) => k.trim()).filter(Boolean),
    [keywords],
  )

  // The selection is derived: the keyword-detected set, plus the user's manual
  // overrides. Keeping overrides separate means editing keywords re-detects from
  // scratch (so "v" → "vidwall" leaves no stale matches) while never discarding
  // a box you ticked or cleared by hand.
  const [manualOn, setManualOn] = useState<Set<string>>(new Set())
  const [manualOff, setManualOff] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  useEffect(() => {
    setManualOn(new Set())
    setManualOff(new Set())
    setFilter('')
  }, [pending])

  // Esc closes the dialog (matches every other modal).
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelImport()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, cancelImport])

  const objs = pending?.objects ?? []
  const auto = useMemo(
    () => (pending ? classifyScreens(objs, extraKeywords) : new Set<string>()),
    // objs is stable for a given pending; extraKeywords drives re-detection
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, extraKeywords],
  )
  const sel = useMemo(() => {
    const s = new Set(auto)
    manualOn.forEach((n) => s.add(n))
    manualOff.forEach((n) => s.delete(n))
    return s
  }, [auto, manualOn, manualOff])

  if (!pending) return null

  const toggle = (n: string) => {
    if (sel.has(n)) {
      setManualOn((p) => {
        const x = new Set(p)
        x.delete(n)
        return x
      })
      if (auto.has(n)) setManualOff((p) => new Set(p).add(n))
    } else {
      setManualOff((p) => {
        const x = new Set(p)
        x.delete(n)
        return x
      })
      if (!auto.has(n)) setManualOn((p) => new Set(p).add(n))
    }
  }
  const selectAll = () => {
    setManualOn(new Set(objs.map((o) => o.name)))
    setManualOff(new Set())
  }
  const deselectAll = () => {
    setManualOff(new Set(objs.map((o) => o.name)))
    setManualOn(new Set())
  }

  const q = filter.trim().toLowerCase()
  const visible = q ? objs.filter((o) => o.name.toLowerCase().includes(q)) : objs
  const refCount = objs.length - sel.size

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 p-4 backdrop-blur-sm"
      onClick={cancelImport}
    >
      <div
        className="glass animate-modal-in flex max-h-[86vh] w-[500px] max-w-full flex-col rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-fog-100">Choose screens</h2>
          <span className="truncate font-mono text-[11px] text-fog-400/70">{pending.fileName}</span>
        </div>
        <p className="mb-4 text-xs leading-relaxed text-fog-400">
          Checked objects become mappable <span className="text-fog-200">screens</span>. Everything else
          still imports as dimmable <span className="text-fog-200">reference geometry</span>.
        </p>

        {/* detection keywords — the auto-selector, editable inline */}
        <div className="mb-3 rounded-xl border border-line bg-ink-900/50 p-3">
          <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-fog-400">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-brand-400">
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
            </svg>
            Auto-detect screens named like
          </label>
          <div className="mt-2 flex flex-wrap gap-1">
            {BUILTIN_SCREEN_KEYWORDS.map((k) => (
              <span key={k} className="rounded bg-ink-700/70 px-1.5 py-0.5 text-[10px] text-fog-400">
                {k}
              </span>
            ))}
          </div>
          <input
            type="text"
            value={keywords}
            onChange={(e) => setScreenKeywords(e.target.value)}
            placeholder="+ add your own, e.g. vidwall, canvas"
            className="mt-2 w-full rounded-md border border-line bg-ink-800 px-2.5 py-1.5 text-xs text-fog-100 placeholder:text-fog-500 ring-focus"
          />
        </div>

        {/* filter + counts */}
        <div className="mb-2 flex items-center gap-2">
          <div className="relative flex-1">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fog-500">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${objs.length} objects…`}
              className="w-full rounded-md border border-line bg-ink-800 py-1.5 pl-8 pr-2.5 text-xs text-fog-100 placeholder:text-fog-500 ring-focus"
            />
          </div>
          <button
            onClick={sel.size >= objs.length ? deselectAll : selectAll}
            className="btn-press shrink-0 rounded-md border border-line bg-ink-700/60 px-2.5 py-1.5 text-[11px] text-fog-200 hover:bg-ink-600 ring-focus"
          >
            {sel.size >= objs.length ? 'Clear all' : 'Select all'}
          </button>
        </div>

        <div className="mb-1.5 flex items-center justify-between px-0.5 text-[11px] text-fog-400">
          <span>
            <span className="font-semibold text-brand-300">{sel.size}</span> screen{sel.size === 1 ? '' : 's'} ·{' '}
            <span className="text-fog-300">{refCount}</span> reference
          </span>
          {q && (
            <span className="text-fog-500">
              showing {visible.length} of {objs.length}
            </span>
          )}
        </div>

        {/* object list */}
        <ul className="min-h-[80px] flex-1 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-ink-950/40 p-1">
          {visible.length === 0 ? (
            <li className="flex h-24 items-center justify-center text-xs text-fog-500">
              No objects match “{filter.trim()}”
            </li>
          ) : (
            visible.map((o) => {
              const on = sel.has(o.name)
              const verts = o.mesh.positions.length / 3
              const named = isNamedScreen(o.name, extraKeywords)
              return (
                <li key={o.name}>
                  <button
                    onClick={() => toggle(o.name)}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition',
                      on
                        ? 'bg-brand-500/10 text-fog-100 ring-1 ring-inset ring-brand-500/20'
                        : 'text-fog-400 hover:bg-ink-700/50',
                    )}
                  >
                    <span
                      className={clsx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition',
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
                    {named && (
                      <span className="rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">screen</span>
                    )}
                    {o.textureImage && (
                      <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-medium text-good">textured</span>
                    )}
                    <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-fog-500">{verts} v</span>
                  </button>
                </li>
              )
            })
          )}
        </ul>

        {/* footer */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] text-fog-500">Esc to cancel</span>
          <div className="flex gap-2">
            <button
              onClick={cancelImport}
              className="btn-press rounded-md px-3 py-1.5 text-sm text-fog-300 hover:bg-ink-700 hover:text-fog-100"
            >
              Cancel
            </button>
            <button
              onClick={() => confirmImport([...sel])}
              className="btn-press rounded-md bg-brand-500/90 px-3.5 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-400"
            >
              Import {objs.length} object{objs.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
