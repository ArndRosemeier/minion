import type { BattleMap, Campaign, Entity } from '@/types'
import { SYSTEM_LABEL } from '@/types'
import type { EntityType } from '@/types'
import { ENTITY_TYPES } from '@/lib/entityTypes'
import { getSettings } from '@/state/settings'

/** Sections of the GM's preferences; each applies when the AI creates entries of its types. */
export const PREF_SECTIONS: { id: string; label: string; hint: string; types: EntityType[] }[] = [
  { id: 'story', label: 'Story, chapters & scenes', hint: 'Plot, pacing, tone, read-aloud style, how much railroading…', types: ['chapter', 'scene', 'handout', 'note'] },
  { id: 'npcs', label: 'NPCs & factions', hint: 'Kinds of characters, names, voices, villains…', types: ['npc', 'faction'] },
  { id: 'locations', label: 'Locations', hint: 'Settlements, places, level of detail…', types: ['location'] },
  { id: 'dungeons', label: 'Dungeons', hint: 'Size, layout, traps, puzzles…', types: ['dungeon'] },
  { id: 'encounters', label: 'Encounters & combat', hint: 'Difficulty, number of fights, enemy types, terrain…', types: ['encounter'] },
  { id: 'creatures', label: 'Creatures & monsters', hint: 'Official vs. homebrew, themes, what to avoid…', types: ['creature'] },
  { id: 'items', label: 'Items, spells & rules', hint: 'Treasure amount, magic items, house rules…', types: ['item', 'spell', 'rule'] },
  { id: 'images', label: 'Images & battle maps', hint: 'Art direction, what pictures should or should not show…', types: [] },
]

/**
 * The GM's standing preferences for a prompt: always the global part, plus the sections for the given
 * entry types ('all' = every section) and optionally images. Empty string when nothing applies.
 */
export function gmPreferences(types: EntityType[] | 'all', images = false): string {
  const p = getSettings().preferences
  if (!p) return ''
  const parts: string[] = []
  if (p.global?.trim()) parts.push(p.global.trim())
  for (const sec of PREF_SECTIONS) {
    const text = p.sections?.[sec.id]?.trim()
    if (!text) continue
    const applies = types === 'all' ? sec.id !== 'images' || images : sec.id === 'images' ? images : sec.types.some((t) => types.includes(t))
    if (applies) parts.push(`${sec.label}:\n${text}`)
  }
  if (!parts.length) return ''
  return `GM'S PREFERENCES — the GM's standing wishes for everything you create. Always follow them; they take precedence over the general guidance above (but not over explicit instructions for this specific request):\n${parts.join('\n\n')}`
}

export const STATBLOCK_SCHEMA = `StatBlock = {
  level?: number            // PF2e creature level
  cr?: string               // 5e challenge rating, e.g. "1/2"
  size?: string, traits?: string[], alignment?: string
  ac: number, acNote?: string, hp: number, hpNote?: string
  initiative: number        // bonus to the d20 initiative roll (PF2e: Perception, 5e: Dex mod)
  perception?: number, speed?: string
  saves?: {name: string, value: number}[]   // PF2e: Fort/Ref/Will
  abilities?: {str,dex,con,int,wis,cha: number}  // 5e: SCORES (10 = +0); PF2e: MODIFIERS
  skills?: string, senses?: string, languages?: string
  immunities?: string, resistances?: string, weaknesses?: string, other?: string
  spellcasting?: string     // e.g. "Divine Prepared Spells DC 19, attack +11"
  actions: {
    name: string
    kind: "action"|"reaction"|"free"|"bonus"|"legendary"|"passive"|"spell"
    cost?: number           // PF2e actions 1-3
    traits?: string[]
    attack?: string         // e.g. "+9"
    damage?: string         // e.g. "1d8+4 slashing plus 1d6 fire"
    save?: string           // e.g. "DC 18 basic Reflex"
    text?: string           // markdown rules text, use [[wikilinks]] for conditions/spells
    spellLevel?: number, frequency?: string   // for kind "spell" (name = exact spell name)
  }[]
}`

export const ENTITY_FIELDS_DOC = `Entity fields:
- type: one of ${Object.keys(ENTITY_TYPES).join(', ')}
- name (string), aliases (string[] — other names the text uses for it), summary (one line), tags (string[])
- body (markdown; the main content shown to the GM. Use "> " blockquotes for read-aloud text to players.)
- secrets (markdown; GM-only secrets, twists, hidden info)
- parentId (scene -> its chapter id; sub-location -> parent location id)
- order (number; ordering of chapters and of scenes within a chapter)
- level (number; the party level while this chapter/scene/encounter/dungeon is played — children inherit it)
- stats (StatBlock, for creatures and NPCs that may fight)
- dungeon: complex sites (rooms are locations with parent = dungeon). Build dungeons and finished encounters with the generate_complete tool.
- encounter ({ creatures: {refId, name, count}[], difficulty?, tactics? } for type "encounter"; refId is a campaign entity id or compendium id; name is the creature name)`

