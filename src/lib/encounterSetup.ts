import { db } from '@/db/db'
import { updateMap, type ChangeCtx } from '@/db/repo'
import { loadCompendium } from '@/compendium/compendium'
import { EntityIndex } from './links'
import { resolveCreature } from './creatures'
import { cols, rows, tokenFromMember, tokenFromStats } from './mapOps'
import type { BattleMap, Entity, MapState } from '@/types'

/** The encounter a map belongs to (via map.encounterId or an encounter pointing at the map). */
export function encounterForMap(map: BattleMap, entities: Entity[]): Entity | undefined {
  return (
    entities.find((e) => e.id === map.encounterId && e.type === 'encounter') ??
    entities.find((e) => e.type === 'encounter' && e.encounter?.mapId === map.id)
  )
}

/** A map still needs its encounter placed: it has an encounter, was never seeded and has no creature tokens. */
export function needsSeeding(map: BattleMap, entities: Entity[]): boolean {
  if (map.seeded) return false
  const enc = encounterForMap(map, entities)
  if (!enc?.encounter?.creatures.length) return false
  return !map.state.tokens.some((t) => t.kind === 'monster' || t.kind === 'npc')
}

const inFlight = new Map<string, Promise<number>>()

/**
 * Place the encounter's creatures (right side) and the party (left side) on the map and save
 * the result as the starting setup. Runs once per map (sets `seeded`). Returns tokens placed.
 */
export function seedEncounterMap(mapId: string, ctx?: ChangeCtx): Promise<number> {
  const running = inFlight.get(mapId)
  // concurrent callers wait for the same run but report 0, so only the first one announces it
  if (running) return running.then(() => 0)
  const p = seed(mapId, ctx).finally(() => inFlight.delete(mapId))
  inFlight.set(mapId, p)
  return p
}

async function seed(mapId: string, ctx?: ChangeCtx): Promise<number> {
  const map = await db.maps.get(mapId)
  if (!map || map.seeded) return 0
  const entities = await db.entities.where('campaignId').equals(map.campaignId).toArray()
  const enc = encounterForMap(map, entities)
  if (!enc?.encounter?.creatures.length || map.state.tokens.some((t) => t.kind === 'monster' || t.kind === 'npc')) {
    await updateMap(mapId, { seeded: true })
    return 0
  }
  const placed = await placeEncounter(mapId, enc.id, { includeParty: true, asStart: true }, ctx)
  await updateMap(mapId, { seeded: true, encounterId: map.encounterId ?? enc.id }, ctx)
  return placed
}

export interface PlaceOptions {
  /** where to put the creatures (cell); default: right side of the map */
  at?: { x: number; y: number }
  /** also place missing party members (left side) */
  includeParty?: boolean
  /** hide creatures from players (e.g. rooms not yet discovered) */
  hidden?: boolean
  /** also store the result as the map's starting setup */
  asStart?: boolean
}

/** Place one encounter's creatures (and optionally the party) on a map. Returns tokens placed. */
export async function placeEncounter(mapId: string, encounterId: string, opts: PlaceOptions = {}, ctx?: ChangeCtx): Promise<number> {
  const map = await db.maps.get(mapId)
  if (!map) return 0
  const [campaign, entities] = await Promise.all([
    db.campaigns.get(map.campaignId),
    db.entities.where('campaignId').equals(map.campaignId).toArray(),
  ])
  const enc = entities.find((e) => e.id === encounterId)
  if (!campaign || !enc?.encounter) return 0
  await loadCompendium(campaign.system)
  const index = new EntityIndex(entities)
  const bounds = { maxX: cols(map), maxY: rows(map) }
  const monsterAt = opts.at ?? { x: Math.floor(bounds.maxX * 0.7), y: Math.floor(bounds.maxY / 2) }
  const partyAt = { x: Math.floor(bounds.maxX * 0.25), y: Math.floor(bounds.maxY / 2) }

  let state: MapState = { ...map.state, tokens: [...map.state.tokens] }
  let placed = 0
  for (const c of enc.encounter.creatures) {
    const info = resolveCreature(c.refId, c.name, index, campaign.system)
    for (let i = 0; i < Math.max(1, c.count); i++) {
      const t = tokenFromStats(
        state,
        { kind: info?.kind ?? 'monster', name: info?.name ?? c.name, refId: info?.refId ?? c.refId, stats: info?.stats, image: info?.image },
        monsterAt,
        bounds,
      )
      if (opts.hidden) t.hidden = true
      state = { ...state, tokens: [...state.tokens, t] }
      placed++
    }
  }
  if (opts.includeParty) {
    for (const m of campaign.party) {
      if (state.tokens.some((t) => t.kind === 'pc' && t.refId === m.id)) continue
      state = { ...state, tokens: [...state.tokens, tokenFromMember(state, m, partyAt, bounds)] }
      placed++
    }
  }
  const patch: Partial<BattleMap> = { state }
  if (opts.asStart) patch.initialState = { ...map.initialState, tokens: structuredClone(state.tokens), combat: { active: false, round: 0 } }
  await updateMap(mapId, patch, ctx)
  return placed
}
