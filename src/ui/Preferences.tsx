import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from '../state/store'
import * as link from '../bridge/link'
import { currentVersion, checkForUpdate } from '../app/updater'

/** Set-once / rarely-touched settings — Cinema 4D setup and import defaults. */
export default function Preferences({ open, onClose }: { open: boolean; onClose: () => void }) {
  const autoMap = useStore((s) => s.autoMapOnImport)
  const setAutoMap = useStore((s) => s.setAutoMapOnImport)
  const setStatus = useStore((s) => s.setStatus)
  const [linkLabel, setLinkLabel] = useState(link.isConnected() ? link.linkFolderLabel() : '')
  const [linkCustom, setLinkCustom] = useState(false)
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState('')
  const [c4d, setC4d] = useState<link.C4DStatus | null>(null)
  const [blender, setBlender] = useState<link.BlenderStatus | null>(null)
  useEffect(() => {
    if (open) {
      void link.savedLabel().then(setSaved)
      void link.c4dStatus().then(setC4d)
      void link.blenderStatus().then(setBlender)
      setLinkLabel(link.linkFolderLabel())
      void link.isCustomLinkFolder().then(setLinkCustom)
    }
  }, [open])
  if (!open) return null

  const connect = async () => {
    setBusy('link')
    if (await link.connect()) {
      setLinkLabel(link.linkFolderLabel())
      void link.isCustomLinkFolder().then(setLinkCustom)
    }
    setBusy('')
  }
  // Desktop: drop the custom folder and return to the zero-config temp folder.
  const useDefaultFolder = async () => {
    setBusy('link')
    const label = await link.useDefaultLinkFolder()
    if (label !== null) {
      setLinkLabel(label)
      setLinkCustom(false)
    }
    setBusy('')
  }
  const install = async () => {
    setBusy('install')
    setStatus('Looking for Cinema 4D…')
    const res = await link.installC4DPluginLatest()
    if (res && 'error' in res) {
      setStatus(`Plugin install failed: ${res.error}`)
    } else if (res) {
      setStatus(`Installed C4D plugin → ${res.paths[0]} — restart C4D`)
    } else {
      setStatus('No Cinema 4D detected — use “Choose folder…” to pick its plugins folder')
    }
    void link.c4dStatus().then(setC4d)
    setBusy('')
  }
  // Re-route: let the user pick a specific plugins folder (non-standard install).
  const installToFolder = async () => {
    setBusy('install')
    setStatus('Choose your Cinema 4D “plugins” folder…')
    const res = await link.installC4DPluginToFolder()
    setStatus(res ? `Installed C4D plugin → ${res.paths[0]} — restart C4D` : 'Plugin install cancelled')
    void link.c4dStatus().then(setC4d)
    setBusy('')
  }
  // Install the Blender add-on into every detected Blender version.
  const installBlender = async () => {
    setBusy('blender')
    setStatus('Looking for Blender…')
    const paths = await link.installBlenderAddon()
    setStatus(
      paths
        ? `Installed Blender add-on (${paths.length} version${paths.length === 1 ? '' : 's'}) — enable it in Blender ▸ Preferences ▸ Add-ons`
        : 'No Blender found — install & launch Blender once, then retry',
    )
    void link.blenderStatus().then(setBlender)
    setBusy('')
  }
  // path is <prefs>/<Cinema 4D version>/plugins/UVStudioBridge — show the version
  const c4dName = (p: string | null) => (p ? p.split(/[/\\]/).slice(-3, -2)[0] || p : '')
  const checkUpdate = async () => {
    setBusy('update')
    const u = await checkForUpdate()
    if (u) {
      setStatus(`Update ${u.version} available — opening download…`)
      await link.openExternal(u.url)
    } else {
      setStatus(`Up to date — v${currentVersion}`)
    }
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
              {link.isDesktop() ? (
                <Row
                  label="Link folder"
                  hint={
                    linkCustom
                      ? `Custom · ${linkLabel || '—'} — the C4D plugin follows this folder`
                      : 'Automatic — a temp folder shared with the C4D plugin. Nothing to set up.'
                  }
                >
                  <div className="flex gap-2">
                    <Btn onClick={connect} busy={busy === 'link'}>
                      Choose folder…
                    </Btn>
                    {linkCustom && (
                      <Btn onClick={useDefaultFolder} busy={busy === 'link'}>
                        Use temp folder
                      </Btn>
                    )}
                  </div>
                </Row>
              ) : (
                <Row
                  label="Link folder"
                  hint={
                    linkLabel
                      ? `Connected · ${linkLabel}`
                      : saved
                        ? `Remembered · ${saved}`
                        : 'Pick the shared folder both apps hand files through'
                  }
                >
                  <Btn onClick={connect} busy={busy === 'link'}>
                    {linkLabel ? 'Change…' : saved ? 'Reconnect…' : 'Connect…'}
                  </Btn>
                </Row>
              )}
              {link.isDesktop() && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-fog-200">Plugin</div>
                      <div className="truncate text-[11px] text-fog-500">
                        {c4d?.installed
                          ? `Installed in ${c4dName(c4d.path)}${c4d.version ? ` · v${c4d.version}` : ''} ✓`
                          : c4d && !c4d.found
                            ? 'No Cinema 4D found — choose its plugins folder below'
                            : 'Not installed yet'}
                      </div>
                    </div>
                    <Btn onClick={install} busy={busy === 'install'}>
                      {c4d?.installed ? 'Reinstall' : 'Install'}
                    </Btn>
                  </div>
                  {/* Where it installs — visible and adjustable */}
                  <div className="flex items-center gap-2 rounded-md border border-line/70 bg-ink-800/60 px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 truncate text-[11px] text-fog-400" title={c4d?.path ?? ''}>
                      {c4d?.path ?? 'Pick a Cinema 4D plugins folder'}
                    </code>
                    <button
                      onClick={installToFolder}
                      disabled={busy === 'install'}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-brand-400 hover:text-brand-300 disabled:opacity-50 ring-focus"
                    >
                      Change…
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Section>

        {link.isDesktop() && (
          <Section title="Blender">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-fog-200">Add-on</div>
                  <div className="truncate text-[11px] text-fog-500">
                    {blender?.installed
                      ? 'Installed ✓ — enable it in Blender ▸ Preferences ▸ Add-ons'
                      : blender && !blender.found
                        ? 'No Blender found — launch Blender once, then Install'
                        : 'Not installed yet'}
                  </div>
                </div>
                <Btn onClick={installBlender} busy={busy === 'blender'}>
                  {blender?.installed ? 'Reinstall' : 'Install'}
                </Btn>
              </div>
              {blender?.path && (
                <div className="flex items-center rounded-md border border-line/70 bg-ink-800/60 px-2.5 py-1.5">
                  <code className="min-w-0 flex-1 truncate text-[11px] text-fog-400" title={blender.path}>
                    {blender.path}
                  </code>
                </div>
              )}
            </div>
          </Section>
        )}

        <Section title="Defaults">
          <Toggle
            label="Auto-map screens on import"
            hint="Fit each screen to its content the moment you import"
            checked={autoMap}
            onChange={setAutoMap}
          />
        </Section>

        <Section title="About">
          <Row label="Version" hint={`UV Studio v${currentVersion}`}>
            {link.isDesktop() && (
              <Btn onClick={checkUpdate} busy={busy === 'update'}>
                Check for updates
              </Btn>
            )}
          </Row>
          <div className="mt-3 flex flex-col items-center gap-1.5 text-xs text-fog-400">
            <span>Powered by</span>
            <img
              src="/trm_logo.webp"
              alt="Toy Robot Media"
              className="h-7 w-auto opacity-100"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
        </Section>
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

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
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
