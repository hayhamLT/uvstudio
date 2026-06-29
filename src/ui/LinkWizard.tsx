import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import clsx from 'clsx'
import { useStore } from '../state/store'

const hash = (name: string) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/**
 * Import-link wizard: screens on the left, each with a dropdown of the imported
 * media (grouped PSD layers + single files). Matches by name are pre-linked;
 * the user fixes any that are wrong (or when names don't match at all). Screens
 * left unlinked keep their imported texture/UVs.
 */
export default function LinkWizard() {
  const pending = useStore((s) => s.pendingLink)
  const confirmLink = useStore((s) => s.confirmLink)
  const cancelLink = useStore((s) => s.cancelLink)
  const addLinkMedia = useStore((s) => s.addLinkMedia)
  const [links, setLinks] = useState<Record<string, number>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pending) setLinks(pending.links)
  }, [pending])

  if (!pending) return null
  const { objects, items } = pending

  const onAddFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length) await addLinkMedia(files)
    e.target.value = ''
  }

  const setLink = (obj: string, id: number | null) => {
    setLinks((p) => {
      const next = { ...p }
      if (id == null) {
        delete next[obj]
      } else {
        // one-to-one: steal the item from whatever screen had it
        for (const k of Object.keys(next)) if (next[k] === id) delete next[k]
        next[obj] = id
      }
      return next
    })
  }

  const linkedCount = Object.keys(links).length
  const itemLabel = (it: (typeof items)[number]) =>
    it.group ? `${it.group} › ${it.label}` : it.label

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
      <div className="glass flex max-h-[82vh] w-[560px] max-w-[94vw] flex-col rounded-2xl p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fog-100">Link media to screens</h2>
          <span className="text-xs text-fog-400">
            {linkedCount}/{objects.length} linked
          </span>
        </div>
        <p className="mb-3 text-xs text-fog-400">
          {items.length === 0 ? (
            <>
              Add the PSD(s) / images for these screens with{' '}
              <span className="text-fog-200">Add PSD / images</span>, then link each to its screen.
            </>
          ) : (
            <>
              Each screen takes one image / PSD layer. Name matches are pre-linked — adjust any that
              are wrong. Screens left as <span className="text-fog-200">keep imported</span> stay on
              their imported texture &amp; UVs.
            </>
          )}
        </p>

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink-950/40 p-2">
          {objects.map((obj) => (
            <li key={obj} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: `hsl(${hash(obj)} 55% 58%)` }}
              />
              <span className="w-44 shrink-0 truncate text-sm text-fog-100">{obj}</span>
              <span className="shrink-0 text-fog-500">→</span>
              <select
                value={links[obj] ?? ''}
                onChange={(e) => setLink(obj, e.target.value === '' ? null : Number(e.target.value))}
                className={clsx(
                  'min-w-0 flex-1 rounded-md border bg-ink-800 px-2 py-1 text-xs ring-focus',
                  links[obj] != null ? 'border-brand-500/40 text-fog-100' : 'border-line text-fog-400',
                )}
              >
                <option value="">— keep imported —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {itemLabel(it)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-line bg-ink-700/60 px-3 py-1.5 text-[12px] text-fog-100 hover:bg-ink-600 ring-focus"
          >
            + Add PSD / images
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".psd,image/*"
            multiple
            className="hidden"
            onChange={onAddFiles}
          />
          <div className="flex gap-2">
            <button
              onClick={cancelLink}
              className="rounded-md px-3 py-1.5 text-sm text-fog-300 hover:bg-ink-700 hover:text-fog-100"
            >
              Skip
            </button>
            <button
              onClick={() => confirmLink(links)}
              disabled={linkedCount === 0}
              className="rounded-md bg-brand-500/90 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-400 disabled:opacity-40"
            >
              Apply to {linkedCount} screen{linkedCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
