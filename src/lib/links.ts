import { findRef, getRef, normalizeName } from '@/compendium/compendium'
import type { Entity, EntityType, GameSystem, RefCategory, RefEntry } from '@/types'

/** What a detail view / chip points to. */
export type LinkTarget =
  | { kind: 'entity'; id: string }
  | { kind: 'ref'; id: string; system: GameSystem }
  | { kind: 'unresolved'; name: string; hint?: string }

export type Resolved =
  | { kind: 'entity'; entity: Entity }
  | { kind: 'ref'; ref: RefEntry }
  | { kind: 'unresolved'; name: string; hint?: string }

const ENTITY_HINTS: Record<string, EntityType> = {
  npc: 'npc',
  character: 'npc',
  location: 'location',
  place: 'location',
  dungeon: 'dungeon',
  scene: 'scene',
  event: 'scene',
  chapter: 'chapter',
  creature: 'creature',
  monster: 'creature',
  faction: 'faction',
  item: 'item',
  spell: 'spell',
  encounter: 'encounter',
  handout: 'handout',
  rule: 'rule',
  note: 'note',
}

const REF_HINTS: Record<string, RefCategory> = {
  spell: 'spell',
  condition: 'condition',
  creature: 'creature',
  monster: 'creature',
  action: 'action',
  item: 'item',
  rule: 'rule',
  trait: 'trait',
}

/** Split "spell:Fireball" into hint + name. */
export function splitHint(target: string): { hint?: string; name: string } {
  const m = target.match(/^([a-z]+):(.+)$/i)
  if (m && (ENTITY_HINTS[m[1].toLowerCase()] || REF_HINTS[m[1].toLowerCase()] || m[1] === 'id' || m[1] === 'ref'))
    return { hint: m[1].toLowerCase(), name: m[2].trim() }
  return { name: target.trim() }
}

export class EntityIndex {
  byName = new Map<string, Entity[]>()
  byId = new Map<string, Entity>()
  constructor(public entities: Entity[]) {
    for (const e of entities) {
      this.byId.set(e.id, e)
      for (const n of [e.name, ...(e.aliases || [])]) {
        if (!n) continue
        const k = normalizeName(n)
        const list = this.byName.get(k)
        if (list) list.push(e)
        else this.byName.set(k, [e])
      }
    }
  }
  find(name: string, type?: EntityType): Entity | undefined {
    const list = this.byName.get(normalizeName(name))
    if (!list) return undefined
    return type ? list.find((e) => e.type === type) : list[0]
  }
}

export function resolveLink(target: string, index: EntityIndex, system: GameSystem): Resolved {
  const { hint, name } = splitHint(target)
  if (hint === 'id') {
    const e = index.byId.get(name)
    return e ? { kind: 'entity', entity: e } : { kind: 'unresolved', name }
  }
  if (hint === 'ref') {
    const r = getRef(system, name)
    return r ? { kind: 'ref', ref: r } : { kind: 'unresolved', name }
  }
  const eType = hint ? ENTITY_HINTS[hint] : undefined
  const e = index.find(name, eType) ?? (eType ? undefined : index.find(name))
  if (e) return { kind: 'entity', entity: e }
  // homebrew with same name in campaign wins; otherwise compendium
  const r = findRef(system, name, hint ? REF_HINTS[hint] : undefined) ?? (hint ? findRef(system, name) : null)
  if (r) return { kind: 'ref', ref: r }
  // tolerate "Frightened 2" style references to entities too
  const e2 = index.find(name.replace(/\s+\d+$/, ''))
  if (e2) return { kind: 'entity', entity: e2 }
  return { kind: 'unresolved', name, hint }
}

export function targetOf(r: Resolved, system: GameSystem): LinkTarget {
  if (r.kind === 'entity') return { kind: 'entity', id: r.entity.id }
  if (r.kind === 'ref') return { kind: 'ref', id: r.ref.id, system }
  return { kind: 'unresolved', name: r.name, hint: r.hint }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Build a regex matching any campaign entity name/alias for auto-linking. */
export function buildAutoLinkRegex(entities: Entity[]): RegExp | null {
  const names = new Set<string>()
  for (const e of entities) {
    if (e.type === 'note') continue
    for (const n of [e.name, ...(e.aliases || [])]) if (n && n.trim().length >= 3) names.add(n.trim())
  }
  if (!names.size) return null
  const alt = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])(${alt})(?![\\p{L}\\p{N}])`, 'giu')
  } catch {
    return null
  }
}

/** Convert [[target|label]] wikilinks into markdown links with the wiki: protocol. */
export function preprocessWikilinks(md: string): string {
  return md.replace(/\[\[([^\]|\n]+?)(?:\|([^\]\n]+?))?\]\]/g, (_m, target: string, label?: string) => {
    const t = target.trim()
    const display = (label ?? splitHint(t).name).replace(/[[\]]/g, '')
    return `[${display}](wiki:${encodeURIComponent(t)})`
  })
}

/** All wikilink targets in a text. */
export function extractLinks(md: string): string[] {
  const out: string[] = []
  for (const m of md.matchAll(/\[\[([^\]|\n]+?)(?:\|[^\]\n]+?)?\]\]/g)) out.push(m[1].trim())
  return out
}
