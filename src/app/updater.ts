/**
 * Lightweight update check for the desktop app.
 *
 * On launch we fetch a tiny PUBLIC manifest published by the web build to
 * uv.preshow.link/version.json (the repo is private, so the binaries can't be
 * pulled in-app without auth — instead we just detect a newer version and send
 * the user to the release page to download). The bundled C4D plugin tracks the
 * app version, so updating the app updates the plugin too.
 */

const VERSION_URL = 'https://uv.preshow.link/version.json'
const FALLBACK_RELEASE_URL = 'https://github.com/hayhamLT/uvstudio/releases/latest'

export type UpdateInfo = { version: string; url: string }

/** Compare dotted numeric versions. >0 if a is newer than b. */
function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Returns update info if a newer app version is available, else null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' })
    if (!res.ok) return null
    const j = (await res.json()) as { app?: string; url?: string }
    const latest = String(j.app ?? '')
    if (latest && cmpVersion(latest, __APP_VERSION__) > 0) {
      return { version: latest, url: j.url || FALLBACK_RELEASE_URL }
    }
    return null
  } catch {
    return null // offline / blocked — never bother the user
  }
}

export const currentVersion = __APP_VERSION__
