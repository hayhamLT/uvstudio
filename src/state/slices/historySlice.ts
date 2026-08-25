// ---------------------------------------------------------------------------
// Undo / redo. The snapshot machinery itself lives in ./history.ts; this
// is only the store-facing wiring.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'
import { redoStack, restoreDoc, snapshotDoc, trimHistory, undoStack } from '../history'

export type HistorySlice = Pick<AppState, 'undoCount' | 'redoCount' | 'pushUndo' | 'undo' | 'redo'>

export const createHistorySlice: StateCreator<AppState, [], [], HistorySlice> = (set, get) => ({
  undoCount: 0,
  redoCount: 0,
  pushUndo: () => {
    undoStack.push(snapshotDoc(get()))
    trimHistory(undoStack)
    redoStack.length = 0
    set({ undoCount: undoStack.length, redoCount: 0 })
  },
  undo: () => {
    if (!undoStack.length) return
    redoStack.push(snapshotDoc(get()))
    trimHistory(redoStack)
    const snap = undoStack.pop()!
    restoreDoc(snap, set, get())
    set({ undoCount: undoStack.length, redoCount: redoStack.length, status: 'Undo' })
  },
  redo: () => {
    if (!redoStack.length) return
    undoStack.push(snapshotDoc(get()))
    trimHistory(undoStack)
    const snap = redoStack.pop()!
    restoreDoc(snap, set, get())
    set({ undoCount: undoStack.length, redoCount: redoStack.length, status: 'Redo' })
  },
})
