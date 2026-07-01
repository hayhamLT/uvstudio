import { useState } from 'react'
import * as link from '../bridge/link'
import type { UpdateInfo } from '../app/updater'
import { currentVersion } from '../app/updater'

/** A small modal shown on launch when a newer desktop build is available.
 *  Preferred path: the SIGNED auto-updater — verify, install in place, relaunch
 *  (no dmg-dragging). Fallbacks: download + open the installer, then the release
 *  page in the browser. */
export default function UpdateBanner({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [busy, setBusy] = useState('')
  const update = async () => {
    setBusy('Updating…')
    try {
      // one-click: verified download + in-place install + relaunch
      await link.updaterInstall()
      return // unreachable on success — the app relaunches
    } catch {
      /* updater unavailable (older build / missing latest.json) → manual path */
    }
    setBusy('Downloading…')
    try {
      await link.downloadAndOpenUpdate(info.assets)
      setBusy('Opening installer…')
    } catch {
      // download/asset issue → open the release page so the user can grab it
      await link.openExternal(info.url)
    }
    // close so the installer can replace the app
    setTimeout(() => void link.quitApp(), 800)
  }
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
      <div className="glass w-[420px] max-w-[92vw] animate-float-up rounded-2xl p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-fog-100">Update available</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fog-300">
          UV Studio <span className="text-fog-100">{info.version}</span> is out — you have{' '}
          <span className="text-fog-100">{currentVersion}</span>. One click installs it and relaunches
          the app. The Cinema&nbsp;4D / Blender plugins update with it.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={!!busy}
            className="rounded-md px-3 py-1.5 text-[12px] text-fog-300 hover:bg-ink-700 hover:text-fog-100 disabled:opacity-50"
          >
            Later
          </button>
          <button
            onClick={update}
            disabled={!!busy}
            className="rounded-md border border-line bg-brand-500/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-500 disabled:opacity-50 ring-focus"
          >
            {busy || 'Update & relaunch'}
          </button>
        </div>
      </div>
    </div>
  )
}