export function languageRule(c: Campaign) {
  const lang = c.language?.trim() || 'English'
  return `LANGUAGE: Write all narrative and descriptive content (story text, descriptions, dialogue, names of places/people where fitting, summaries, secrets) in ${lang}. Keep game-mechanical terms in English exactly as in the official rules (spell names, conditions, actions, traits, skills, rules creature names) so they link to the rules reference. Talk to the GM in ${lang} too unless they write to you in another language.`
}

export const LINK_RULES = `WIKILINKS: The app turns [[Name]] into tappable chips that open full details, so the GM never needs a book.
- Wrap EVERY reference to a rules element in [[ ]]: spells ([[Fireball]]), conditions ([[Frightened]] 2 → write "[[Frightened]] 2"), actions ([[Grapple]]), creatures ([[Goblin Warrior]]), items, traits.
- Wrap references to campaign entities too: [[Name]] or [[Name|displayed text]]. Use a prefix to disambiguate if needed: [[spell:Light]], [[npc:Mara]], [[location:Old Mill]].
- Every [[link]] should resolve to a campaign entity or an official rules entry. If you reference something that exists in neither, create it as a homebrew entity (spell, item, creature, rule...).
- Never tell the GM to look something up in a book; put what they need into the text or a linked entity.`

export function campaignHeader(c: Campaign) {
  const party = c.party.length
    ? c.party.map((p) => `${p.name}${p.description ? ` (${p.description})` : ''}`).join('; ')
    : `${c.partySize} characters (not yet defined)`
  return [
    `CAMPAIGN: "${c.name}" — ${SYSTEM_LABEL[c.system]}`,
    `Party: level ${c.partyLevel}, ${c.partySize} PCs: ${party}`,
    c.premise && `Premise: ${c.premise}`,
    c.tone && `Tone & style: ${c.tone}`,
    c.aiInstructions && `GM instructions for the AI (always follow): ${c.aiInstructions}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function entityIndexLine(e: Entity) {
  const extra = [
    e.parentId && `parent=${e.parentId}`,
    e.order !== undefined && `order=${e.order}`,
    e.level !== undefined && `party level ${e.level}`,
    e.stats && (e.stats.level !== undefined ? `lvl ${e.stats.level}` : e.stats.cr ? `CR ${e.stats.cr}` : 'stats'),
    e.images.length ? `${e.images.length} img` : '',
  ]
    .filter(Boolean)
    .join(', ')
  return `- [${e.type}] ${e.name} (id=${e.id}${extra ? ', ' + extra : ''})${e.aliases.length ? ` aka ${e.aliases.join(', ')}` : ''}: ${e.summary || '(no summary)'}`
}

export function entityFull(e: Entity) {
  const { campaignId: _c, createdAt: _a, updatedAt: _u, ...rest } = e
  void _c
  void _a
  void _u
  return JSON.stringify(rest)
}

export function mapIndexLine(m: BattleMap) {
  return `- [map] ${m.name} (id=${m.id}${m.parentId ? `, parent=${m.parentId}` : ''}${m.encounterId ? `, encounter=${m.encounterId}` : ''}${m.image ? '' : ', NO IMAGE YET'}, grid ${Math.round(m.width / m.grid.size)}x${Math.round(m.height / m.grid.size)}): ${m.description.slice(0, 160)}`
}

const FULL_CONTEXT_LIMIT = 120_000

/** Build the campaign knowledge block. Sends everything when small enough, otherwise an index. */
export function campaignKnowledge(
  c: Campaign,
  entities: Entity[],
  maps: BattleMap[],
  mode: 'auto' | 'full' | 'index',
): { text: string; full: boolean } {
  const sorted = [...entities].sort((a, b) => a.type.localeCompare(b.type) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))
  const index = sorted.map(entityIndexLine).join('\n')
  const mapIdx = maps.map(mapIndexLine).join('\n')
  const fullDump = sorted.map(entityFull).join('\n')
  const full = mode === 'full' || (mode === 'auto' && fullDump.length < FULL_CONTEXT_LIMIT)
  const parts = [
    campaignHeader(c),
    `\nENTITY INDEX (${entities.length}):\n${index || '(empty — nothing created yet)'}`,
    maps.length ? `\nBATTLE MAPS:\n${mapIdx}` : '',
    full && entities.length
      ? `\nFULL CONTENT OF ALL ENTITIES (JSON, one per line):\n${fullDump}`
      : entities.length
        ? '\n(Only the index is included. Use read_entities to read full content before editing.)'
        : '',
  ]
  return { text: parts.join('\n'), full }
}
