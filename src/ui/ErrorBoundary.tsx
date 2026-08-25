import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  info: string
}

/**
 * Last line of defence for the whole tool.
 *
 * UV Studio is a desktop-style app where a session holds work that exists
 * nowhere else yet — an unexported mapping. Without a boundary, one throw in
 * any render (a malformed GLB reaching the viewport, a texture that decoded to
 * zero pixels) unmounts the tree and leaves a white window, taking that work
 * with it and giving the user nothing to report.
 *
 * "Try to recover" re-mounts the tree WITHOUT clearing the store, so the
 * mapping usually survives — the failure is nearly always in a viewport's
 * render, not in the document itself. If it throws again the user still has
 * the details and can export or restart.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // keep it in the console for a bug report / devtools session
    console.error('UV Studio crashed:', error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  private report = () => {
    const { error, info } = this.state
    const body = [
      `**Version:** ${__APP_VERSION__}`,
      `**Agent:** ${navigator.userAgent}`,
      '',
      '```',
      String(error?.stack || error),
      info.trim(),
      '```',
    ].join('\n')
    void navigator.clipboard?.writeText(body)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-950 p-6 text-fog-100"
      >
        <div className="glass w-[520px] max-w-full rounded-2xl p-6 shadow-2xl">
          <h1 className="text-lg font-semibold">UV Studio hit an unexpected error</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-fog-300">
            Your mapping is still in memory. Try to recover — if that works, export straight away.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-ink-900/80 p-3 text-[11px] leading-relaxed text-fog-400">
            {String(error.message || error)}
          </pre>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={this.report}
              className="rounded-md px-3 py-1.5 text-[12px] text-fog-300 ring-focus hover:bg-ink-700 hover:text-fog-100"
            >
              Copy details
            </button>
            <button
              onClick={() => location.reload()}
              className="rounded-md px-3 py-1.5 text-[12px] text-fog-300 ring-focus hover:bg-ink-700 hover:text-fog-100"
            >
              Restart
            </button>
            <button
              onClick={() => this.setState({ error: null, info: '' })}
              className="rounded-md border border-line bg-brand-500/90 px-3 py-1.5 text-[12px] font-medium text-white ring-focus hover:bg-brand-500"
            >
              Try to recover
            </button>
          </div>
        </div>
      </div>
    )
  }
}
