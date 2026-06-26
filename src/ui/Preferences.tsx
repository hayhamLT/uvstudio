import { useState, type ReactNode } from 'react'
import { useStore } from '../state/store'
import * as link from '../bridge/link'

/** Set-once / rarely-touched settings — Cinema 4D setup and import defaults. */
export default function Preferences({ open, onClose }: { open: boolean; onClose: () => void }) {
  const autoMap = useStore((s) => s.autoMapOnImport)
  const setAutoMap = useStore((s) => s.setAutoMapOnImport)
  const setStatus = useStore((s) => s.setStatus)
  const [linkLabel, setLinkLabel] = useState(link.isConnected() ? link.linkFolderLabel() : '')
  const [busy, setBusy] = useState('')
  if (!open) return null

  const connect = async () => {
    setBusy('link')
    if (await link.connect()) setLinkLabel(link.linkFolderLabel())
    setBusy('')
  }
  const install = async () => {
    setBusy('install')
    setStatus('Choose your Cinema 4D “plugins” folder…')
    const where = await link.installC4DPlugin()
    setStatus(where ? `Installed C4D plugin → ${where} (restart C4D)` : 'Plugin install cancelled')
    setBusy('')
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass w-[540px] max-w-[92vw] animate-float-up rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fog-100">Preferences</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-fog-400 hover:bg-ink-700 hover:text-fog-100"
          >
            Esc
          </button>
        </div>

        <Section title="Cinema 4D">
          {!link.linkSupported() ? (
            <p className="text-[12px] text-fog-400">
              The Cinema 4D bridge needs the <span className="text-fog-200">desktop app</span> or a
              Chromium browser.
            </p>
          ) : (
            <>
              <Row
                label="Link folder"
                hint={linkLabel ? `Connected · ${linkLabel}` : 'The shared folder both apps hand GLBs through'}
              >
                <Btn onClick={connect} busy={busy === 'link'}>
                  {linkLabel ? 'Change…' : 'Connect…'}
                </Btn>
              </Row>
              {link.isDesktop() && (
                <Row label="Plugin" hint="Copy the UV Studio Bridge plugin into Cinema 4D’s plugins folder">
                  <Btn onClick={install} busy={busy === 'install'}>
                    Install plugin…
                  </Btn>
                </Row>
              )}
            </>
          )}
        </Section>

        <Section title="Defaults">
          <Toggle
            label="Auto-map screens on import"
            hint="Fit each screen to its content the moment you import"
            checked={autoMap}
            onChange={setAutoMap}
          />
        </Section>

        <p className="mt-5 text-[11px] leading-relaxed text-fog-500">
          Per-screen tools (transform, projection, resolution, solo) stay inline on each screen —
          this is just for things you set once.
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-fog-400/70">{title}</div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-fog-200">{label}</div>
        {hint && <div className="truncate text-[11px] text-fog-500">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Btn({ onClick, busy, children }: { onClick: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="shrink-0 rounded-md border border-line bg-ink-700/60 px-3 py-1.5 text-[12px] text-fog-100 hover:bg-ink-600 disabled:opacity-50 ring-focus"
    >
      {busy ? '…' : children}
    </button>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-fog-200">{label}</div>
        {hint && <div className="text-[11px] text-fog-500">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={
          'relative h-5 w-9 shrink-0 rounded-full transition ' +
          (checked ? 'bg-brand-500' : 'bg-ink-600')
        }
      >
        <span
          className={
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition ' +
            (checked ? 'left-[1.125rem]' : 'left-0.5')
          }
        />
      </button>
    </div>
  )
}
