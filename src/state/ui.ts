import { create } from 'zustand'
import type { LinkTarget } from '@/lib/links'
import { newId } from '@/lib/id'

export interface Showcase {
  title?: string
  image?: string
  /** markdown read-aloud text */
  text?: string
}

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'success'
}

export interface DiceRequest {
  formula: string
  label?: string
  /** when set, offer damage/heal to the currently selected tokens */
  damageType?: string
}

export interface RollResult {
  id: string
  formula: string
  label?: string
  total: number
  dice: { sides: number; value: number }[]
  modifier: number
  at: number
}

interface UIState {
  drawer: LinkTarget[]
  openDetail: (t: LinkTarget, opts?: { reset?: boolean }) => void
  popDetail: () => void
  closeDetail: () => void

  showcase: Showcase | null
  show: (s: Showcase | null) => void

  toasts: Toast[]
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void

  chatDraft: string
  setChatDraft: (s: string) => void

  diceOpen: boolean
  diceRequest: DiceRequest | null
  rolls: RollResult[]
  openDice: (req?: DiceRequest) => void
  closeDice: () => void
  addRoll: (r: RollResult) => void
}

export const useUI = create<UIState>((set) => ({
  drawer: [],
  openDetail: (t, opts) =>
    set((s) => {
      if (opts?.reset) return { drawer: [t] }
      const top = s.drawer[s.drawer.length - 1]
      if (top && JSON.stringify(top) === JSON.stringify(t)) return s
      return { drawer: [...s.drawer, t].slice(-12) }
    }),
  popDetail: () => set((s) => ({ drawer: s.drawer.slice(0, -1) })),
  closeDetail: () => set({ drawer: [] }),

  showcase: null,
  show: (showcase) => set({ showcase }),

  toasts: [],
  toast: (text, kind = 'info') => {
    const id = newId()
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 3500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  chatDraft: '',
  setChatDraft: (chatDraft) => set({ chatDraft }),

  diceOpen: false,
  diceRequest: null,
  rolls: [],
  openDice: (req) => set({ diceOpen: true, diceRequest: req ?? null }),
  closeDice: () => set({ diceOpen: false, diceRequest: null }),
  addRoll: (r) => set((s) => ({ rolls: [r, ...s.rolls].slice(0, 30) })),
}))

export const toast = (text: string, kind?: Toast['kind']) => useUI.getState().toast(text, kind)
