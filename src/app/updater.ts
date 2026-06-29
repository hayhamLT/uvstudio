/**
 * Update check for the desktop app.
 *
 * The repo is PUBLIC, so we read the latest GitHub release directly (version +
 * downloadable installer assets) and can fetch the installer in-app. On launch
 * we compare the latest tag to this build; if newer, the banner downloads the
 * platform installer and opens it. The bundled C4D plugin tracks the app
 * version, so updating the app updates the plugin too.
 */

const RELEASE_API = 'https://api.github.com/repos/hayhamLT/uvstudio/releases/latest'
const FALLBACK_RELEASE_URL = 'https://github.com/hayhamLT/uvstudio/releases/latest'

export type UpdateAsset = { name: string; url: string }
export type UpdateInfo = { version: string; url: string; assets: UpdateAsset[] }

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

type GhRelease = {
  tag_name?: string
  html_url?: string
  assets?: { name: string; browser_download_url: string }[]
}

/** Returns update info if a newer app version is available, else null. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(RELEASE_API, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const j = (await res.json()) as GhRelease
    const latest = String(j.tag_name ?? '').replace(/^v/, '')
    if (!latest || cmpVersion(latest, __APP_VERSION__) <= 0) return null
    const assets: UpdateAsset[] = (j.assets ?? []).map((a) => ({
      name: a.name,
      url: a.browser_download_url,
    }))
    return { version: latest, url: j.html_url || FALLBACK_RELEASE_URL, assets }
  } catch {
    return null // offline / blocked — never bother the user
  }
}

export const currentVersion = __APP_VERSION__
