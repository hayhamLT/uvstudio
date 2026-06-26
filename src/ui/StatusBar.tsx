import { useStore } from '../state/store'

export default function StatusBar() {
  const status = useStore((s) => s.status)
  const editMode = useStore((s) => s.editMode)
  const selCount = useStore((s) => s.mapSelection.size)
  const selectedObject = useStore((s) => s.selectedObject)
  const objects = useStore((s) => s.mapObjects.length)
  const mapped = useStore((s) => s.mappedObjects.length)
  const reference = useStore((s) => s.contextCount)

  return (
    <footer className="flex h-7 items-center gap-3 border-t border-line bg-ink-900/80 px-3 text-[11px] text-fog-400">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-good" />
        <span className="text-fog-300">{status}</span>
      </div>
      <div className="flex-1" />
      {editMode !== 'none' && (
        <span className="uppercase tracking-wide text-brand-400">
          {editMode === 'object' ? (
            <>
              object · <span className="normal-case">{selectedObject ?? 'none'}</span>
            </>
          ) : (
            <>
              {editMode} · {selCount} sel
            </>
          )}
        </span>
      )}
      {objects > 0 && (
        <span>
          <span className="text-fog-200">{objects}</span> screen{objects === 1 ? '' : 's'} ·{' '}
          <span className="text-good">{mapped}</span> mapped
          {reference > 0 && (
            <>
              {' '}
              · <span className="text-fog-300">{reference}</span> reference
            </>
          )}
        </span>
      )}
    </footer>
  )
}
