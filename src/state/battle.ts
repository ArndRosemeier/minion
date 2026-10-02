import { create } from 'zustand'
import type { StatBlock, Token } from '@/types'

export interface SpawnRequest {
  kind: Token['kind']
  name: string
  refId?: string
  stats?: StatBlock
  image?: string
  count?: number
}

export type ApplyMode = 'damage' | 'heal' | 'half'

interface BattleState {
  campaignId: string | null
  setCampaign: (id: string | null) => void
  /** map currently open in the battle view */
  activeMapId: string | null
  setActiveMap: (id: string | null) => void
  openMap: (mapId: string) => void

  selection: string[]
  setSelection: (ids: string[]) => void

  pendingSpawn: SpawnRequest | null
  requestSpawn: (s: SpawnRequest) => void
  clearSpawn: () => void

  /** registered by the active map view */
  applyHandler: ((amount: number, mode: ApplyMode) => void) | null
  setApplyHandler: (fn: ((amount: number, mode: ApplyMode) => void) | null) => void
}

export const useBattle = create<BattleState>((set, get) => ({
  campaignId: null,
  setCampaign: (campaignId) => set({ campaignId }),
  activeMapId: null,
  setActiveMap: (activeMapId) => set({ activeMapId }),
  openMap: (mapId) => {
    const c = get().campaignId
    if (c) window.location.hash = `#/c/${c}/battle/${mapId}`
  },
  selection: [],
  setSelection: (selection) => set({ selection }),
  pendingSpawn: null,
  requestSpawn: (pendingSpawn) => set({ pendingSpawn }),
  clearSpawn: () => set({ pendingSpawn: null }),
  applyHandler: null,
  setApplyHandler: (applyHandler) => set({ applyHandler }),
}))
