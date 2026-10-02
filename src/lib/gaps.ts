import { extractLinks, resolveLink, type EntityIndex } from './links'
import { resolveCreature } from './creatures'
import { ENTITY_TYPES } from './entityTypes'
import { encounterForMap, needsSeeding } from './encounterSetup'
import { creaturesWithoutArt } from './creatureArt'
import type { BattleMap, Campaign, Entity, EntityType } from '@/types'

export type GapKind =
  | 'links'
  | 'encStructure'
  | 'dungeons'
  | 'encCreatures'
  | 'statsCreature'
  | 'statsNpc'
  | 'summaries'
  | 'chapters'
  | 'encMaps'
  | 'encSetup'
  | 'mapImages'
  | 'images'
  | 'creatureArt'

export interface GapItem {
  id: string
  label: string
  sub?: string
}

export interface GapCategory {
  id: string
  kind: GapKind
  title: string
  description: string
  items: GapItem[]
  defaultOn: boolean
  /** for kind "images" */
  entityType?: EntityType
}

/** entity types that can get illustrations, in display order; first ones are on by default */
export const IMAGE_TYPES: { type: EntityType; defaultOn: boolean }[] = [
  { type: 'npc', defaultOn: true },
  { type: 'location', defaultOn: true },
  { type: 'dungeon', defaultOn: true },
  { type: 'creature', defaultOn: true },
  { type: 'chapter', defaultOn: true },
  { type: 'faction', defaultOn: true },
  { type: 'item', defaultOn: true },
  { type: 'handout', defaultOn: true },
  { type: 'scene', defaultOn: false },
  { type: 'encounter', defaultOn: false },
  { type: 'spell', defaultOn: false },
]

export const isWritten = (e: Entity) => e.tags.includes('written') || e.body.length >= 1500

export function computeGaps(campaign: Campaign, entities: Entity[], maps: BattleMap[], index: EntityIndex): GapCategory[] {
  const cats: GapCategory[] = []
  const byName = (a: GapItem, b: GapItem) => a.label.localeCompare(b.label)

  // broken [[links]]
  const missing = new Map<string, Set<string>>()
  for (const e of entities) {
    const text = `${e.body}\n${e.secrets ?? ''}\n${(e.stats?.actions ?? []).map((a) => a.text ?? '').join('\n')}`
    for (const t of extractLinks(text)) {
      if (resolveLink(t, index, campaign.system).kind !== 'unresolved') continue
      if (!missing.has(t)) missing.set(t, new Set())
      missing.get(t)!.add(e.name)
    }
  }
  cats.push({
    id: 'links',
    kind: 'links',
    title: 'Broken links',
    description: '[[Links]] that match neither a campaign entry nor the rules. The AI creates the missing entries (homebrew where needed).',
    defaultOn: true,
    items: [...missing.entries()].map(([t, where]) => ({ id: t, label: t, sub: `in ${[...where].slice(0, 3).join(', ')}` })).sort(byName),
  })

  // encounters whose creatures exist only as prose
  cats.push({
    id: 'encStructure',
    kind: 'encStructure',
    title: 'Encounters without creatures',
    description: 'Encounters with no creature list. The AI reads the text and sets up the creatures (official stat blocks or new homebrew ones), tactics and difficulty.',
    defaultOn: true,
    items: entities
      .filter((e) => e.type === 'encounter' && !e.encounter?.creatures.length)
      .map((e) => ({ id: e.id, label: e.name, sub: e.summary }))
      .sort(byName),
  })

  cats.push({
    id: 'dungeons',
    kind: 'dungeons',
    title: 'Dungeons not built',
    description: 'Dungeons without rooms. Designs rooms, passages and encounters, paints the overview from the floor plan and maps for rooms with encounters.',
    defaultOn: true,
    items: entities
      .filter((e) => e.type === 'dungeon' && !e.dungeon?.rooms?.length)
      .map((e) => ({ id: e.id, label: e.name, sub: e.summary }))
      .sort(byName),
  })

  // encounter creatures without any stat block
  const encItems: GapItem[] = []
  for (const e of entities) {
    if (e.type !== 'encounter' || !e.encounter) continue
    e.encounter.creatures.forEach((c, i) => {
      const info = resolveCreature(c.refId, c.name, index, campaign.system)
      if (!info?.stats) encItems.push({ id: `${e.id}::${i}`, label: c.name, sub: `in ${e.name}` })
    })
  }
  cats.push({
    id: 'encCreatures',
    kind: 'encCreatures',
    title: 'Encounter creatures without stats',
    description: 'Creatures listed in encounters that have no stat block anywhere. Each becomes a homebrew creature with full stats.',
    defaultOn: true,
    items: encItems,
  })

  const noStats = (t: EntityType) =>
    entities.filter((e) => e.type === t && !e.stats).map((e) => ({ id: e.id, label: e.name, sub: e.summary })).sort(byName)
  cats.push({
    id: 'statsCreature',
    kind: 'statsCreature',
    title: 'Creatures without stat blocks',
    description: 'Creature entries that cannot be spawned with HP and actions yet.',
    defaultOn: true,
    items: noStats('creature'),
  })
  cats.push({
    id: 'statsNpc',
    kind: 'statsNpc',
    title: 'NPCs without stat blocks',
    description: 'Only needed for NPCs who might fight — pick the ones you want.',
    defaultOn: false,
    items: noStats('npc'),
  })

  cats.push({
    id: 'chapters',
    kind: 'chapters',
    title: 'Chapters not written out',
    description: 'Short or outline-only chapters. The AI writes them (and their scenes) out in full, playable detail.',
    defaultOn: true,
    items: entities
      .filter((e) => e.type === 'chapter' && !isWritten(e))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({ id: e.id, label: e.name, sub: `${e.body.length} characters` })),
  })

  cats.push({
    id: 'summaries',
    kind: 'summaries',
    title: 'Missing summaries',
    description: 'One-line summaries for lists, chips and the AI index. Cheap — done in batches with the fast model.',
    defaultOn: true,
    items: entities.filter((e) => !e.summary.trim() && e.type !== 'note').map((e) => ({ id: e.id, label: e.name, sub: ENTITY_TYPES[e.type].label })).sort(byName),
  })

  const mapIds = new Set(maps.map((m) => m.id))
  cats.push({
    id: 'encMaps',
    kind: 'encMaps',
    title: 'Encounters without a battle map',
    description: 'Creates a 30×20 map for each and paints it from the encounter and its location.',
    defaultOn: true,
    items: entities
      .filter((e) => e.type === 'encounter' && !(e.encounter?.mapId && mapIds.has(e.encounter.mapId)) && !maps.some((m) => m.encounterId === e.id))
      .map((e) => ({ id: e.id, label: e.name, sub: e.summary }))
      .sort(byName),
  })
  cats.push({
    id: 'encSetup',
    kind: 'encSetup',
    title: 'Encounter maps not set up',
    description: 'Maps whose encounter creatures are not on the map yet. Places creatures and party and saves it as the starting setup. Free — no AI.',
    defaultOn: true,
    items: maps.filter((m) => needsSeeding(m, entities)).map((m) => ({ id: m.id, label: m.name, sub: encounterForMap(m, entities)?.name })),
  })
  cats.push({
    id: 'mapImages',
    kind: 'mapImages',
    title: 'Battle maps without an image',
    description: 'Existing maps (e.g. created blank or by the chat) get painted from their description.',
    defaultOn: true,
    items: maps.filter((m) => !m.image).map((m) => ({ id: m.id, label: m.name, sub: m.description.slice(0, 80) })),
  })

  cats.push({
    id: 'creatureArt',
    kind: 'creatureArt',
    title: 'Creatures in play without portraits',
    description: 'Rules and campaign creatures used in encounters or on maps. The portrait is also shown on all their tokens.',
    defaultOn: true,
    items: creaturesWithoutArt(campaign, entities, maps, index).map((t) => ({ id: `${t.source}:${t.id}`, label: t.name, sub: t.source === 'rules' ? 'rules creature' : 'campaign creature' })),
  })

  for (const { type, defaultOn } of IMAGE_TYPES) {
    cats.push({
      id: `images:${type}`,
      kind: 'images',
      entityType: type,
      title: `${ENTITY_TYPES[type].plural} without images`,
      description: `Illustrations for ${ENTITY_TYPES[type].plural.toLowerCase()}.`,
      defaultOn,
      items: entities.filter((e) => e.type === type && !e.images.length).map((e) => ({ id: e.id, label: e.name, sub: e.summary })).sort(byName),
    })
  }
  return cats
}

