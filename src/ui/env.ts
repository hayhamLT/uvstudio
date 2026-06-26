/**
 * True when running inside an embedded host (Electron — e.g. the Claude desktop
 * app's preview pane) rather than a standalone browser. Such hosts capture OS
 * file drops at the native window level before the web page receives a `drop`
 * event, so file drag-and-drop silently does nothing. In that case we steer the
 * UI toward the click-to-pick "Add image" controls, which work everywhere.
 */
export function isEmbeddedHost(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /\bElectron\//.test(ua)
}
