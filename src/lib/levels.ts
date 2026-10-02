import { normalizeName } from '@/compendium/compendium'
import type { Campaign, Entity, EntityType } from '@/types'

/** Entry types that carry a party level. */
export const LEVELED_TYPES: EntityType[] = ['chapter', 'scene', 'encounter', 'dungeon', 'location']

/**
 * Party level at which an entry is played: its own level, else the parent chain
 * (scene → chapter, encounter → room → dungeon), else a chapter/scene that links to it,
 * else the campaign's party level.
 */
export function levelFor(e: Partial<Entity> | undefined, entities: Entity[], campaign: Campaign): number {
  const byId = new Map(entities.map((x) => [x.id, x]))
  const seen = new Set<string>()
  let cur: Partial<Entity> | undefined = e
  while (cur) {
    if (typeof cur.level === 'number') return cur.level
    if (!cur.parentId || seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  // referenced from story text: use the referencing chapter's/scene's level
  if (e?.name) {
    const n = normalizeName(e.name)
    for (const x of entities) {
      if ((x.type === 'chapter' || x.type === 'scene') && x.id !== e.id && normalizeName(x.body).includes(`[[${n}`)) {
        const l = x.level ?? (x.parentId ? byId.get(x.parentId)?.level : undefined)
        if (typeof l === 'number') return l
      }
    }
  }
  return campaign.partyLevel
}

export const LEVEL_PLANNING = (c: Campaign, toLevel?: number) => `LEVEL PLAN (always do this when creating or extending a module):
- First decide the level curve: at which party level each act/chapter is played. The party starts at level ${c.partyLevel}${toLevel ? ` and should reach about level ${toLevel} by the end` : ''}.
- ${c.system === 'pf2e' ? 'Pathfinder 2e: the party levels up after ~1000 XP — roughly every 3–4 moderate/severe encounters plus story awards, i.e. about one level per 1–2 chapters.' : 'D&D 5e: use milestone levelling — roughly one level per chapter at levels 1–3, then every 1–2 chapters.'}
- Store it: set "level" on every chapter (the party level while playing it). Scenes, encounters and dungeons inside a chapter use that level — set "level" on encounters and dungeons explicitly too.
- Build everything for the level where it is played: encounter budgets and creature levels/CR, DCs, hazards, treasure and magic items by level. Mention level-ups in the chapter text where they happen.`
