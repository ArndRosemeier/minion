import { findRef, getRef, normalizeName, searchRefs } from '@/compendium/compendium'
import type { Entity, GameSystem, StatBlock } from '@/types'
import type { EntityIndex } from './links'

export interface CreatureInfo {
  refId: string
  name: string
  stats?: StatBlock
  image?: string
  source: 'campaign' | 'rules'
  kind: 'npc' | 'monster'
}

export function resolveCreature(refId: string, name: string, index: EntityIndex, system: GameSystem): CreatureInfo | null {
  const e = index.byId.get(refId) ?? index.find(name, 'creature') ?? index.find(name, 'npc')
  if (e) return fromEntity(e)
  const r = getRef(system, refId) ?? findRef(system, name, 'creature')
  if (r) return { refId: r.id, name: r.name, stats: r.stats, source: 'rules', kind: 'monster' }
  return null
}

export const fromEntity = (e: Entity): CreatureInfo => ({
  refId: e.id,
  name: e.name,
  stats: e.stats,
  image: e.images[0],
  source: 'campaign',
  kind: e.type === 'npc' ? 'npc' : 'monster',
})

export function searchCreatures(query: string, entities: Entity[], system: GameSystem, limit = 40): CreatureInfo[] {
  const q = normalizeName(query)
  const own = entities
    .filter((e) => (e.type === 'creature' || e.type === 'npc') && (!q || normalizeName(e.name).includes(q)))
    .sort((a, b) => Number(!!b.stats) - Number(!!a.stats))
    .map(fromEntity)
  const refs = searchRefs(system, query, { category: 'creature', limit }).map<CreatureInfo>((r) => ({
    refId: r.id,
    name: r.name,
    stats: r.stats,
    source: 'rules',
    kind: 'monster',
  }))
  return [...own, ...refs].slice(0, limit)
}

export const levelLabel = (system: GameSystem, s?: StatBlock) =>
  !s ? '' : system === 'pf2e' ? `L${s.level ?? '?'}` : `CR ${s.cr ?? '?'}`
