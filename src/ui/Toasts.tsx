import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore, type Toast } from '../state/store'

/** How long each kind stays up (ms). Problems linger longer than good news. */
const TTL: Record<Toast['kind'], number> = {
  good: 3800,
  info: 4500,
  warn: 8000,
  bad: 12000,
}

const ACCENT: Record<Toast['kind'], string> = {
  good: 'border-l-good',
  info: 'border-l-brand-500',
  warn: 'border-l-warn',
  bad: 'border-l-bad',
}

function KindIcon({ kind }: { kind: Toast['kind'] }) {
  const cls =
    kind === 'good'
      ? 'text-good'
      : kind === 'warn'
        ? 'text-warn'
        : kind === 'bad'
          ? 'text-bad'
          : 'text-brand-400'
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={clsx('mt-0.5 shrink-0', cls)}
    >
      {kind === 'good' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.5 2.5 2.5 4.5-5" />
        </>
      ) : kind === 'bad' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </>
      ) : kind === 'warn' ? (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-5M12 8h.01" />
        </>
      )}
    </svg>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startExit = () => {
    setLeaving(true)
    setTimeout(() => dismiss(toast.id), 170) // let the slide-out play
  }
  const arm = () => {
    timer.current = setTimeout(startExit, TTL[toast.kind])
  }
  const hold = () => {
    if (timer.current) clearTimeout(timer.current)
  }

  useEffect(() => {
    arm()
    return hold
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      onMouseEnter={hold} // hovering pauses the clock…
      onMouseLeave={arm} // …leaving restarts it
      className={clsx(
        'glass pointer-events-auto flex items-start gap-2.5 rounded-lg border-l-2 py-2.5 pl-3 pr-2 shadow-xl',
        ACCENT[toast.kind],
        leaving ? 'animate-toast-out' : 'animate-toast-in',
      )}
    >
      <KindIcon kind={toast.kind} />
      <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-fog-100">{toast.msg}</div>
      <button
        onClick={startExit}
        title="Dismiss"
        className="btn-press flex h-5 w-5 shrink-0 items-center justify-center rounded text-fog-500 hover:bg-ink-700 hover:text-fog-100"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

/** Transient notification stack — top-right, newest at the bottom. */
export default function Toasts() {
  const toasts = useStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed right-3 top-14 z-[130] flex w-[330px] max-w-[calc(100vw-24px)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}
