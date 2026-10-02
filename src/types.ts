// Core domain types for Minion.

export type GameSystem = 'pf2e' | 'dnd5e'

export const SYSTEM_LABEL: Record<GameSystem, string> = {
  pf2e: 'Pathfinder 2e',
  dnd5e: 'D&D 5e',
}

// ---------------------------------------------------------------------------
// Stat blocks (shared by campaign creatures/NPCs and compendium creatures)
// ---------------------------------------------------------------------------

export type ActionKind =
  | 'action' // PF2e action (cost 1-3) or 5e action
  | 'reaction'
  | 'free'
  | 'bonus' // 5e bonus action
  | 'legendary' // 5e legendary action
  | 'passive' // abilities, auras, traits
  | 'spell'

export interface StatAction {
  name: string
  kind: ActionKind
  /** PF2e action cost 1-3 (for kind 'action'), or legendary action cost */
  cost?: number
  traits?: string[]
  /** attack bonus, e.g. "+7" or "+7 (agile)" */
  attack?: string
  /** damage formula, e.g. "1d8+4 slashing plus 1d6 fire" */
  damage?: string
  /** e.g. "DC 17 basic Reflex" */
  save?: string
  /** markdown description. May contain [[wikilinks]]. */
  text?: string
  /** for spells: name of the spell (resolved through links/compendium) and rank/level */
  spellLevel?: number
  /** for spells: e.g. "at will", "3/day", "constant", "cantrip" */
  frequency?: string
}

export interface StatBlock {
  /** PF2e creature level */
  level?: number
  /** 5e challenge rating, e.g. "1/2" */
  cr?: string
  size?: string
  /** PF2e traits or 5e "type", e.g. ["humanoid", "goblin"] */
  traits?: string[]
  alignment?: string
  ac: number
  acNote?: string
  hp: number
  hpNote?: string
  /** bonus added to the d20 when rolling initiative (PF2e: usually Perception, 5e: Dex mod) */
  initiative: number
  perception?: number
  speed?: string
  /** PF2e: Fort/Ref/Will. 5e: saving throw proficiencies */
  saves?: { name: string; value: number }[]
  /** 5e: ability SCORES (10 = +0). PF2e: ability MODIFIERS. */
  abilities?: { str: number; dex: number; con: number; int: number; wis: number; cha: number }
  skills?: string
  senses?: string
  languages?: string
  immunities?: string
  resistances?: string
  weaknesses?: string
  /** 5e: damage vulnerabilities, condition immunities etc. */
  other?: string
  /** spellcasting summary line, e.g. "Occult Innate Spells DC 20, attack +12" */
  spellcasting?: string
  actions: StatAction[]
}

// ---------------------------------------------------------------------------
// Compendium (bundled, read-only rules reference)
// ---------------------------------------------------------------------------

export type RefCategory = 'spell' | 'condition' | 'creature' | 'action' | 'item' | 'rule' | 'trait'

export interface RefEntry {
  /** stable slug, e.g. "pf2e-spell-fireball" */
  id: string
  system: GameSystem
  category: RefCategory
  name: string
  /** spell rank/level, item level, creature level */
  level?: number
  /** 5e creature CR */
  cr?: string
  traits?: string[]
  /** one short line, e.g. "Rank 3 · 2 actions · 500 ft · 20-ft burst" */
  summary?: string
  /** key facts rendered as a small table: Cast, Range, Area, Duration, Defense, Price ... */
  meta?: Record<string, string>
  /** markdown body, may contain [[wikilinks]] to other compendium entries */
  text: string
  /** creatures only */
  stats?: StatBlock
  /** book name */
  source?: string
}

export interface CompendiumManifest {
  system: GameSystem
  generatedAt: string
  license: string
  attribution: string
  categories: { category: RefCategory; file: string; count: number }[]
}

// ---------------------------------------------------------------------------
// Campaign data
// ---------------------------------------------------------------------------

export type EntityType =
  | 'chapter'
  | 'scene'
  | 'location'
  | 'dungeon'
  | 'npc'
  | 'creature'
  | 'faction'
  | 'item'
  | 'spell'
  | 'encounter'
  | 'handout'
  | 'rule'
  | 'note'

export interface EncounterCreature {
  /** campaign entity id (creature/npc) or compendium ref id */
  refId: string
  name: string
  count: number
}

export interface Entity {
  id: string
  campaignId: string
  type: EntityType
  name: string
  aliases: string[]
  /** one-line summary used in lists and in AI context index */
  summary: string
  /** main markdown body with [[wikilinks]] */
  body: string
  /** GM-only secrets (never shown to players) */
  secrets?: string
  tags: string[]
  /** asset ids of illustrations; first is the main image */
  images: string[]
  stats?: StatBlock
  /** party level while this is played (chapters, scenes, encounters, dungeons); inherited by children */
  level?: number
  /** chapters/scenes ordering */
  order?: number
  /** scene -> chapter, sub-location -> location */
  parentId?: string
  /** dungeon specifics (rooms are locations with parentId = dungeon) */
  dungeon?: {
    /** overview battle map */
    mapId?: string
    /** floor plan size in 5-ft squares */
    cols?: number
    rows?: number
    rooms?: DungeonRoom[]
    passages?: { from: string; to: string; points: [number, number][]; width: number }[]
  }
  /** encounter specifics */
  encounter?: {
    creatures: EncounterCreature[]
    mapId?: string
    difficulty?: string
    tactics?: string
  }
  createdAt: number
  updatedAt: number
}

