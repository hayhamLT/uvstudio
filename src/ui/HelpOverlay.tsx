import { useState } from 'react'

type Tab = 'workflow' | 'shortcuts' | 'bridges'

const WORKFLOW: [string, string][] = [
  [
    'Bring in screens',
    'Send a selection from Cinema 4D or Blender with the bridge plugin / add-on, or drop / pick a model (GLB · glTF) together with its PSDs / images — a wizard links each layer to its screen by name.',
  ],
  [
    'Pick & map',
    'Imports keep their own UVs; auto-map is opt-in — Auto-map ALL (top-left), the bottom-bar Auto-map, or M for the active screen. Click a screen (3D or list) to work on it.',
  ],
  [
    'Adjust a screen',
    'Bottom bar (2D): rotate · flip · free-transform · unwrap projection (Auto / Planar / Cylindrical / Spherical). Set its real LED size under RES. The 2D view shows the whole PSD with this screen’s chunk outlined.',
  ],
  [
    'Reference geometry',
    'Non-screen objects show as a dim shell — the slider sets their brightness, the eye hides them.',
  ],
  [
    'Send it back',
    'Export a textured GLB, or Send back to Cinema 4D / Blender — the UVs ride onto your original objects losslessly (geometry untouched).',
  ],
]

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'View',
    items: [
      ['Tab', 'Swap 2D / 3D full-screen'],
      ['Click', 'Make a screen active (3D / list)'],
      ['1 / 2 / 3', 'over 3D: Shaded / Distortion / Checker'],
      ['B', 'Toggle backface culling (3D)'],
    ],
  },
  {
    title: 'Edit modes (2D)',
    items: [
      ['1 / 2 / 3 / 4', 'Vertex / Edge / Face / Object'],
      ['` / 0', 'Leave edit mode'],
    ],
  },
  {
    title: 'Transform a screen',
    items: [
      ['M', 'Auto-map active screen'],
      ['T', 'Free transform (⇧ non-uniform · ⌥ corner)'],
      ['R / ⇧R', 'Rotate CW / CCW'],
      ['F / ⇧F', 'Flip H / V'],
      ['S', 'Scale — move mouse, click to set'],
      ['+ / −', 'Scale up / down'],
      ['X', 'Reset orientation'],
    ],
  },
  {
    title: 'Selection & general',
    items: [
      ['Drag', 'Move selection · drag bg = marquee'],
      ['⇧ Click', 'Add / remove from selection'],
      ['⌘/Ctrl Z', 'Undo · ⇧ to redo'],
      ['Right-drag', 'Pan the view · Esc clears'],
      ['H', 'Toggle this help'],
    ],
  },
]

const BRIDGES: { name: string; steps: string[] }[] = [
  {
    name: 'Cinema 4D',
    steps: [
      'Install from Preferences ▸ Plugin, then restart Cinema 4D.',
      'Extensions ▸ UV Studio Bridge ▸ Send — the selected objects open here.',
      'Unwrap, then Send back — UVs write onto the original UVW tags (lossless).',
    ],
  },
  {
    name: 'Blender',
    steps: [
      'Install from Preferences ▸ Blender, then enable it once in Blender ▸ Preferences ▸ Add-ons.',
      'View3D ▸ Sidebar (N) ▸ UV Studio ▸ Send — the selected meshes open here.',
      'Unwrap, then Send back — UVs land on each object’s active UV layer.',
    ],
  },
]

function Workflow() {
  return (
    <ol className="space-y-2.5">
      {WORKFLOW.map(([title, body], i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-xs font-semibold text-brand-400">
            {i + 1}
          </span>
          <div>
            <div className="text-sm font-medium text-fog-100">{title}</div>
            <div className="text-[13px] leading-snug text-fog-400">{body}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Shortcuts() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4">
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fog-500">
            {g.title}
          </div>
          <div className="space-y-1">
            {g.items.map(([k, label]) => (
              <div key={k} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="text-fog-300">{label}</span>
                <kbd className="mt-px shrink-0 rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-[11px] text-fog-200">
                  {k}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Bridges() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {BRIDGES.map((b) => (
        <div key={b.name} className="rounded-lg border border-line/70 bg-ink-800/50 p-4">
          <div className="mb-2 text-sm font-semibold text-fog-100">{b.name}</div>
          <ol className="space-y-2">
            {b.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-fog-400">
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[10px] font-semibold text-brand-400">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('workflow')
  const tabs: Tab[] = ['workflow', 'shortcuts', 'bridges']
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass flex max-h-[88vh] w-[660px] max-w-[92vw] animate-float-up flex-col rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fog-100">Help</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-fog-400 hover:bg-ink-700 hover:text-fog-100"
          >
            Esc
          </button>
        </div>

        {/* tabs */}
        <div className="mb-4 flex gap-1 rounded-lg bg-ink-800/70 p-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ring-focus ${
                tab === t ? 'bg-brand-500/90 text-white' : 'text-fog-300 hover:bg-ink-700/60 hover:text-fog-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {tab === 'workflow' && <Workflow />}
          {tab === 'shortcuts' && <Shortcuts />}
          {tab === 'bridges' && <Bridges />}
        </div>
      </div>
    </div>
  )
}