// ---------------------------------------------------------------------------
// Cost estimate (rough): token counts per unit × OpenRouter prices
// ---------------------------------------------------------------------------

export interface Prices {
  /** USD per token */
  chat: { in: number; out: number }
  fast: { in: number; out: number }
  /** imageOut: price per output-image token (OpenRouter "image_output"), falls back to completion price */
  image: { in: number; out: number; imageOut: number }
}

/** approximate tokens of the campaign context sent with every agent step */
export const contextTokens = (entities: Entity[]) =>
  8000 + Math.round(entities.reduce((s, e) => s + e.body.length + (e.secrets?.length ?? 0) + e.summary.length + 200, 0) / 3.5)

export function estimateCost(cat: GapCategory, n: number, p: Prices, ctx: number): number {
  if (!n) return 0
  const fastPrompt = 1500 * p.fast.in + 200 * p.fast.out
  // image models bill an output image as ~1300 image tokens (more for high resolutions), plus a little text
  const image = 1400 * (p.image.imageOut || p.image.out) + 100 * p.image.out + 700 * p.image.in + fastPrompt
  switch (cat.kind) {
    case 'images':
    case 'creatureArt':
    case 'mapImages':
      return n * image
    case 'encMaps':
      return n * image
    case 'encSetup':
      return 0
    case 'encStructure':
      return n * (Math.min(ctx, 30000) * p.chat.in + 12000 * p.chat.in + 2500 * p.chat.out)
    case 'dungeons':
      // design + a few homebrew creatures + overview + ~4 room maps + links
      return n * ((ctx + 14000) * p.chat.in + 14000 * p.chat.out + 2 * (ctx * p.chat.in + 2500 * p.chat.out) + 5 * image + 4 * (ctx * p.chat.in + 1500 * p.chat.out))
    case 'statsCreature':
    case 'statsNpc':
      return n * (4000 * p.chat.in + 1800 * p.chat.out)
    case 'encCreatures':
      return n * (Math.min(ctx, 30000) * p.chat.in + 2500 * p.chat.out)
    case 'summaries':
      return Math.ceil(n / 25) * (12000 * p.fast.in + 900 * p.fast.out)
    case 'links': {
      // one agent run per 40 links, ~ (2 + links/6) steps each re-sending the campaign context
      const runs = Math.ceil(n / 40)
      const steps = 2 + Math.min(n, 40) / 6
      return runs * steps * (ctx * p.chat.in + 1500 * p.chat.out)
    }
    case 'chapters':
      // ~6 agent steps per chapter, lots of output
      return n * (6 * ctx * p.chat.in + 9000 * p.chat.out)
  }
  return 0
}

export const formatUsd = (v: number) => (v < 0.01 ? '< $0.01' : v < 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(v < 10 ? 2 : 0)}`)
