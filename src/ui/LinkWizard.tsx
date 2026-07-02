import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import clsx from 'clsx'
import { useStore, type MediaItem } from '../state/store'

const hash = (name: string) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

/** Small media preview: the item's thumbnail on a dark checker, or a letter tile. */
function Thumb({ item }: { item: MediaItem | null }) {
  const cls = 'h-8 w-11'
  if (!item)
    return (
      <div className={clsx(cls, 'flex shrink-0 items-center justify-center rounded border border-dashed border-line bg-ink-950/60 text-[9px] text-fog-500')}>
        UVs
      </div>
    )
  return (
    <div className={clsx(cls, 'flex shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-ink-950')}>
      {item.thumb ? (
        <img src={item.thumb} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="text-[10px] font-semibold text-fog-400">{item.label.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  )
}

/**
 * Import-link wizard: each screen row shows what's linked to it (thumbnail +
 * label). Clicking a row's picker expands a plain list of the imported media —
 * each option a small thumbnail + name. Name matches are pre-linked; screens
 * left unlinked keep their imported texture/UVs.
 */
export default function LinkWizard() {
  const pending = useStore((s) => s.pendingLink)
  const confirmLink = useStore((s) => s.confirmLink)
  const cancelLink = useStore((s) => s.cancelLink)
  const addLinkMedia = useStore((s) => s.addLinkMedia)
  const [links, setLinks] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<string | null>(null) // screen whose picker grid is expanded
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (pending) {
      setLinks(pending.links)
      setOpen(null)
    }
  }, [pending])

  if (!pending) return null
  const { objects, items } = pending
  const byId = new Map(items.map((i) => [i.id, i]))
  const ownerOf = (id: number) => Object.keys(links).find((k) => links[k] === id)

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
    setOpen(null)
  }

  const linkedCount = Object.keys(links).length

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
      <div className="glass animate-modal-in flex max-h-[86vh] w-[620px] max-w-[94vw] flex-col rounded-2xl p-5 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fog-100">Link media to screens</h2>
          <span className="text-xs tabular-nums text-fog-400">
            {linkedCount}/{objects.length} linked
          </span>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-fog-400">
          {items.length === 0 ? (
            <>
              Add the PSD(s) / images for these screens with{' '}
              <span className="text-fog-200">Add PSD / images</span>, then link each to its screen.
            </>
          ) : (
            <>
              Each screen takes one image / PSD layer — click a screen's media to change it. Name
              matches are pre-linked. Screens on <span className="text-fog-200">keep imported</span>{' '}
              stay on their imported texture &amp; UVs.
            </>
          )}
        </p>

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink-950/40 p-2">
          {objects.map((obj) => {
            const linked = links[obj] != null ? (byId.get(links[obj]) ?? null) : null
            const isOpen = open === obj
            return (
              <li key={obj}>
                <div
                  onClick={() => setOpen(isOpen ? null : obj)}
                  className={clsx(
                    'row-lift flex cursor-pointer items-center gap-2.5 rounded-lg border px-2 py-1.5',
                    isOpen
                      ? 'border-brand-500/40 bg-brand-500/10'
                      : 'border-transparent hover:bg-ink-700/40',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: `hsl(${hash(obj)} 55% 58%)` }}
                  />
                  <span className="w-40 shrink-0 truncate text-sm text-fog-100">{obj}</span>
                  <span className="shrink-0 text-fog-500">→</span>
                  <Thumb item={linked} />
                  <span
                    className={clsx(
                      'min-w-0 flex-1 truncate text-xs',
                      linked ? 'text-fog-100' : 'text-fog-500',
                    )}
                  >
                    {linked ? linked.label : 'keep imported'}
                    {linked?.group && <span className="text-fog-500"> · {linked.group}</span>}
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={clsx('shrink-0 text-fog-500 transition-transform', isOpen && 'rotate-180')}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>

                {/* expanded: a plain list of options, each with a thumbnail */}
                {isOpen && (
                  <div className="animate-float-up mx-1 mb-1 mt-1 max-h-60 space-y-0.5 overflow-y-auto rounded-lg border border-line bg-ink-900/70 p-1.5">
                    <button
                      onClick={() => setLink(obj, null)}
                      className={clsx(
                        'btn-press flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left',
                        linked == null
                          ? 'border-brand-500/50 bg-brand-500/10'
                          : 'border-transparent hover:bg-ink-700/50',
                      )}
                    >
                      <Thumb item={null} />
                      <span className="min-w-0 flex-1 truncate text-xs text-fog-300">keep imported</span>
                    </button>
                    {items.map((it) => {
                      const owner = ownerOf(it.id)
                      const mine = owner === obj
                      return (
                        <button
                          key={it.id}
                          onClick={() => setLink(obj, it.id)}
                          title={it.group ? `${it.group} › ${it.label}` : it.label}
                          className={clsx(
                            'btn-press flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left',
                            mine
                              ? 'border-brand-500/50 bg-brand-500/10'
                              : 'border-transparent hover:bg-ink-700/50',
                            owner && !mine && 'opacity-55',
                          )}
                        >
                          <Thumb item={it} />
                          <span className="min-w-0 flex-1 truncate text-xs text-fog-200">
                            {it.label}
                            {it.group && <span className="text-fog-500"> · {it.group}</span>}
                          </span>
                          {owner && !mine && (
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              title={`linked to ${owner}`}
                              style={{ background: `hsl(${hash(owner)} 55% 58%)` }}
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="btn-press rounded-md border border-line bg-ink-700/60 px-3 py-1.5 text-[12px] text-fog-100 hover:bg-ink-600 ring-focus"
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
              className="btn-press rounded-md px-3 py-1.5 text-sm text-fog-300 hover:bg-ink-700 hover:text-fog-100"
            >
              Skip
            </button>
            <button
              onClick={() => confirmLink(links)}
              disabled={linkedCount === 0}
              className="btn-press rounded-md bg-brand-500/90 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-brand-400 disabled:opacity-40"
            >
              Apply to {linkedCount} screen{linkedCount === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
