// ---------------------------------------------------------------------------
// Cross-cutting UI state: the status line, toasts, the shared UV version
// counter, and which edit / view mode each viewport is in.
//
// A zustand slice: it receives the FULL store's set/get, so it can still call
// across to other slices (auto-map pushes an undo step, an import kicks off a
// mapping run). `AppState` stays a single interface — splitting the contract
// as well would buy nothing and make every cross-slice call a type puzzle.
// ---------------------------------------------------------------------------
import type { StateCreator } from 'zustand'
import type { AppState } from '../store'

let toastCounter = 0

export type UiSlice = Pick<
  AppState,
  | 'status'
  | 'toasts'
  | 'uvVersion'
  | 'hasUV'
  | 'isPacked'
  | 'view3d'
  | 'setView3d'
  | 'cullBackface'
  | 'setCullBackface'
  | 'editMode'
  | 'mapSelection'
  | 'setEditMode'
  | 'setMapSelection'
  | 'clearMapSelection'
  | 'setStatus'
  | 'pushToast'
  | 'dismissToast'
>

export const createUiSlice: StateCreator<AppState, [], [], UiSlice> = (set, get) => ({
  status: 'Load a model to begin',
  toasts: [],
  uvVersion: 0,
  hasUV: false,
  isPacked: false,
  view3d: 'shaded',
  setView3d: (m) => set({ view3d: m }),
  cullBackface: true,
  setCullBackface: (v) => set({ cullBackface: v }),
  editMode: 'object',
  mapSelection: new Set(),
  setEditMode: (m) => set({ editMode: m }),
  setMapSelection: (s) => set({ mapSelection: s }),
  clearMapSelection: () => set({ mapSelection: new Set() }),
  setStatus: (s) => set({ status: s }),
  pushToast: (kind, msg) =>
    // keep at most 4 on screen — older ones roll off the top of the stack
    set({ toasts: [...get().toasts.slice(-3), { id: ++toastCounter, kind, msg }] }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
})
