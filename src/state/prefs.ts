// ---------------------------------------------------------------------------
// Namespaced localStorage preferences.
//
// Every read is wrapped: Safari in private mode and a locked-down WebView both
// THROW on localStorage access rather than returning null, and a preference is
// never important enough to take the app down with it.
// ---------------------------------------------------------------------------

// persisted boolean preferences (localStorage, namespaced)
export const prefBool = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem('uvstudio.' + k)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}

// persisted string preferences (localStorage, namespaced)
export const prefStr = (k: string, d: string) => {
  try {
    const v = localStorage.getItem('uvstudio.' + k)
    return v === null ? d : v
  } catch {
    return d
  }
}