export interface PartyMember {
  id: string
  name: string
  player?: string
  /** e.g. "Elf Wizard 2" */
  description?: string
  initBonus: number
  maxHp?: number
  ac?: number
  color: string
  image?: string
}

export type AutomationMode = 'manual' | 'assisted' | 'auto'

export interface Campaign {
  id: string
  name: string
  system: GameSystem
  /** language for all AI generated content, e.g. "Deutsch" */
  language: string
  premise: string
  /** style/tone notes given to every AI call */
  tone: string
  partyLevel: number
  partySize: number
  party: PartyMember[]
  coverImage?: string
  /** campaign-specific art for read-only rules entries (refId -> asset ids, first is main) */
  refImages?: Record<string, string[]>
  /** module builder brief */
  brief?: { scope: string; notes: string; toLevel?: number }
  /** pipeline step status (done marks) */
  pipelineDone?: Record<string, boolean>
  /** pipeline step modes, keyed by step id */
  pipeline: Record<string, AutomationMode>
  /** visual style for illustrations and maps */
  artStyle: string
  /** extra instructions for the AI applied to everything (house rules, homebrew policy...) */
  aiInstructions: string
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Battle maps
// ---------------------------------------------------------------------------

export interface Condition {
  name: string
  value?: number
}

export interface Token {
  id: string
  kind: 'pc' | 'monster' | 'npc' | 'object'
  name: string
  /** party member id, campaign entity id or compendium id */
  refId?: string
  /** grid coordinates (cell units, top-left of token) */
  x: number
  y: number
  /** size in cells (1 = medium) */
  size: number
  hp?: number
  maxHp?: number
  tempHp?: number
  ac?: number
  initBonus?: number
  initiative?: number
  conditions: Condition[]
  /** hidden from players */
  hidden?: boolean
  color: string
  image?: string
  /** short label shown on token, e.g. "G2" */
  label?: string
}

export interface DungeonRoom {
  /** short key like "A1" */
  key: string
  locationId: string
  /** outline polygon in squares on the overview map */
  shape: [number, number][]
  encounterId?: string
  mapId?: string
}

export interface MapLink {
  id: string
  /** rectangle in image pixels */
  x: number
  y: number
  w: number
  h: number
  label: string
  targetMapId?: string
  /** location (room) described by this area */
  locationId?: string
}

export interface MapState {
  tokens: Token[]
  /** asset id of fog mask PNG (white = fogged), undefined = no fog */
  fog?: string
  fogEnabled: boolean
  combat: {
    active: boolean
    round: number
    /** token id whose turn it is */
    turnId?: string
  }
}

export interface BattleMap {
  id: string
  campaignId: string
  name: string
  description: string
  /** image asset id */
  image?: string
  width: number
  height: number
  grid: {
    /** cell size in image pixels */
    size: number
    offsetX: number
    offsetY: number
    visible: boolean
    color: string
    opacity: number
  }
  parentId?: string
  /** linked location / encounter entities */
  locationId?: string
  encounterId?: string
  links: MapLink[]
  /** the prompt used to generate the image */
  prompt?: string
  /** encounter creatures/party were auto-placed once (never re-placed automatically) */
  seeded?: boolean
  initialState: MapState
  state: MapState
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Assets, chat, history, settings
// ---------------------------------------------------------------------------

export interface Asset {
  id: string
  campaignId?: string
  mime: string
  blob: Blob
  width?: number
  height?: number
  prompt?: string
  createdAt: number
}

export type ChatRole = 'user' | 'assistant' | 'advisor' | 'tool' | 'system'

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatMessage {
  id: string
  campaignId: string
  /** chat thread id (a campaign can have several threads) */
  threadId: string
  role: ChatRole
  content: string
  /** advisor message produced inside a tool call (already part of the tool result) */
  viaTool?: boolean
  /** advisor display name */
  advisor?: string
  model?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  /** change batch created by this message's tool calls */
  changeBatch?: string
  images?: string[]
  error?: string
  cost?: number
  createdAt: number
}

export interface ChatThread {
  id: string
  campaignId: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface ChangeRecord {
  id: string
  campaignId: string
  batchId: string
  /** human readable */
  label: string
  table: 'entities' | 'maps' | 'campaigns'
  recordId: string
  before?: unknown
  after?: unknown
  source: 'user' | 'ai'
  createdAt: number
  undone?: boolean
}

export interface Advisor {
  id: string
  name: string
  emoji: string
  persona: string
  model?: string
  enabled: boolean
}

export interface AppSettings {
  apiKey: string
  chatModel: string
  fastModel: string
  imageModel: string
  advisors: Advisor[]
  autoLink: boolean
  diceTheme: string
  diceColor: string
  /** 'full' = send everything when small enough, 'index' = index + lookups */
  contextMode: 'auto' | 'full' | 'index'
  /** max simultaneous AI requests per lane (text / images); default 4 */
  parallelRequests?: number
  /** show the live AI activity overlay automatically (default on) */
  showAiActivity?: boolean
  /** recently used models, most recent first */
  recentModels?: { chat: string[]; image: string[] }
}
