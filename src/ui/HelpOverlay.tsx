const SHORTCUTS: [string, string][] = [
  ['Tab', 'Swap 2D / 3D full-screen'],
  ['Click', 'Make a screen active (3D / list)'],
  ['1 / 2 / 3', 'over 3D: Shaded / Distortion / Checker'],
  ['1 / 2 / 3 / 4', 'over 2D: Vertex / Edge / Face / Object'],
  ['T', 'Free transform (scale from centre · ⇧ non-uniform · ⌥ corner)'],
  ['R / ⇧R', 'Rotate active screen CW / CCW'],
  ['F / ⇧F', 'Flip active screen H / V'],
  ['X', 'Reset active screen orientation'],
  ['M', 'Auto-map active screen'],
  ['S', 'Scale active screen — move mouse, click to set'],
  ['+ / −', 'Scale selection (or active screen) up / down'],
  ['H', 'Toggle this help'],
  ['⌘/Ctrl Z', 'Undo · ⇧ to redo'],
  ['Drag', 'Move selection · drag bg = marquee'],
  ['⇧ Click', 'Add / remove from selection'],
  ['` / 0', 'Leave edit mode · Right-drag pans · Esc clears'],
]

const FLOW = [
  'Bring in screens — drop / pick a model with its screen maps (a multi-object GLB/glTF plus the PSD(s) / images; a wizard links each layer to its screen by name), or Send a selection straight from Cinema 4D with the bridge plugin.',
  'Screens auto-map on import — each one keeps its imported UVs and fits its content. Click a screen (3D or list) to work on it.',
  'Bottom bar (2D): Auto-map · rotate · flip · free-transform · unwrap projection (Auto / Planar / Cylindrical / Spherical). Top bar: Vertex / Edge / Face / Object edit modes.',
  'Each screen: the eye/solo dot cycles visible → solo → hidden; set its real LED size under RES; the 2D view shows the whole PSD with this screen’s chunk outlined.',
  'Reference geometry (non-screen objects) shows as a dim shell — the slider sets its brightness (black → grey); the eye hides it.',
  'Export → GLB (textured), or Send to Cinema 4D — the unwrap rides back onto your original objects’ UVs losslessly (geometry untouched, nothing to set up).',
]

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass w-[640px] max-w-[92vw] animate-float-up rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fog-100">UV Studio — screen mapping</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-fog-400 hover:bg-ink-700 hover:text-fog-100"
          >
            Esc
          </button>
        </div>

        <ol className="mb-5 space-y-1.5">
          {FLOW.map((f, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-fog-300">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-[11px] font-semibold text-brand-400">
                {i + 1}
              </span>
              {f}
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-fog-300">{label}</span>
              <kbd className="rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-xs text-fog-200">
                {k}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
