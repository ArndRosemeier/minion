import { create } from 'zustand'
import { db } from '@/db/db'
import type { Advisor, AppSettings } from '@/types'

export const DEFAULT_ADVISORS: Advisor[] = [
  {
    id: 'adv_rules',
    name: 'Rules Sage',
    emoji: '📜',
    enabled: true,
    persona:
      'You are a meticulous rules expert for the campaign’s game system. Check encounter balance (XP budgets, creature levels/CR vs. party level), action economy, DCs, treasure by level and rules accuracy. Point out concrete problems and give concrete fixes with numbers.',
  },
  {
    id: 'adv_story',
    name: 'Storyteller',
    emoji: '🎭',
    enabled: true,
    persona:
      'You are a seasoned narrative designer. Judge themes, pacing, foreshadowing, NPC motivations, mysteries and payoffs. Suggest ways to make scenes more memorable and to tie loose threads together.',
  },
  {
    id: 'adv_players',
    name: 'Player Advocate',
    emoji: '🎲',
    enabled: true,
    persona:
      'You speak for the players at the table. Look for railroading, scenes where players have nothing to do, unclear goals, missing hooks for different character types, and frustrating dead-ends. Suggest player agency and fun.',
  },
  {
    id: 'adv_gm',
    name: 'Veteran GM',
    emoji: '🧙',
    enabled: false,
    persona:
      'You are a pragmatic veteran game master. Judge how easy this is to run at the table: prep load, clarity of information, what happens if players go off-script, improvisation aids, and what is missing for a smooth session.',
  },
]

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  chatModel: 'anthropic/claude-sonnet-5.5',
  fastModel: 'google/gemini-3.8-flash',
  imageModel: 'google/gemini-3.1-flash-image',
  advisors: DEFAULT_ADVISORS,
  autoLink: true,
  diceTheme: 'default',
  diceColor: '#b8862f',
  contextMode: 'auto',
}

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const row = await db.kv.get('settings')
    const stored = (row?.value ?? {}) as Partial<AppSettings>
    set({ settings: { ...DEFAULT_SETTINGS, ...stored }, loaded: true })
  },
  update: async (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    await db.kv.put({ key: 'settings', value: settings })
  },
}))

export const getSettings = () => useSettings.getState().settings
