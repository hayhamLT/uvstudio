import { useEffect, useRef } from 'react'

/** Everything inside a dialog that a keyboard user can land on. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Makes a hand-rolled overlay behave like a real modal dialog.
 *
 * The panels here are plain divs, which means that without this a screen
 * reader never announces them, Tab walks straight out of the dialog into the
 * app behind it, and focus is left wherever it happened to be when the dialog
 * closes. This adds the three things that fixes:
 *
 *  • the dialog role + name, so assistive tech announces what opened;
 *  • a focus trap, so Tab/⇧Tab cycle inside the panel;
 *  • focus restore, so closing returns the caret to whatever opened it.
 *
 * Escape is handled here too, in the CAPTURE phase, so the topmost dialog
 * consumes it instead of the app's global shortcut handler also reacting.
 *
 * Spread `dialogProps` onto the PANEL element (not the backdrop).
 */
export function useModalA11y(open: boolean, onClose: () => void, titleId: string) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null

    // move focus into the dialog (the first control, else the panel itself)
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (!items.length) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const active = document.activeElement
      // wrap at both ends, and pull focus back in if it escaped the panel
      if (e.shiftKey && (active === firstEl || !panel.current.contains(active))) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && (active === lastEl || !panel.current.contains(active))) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      opener?.focus?.()
    }
  }, [open, onClose])

  return {
    panelRef: panel,
    dialogProps: {
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': titleId,
      tabIndex: -1,
    },
  }
}
