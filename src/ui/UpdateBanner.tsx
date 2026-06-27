import { useState } from 'react'
import * as link from '../bridge/link'
import type { UpdateInfo } from '../app/updater'
import { currentVersion } from '../app/updater'

/** A small modal shown on launch when a newer desktop build is available.
 *  Download opens the release page in the browser, then quits the app so the
 *  user can install the freshly downloaded build. */
export default function UpdateBanner({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    await link.openExternal(info.url)
    // give the browser a moment to take focus, then close so the installer can replace the app
    setTimeout(() => void link.quitApp(), 600)
  }
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-ink-950/70 backdrop-blur-sm">
      <div className="glass w-[420px] max-w-[92vw] animate-float-up rounded-2xl p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-fog-100">Update available</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fog-300">
          UV Studio <span className="text-fog-100">{info.version}</span> is out — you have{' '}
          <span className="text-fog-100">{currentVersion}</span>. Downloading opens the release in your
          browser and closes the app so you can install it. The Cinema&nbsp;4D plugin updates with it.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[12px] text-fog-300 hover:bg-ink-700 hover:text-fog-100 disabled:opacity-50"
          >
            Later
          </button>
          <button
            onClick={download}
            disabled={busy}
            className="rounded-md border border-line bg-brand-500/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-500 disabled:opacity-50 ring-focus"
          >
            {busy ? 'Opening…' : 'Download & quit'}
          </button>
        </div>
      </div>
    </div>
  )
}
