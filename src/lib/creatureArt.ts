import { db } from '@/db/db'
import type { ChangeCtx } from '@/db/repo'
import { getRef, loadCompendium } from '@/compendium/compendium'
import { illustrateEntity } from '@/ai/generate'
import { EntityIndex } from './links'
import { resolveCreature } from './creatures'
import { illustrateRef } from './refArt'
import type { BattleMap, Campaign, Entity } from '@/types'

export interface ArtTarget {
  /** rules ref id or campaign entity id */
  id: string
  name: string
  source: 'rules' | 'campaign'
}

/** Creatures (rules or campaign) used in encounters or on maps that have no image yet. */
export function creaturesWithoutArt(campaign: Campaign, entities: Entity[], maps: BattleMap[], index: EntityIndex, onlyEncounters?: string[]): ArtTarget[] {
  const out = new Map<string, ArtTarget>()
  const consider = (refId: string, name: string) => {
    const info = resolveCreature(refId, name, index, campaign.system)
    if (!info) return
    if (info.source === 'rules') {
      if (!campaign.refImages?.[info.refId]?.length) out.set(info.refId, { id: info.refId, name: info.name, source: 'rules' })
    } else {
      const e = index.byId.get(info.refId)
      if (e && !e.images.length) out.set(e.id, { id: e.id, name: e.name, source: 'campaign' })
    }
  }
  for (const e of entities) {
    if (e.type !== 'encounter' || (onlyEncounters && !onlyEncounters.includes(e.id))) continue
    for (const c of e.encounter?.creatures ?? []) consider(c.refId, c.name)
  }
  if (!onlyEncounters) {
    for (const m of maps) for (const t of m.state.tokens) if (t.refId && t.kind !== 'pc' && !t.image) consider(t.refId, t.name.replace(/ \d+$/, ''))
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Paint a portrait for one creature target (re-checks that it still has none). */
export async function paintCreature(campaignId: string, target: ArtTarget, ctx?: ChangeCtx, promptOverride?: string) {
  const campaign = await db.campaigns.get(campaignId)
  if (!campaign) return
  if (target.source === 'rules') {
    if (campaign.refImages?.[target.id]?.length) return
    await loadCompendium(campaign.system)
    const r = getRef(campaign.system, target.id)
    if (r) await illustrateRef(campaign, r, undefined, ctx, promptOverride)
  } else {
    const e = await db.entities.get(target.id)
    if (e && !e.images.length) await illustrateEntity(campaign, e, undefined, ctx, promptOverride)
  }
}

export async function creatureTargetsForEncounters(campaignId: string, encounterIds: string[]): Promise<ArtTarget[]> {
  const campaign = await db.campaigns.get(campaignId)
  if (!campaign) return []
  await loadCompendium(campaign.system)
  const entities = await db.entities.where('campaignId').equals(campaignId).toArray()
  return creaturesWithoutArt(campaign, entities, [], new EntityIndex(entities), encounterIds)
}
