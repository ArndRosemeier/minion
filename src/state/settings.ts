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

/** Ready-made personas the GM can add in Settings (beyond the defaults). */
export const ADVISOR_PRESETS: Advisor[] = [
  ...DEFAULT_ADVISORS,
  {
    id: 'adv_continuity',
    name: 'Continuity Keeper',
    emoji: '🧵',
    enabled: true,
    persona:
      'You guard consistency. Look for contradictions between chapters, scenes, NPCs and locations: names, dates, who knows what, where things are, dead NPCs reappearing, clues that are never planted or never paid off. Quote the conflicting passages and say which version to keep.',
  },
  {
    id: 'adv_villain',
    name: 'Villain’s Advocate',
    emoji: '😈',
    enabled: true,
    persona:
      'You think like the antagonists. Judge whether villains and opposing factions act smart and proactively: what they want, what they do when the party is not looking, how they react to the party’s moves. Point out where they are passive or stupid, and suggest clever counter-moves.',
  },
  {
    id: 'adv_tone',
    name: 'Atmosphere Critic',
    emoji: '🕯️',
    enabled: true,
    persona:
      'You judge mood and prose. Check that read-aloud texts are vivid but short, use all senses, fit the campaign’s tone, and avoid clichés and purple prose. Suggest concrete rewrites for weak passages.',
  },
  {
    id: 'adv_newplayer',
    name: 'New Player',
    emoji: '🐣',
    enabled: true,
    persona:
      'You read as a player new to tabletop RPGs. Point out where goals, rules moments or choices would confuse a beginner, where the party could get stuck, and where a hint, a recap or a clearer hook would help.',
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
  /** remember a model as recently used (most recent first) */
  rememberModel: (kind: 'chat' | 'image', id: string) => Promise<void>
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
  rememberModel: async (kind, id) => {
    if (!id) return
    const recent = recentModels(get().settings)
    const list = [id, ...recent[kind].filter((x) => x !== id)].slice(0, 10)
    await get().update({ recentModels: { ...recent, [kind]: list } })
  },
}))

/** Recent models; seeded with the currently configured ones. */
export function recentModels(s: AppSettings): { chat: string[]; image: string[] } {
  const r = s.recentModels ?? { chat: [], image: [] }
  const add = (list: string[], ids: string[]) => [...list, ...ids.filter((id) => id && !list.includes(id))]
  return {
    chat: add(r.chat, [s.chatModel, s.fastModel, ...s.advisors.map((a) => a.model ?? '')]),
    image: add(r.image, [s.imageModel]),
  }
}

export const getSettings = () => useSettings.getState().settings
