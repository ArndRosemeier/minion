import { db } from '@/db/db'
import { saveAsset, updateCampaign, type ChangeCtx } from '@/db/repo'
import { generateIllustration } from '@/ai/generate'
import type { Asset, Campaign, RefEntry } from '@/types'

/** Main campaign-specific image of a rules entry, if any. */
export const refImage = (campaign: Campaign, refId?: string) => (refId ? campaign.refImages?.[refId]?.[0] : undefined)

async function setRefImages(campaignId: string, refId: string, fn: (ids: string[]) => string[], ctx?: ChangeCtx) {
  const c = await db.campaigns.get(campaignId)
  if (!c) return
  const next = fn(c.refImages?.[refId] ?? [])
  const refImages = { ...(c.refImages ?? {}) }
  if (next.length) refImages[refId] = next
  else delete refImages[refId]
  await updateCampaign(campaignId, { refImages }, ctx)
}

export const addRefImage = (campaignId: string, refId: string, assetId: string, ctx?: ChangeCtx) =>
  setRefImages(campaignId, refId, (ids) => [assetId, ...ids.filter((x) => x !== assetId)], ctx)

export const removeRefImage = (campaignId: string, refId: string, assetId: string, ctx?: ChangeCtx) =>
  setRefImages(campaignId, refId, (ids) => ids.filter((x) => x !== assetId), ctx)

export const makeMainRefImage = (campaignId: string, refId: string, assetId: string, ctx?: ChangeCtx) =>
  setRefImages(campaignId, refId, (ids) => [assetId, ...ids.filter((x) => x !== assetId)], ctx)

export function refSubject(r: RefEntry) {
  const kind = r.category === 'creature' ? 'CREATURE' : r.category.toUpperCase()
  return `${kind}: ${r.name}\n${r.summary ?? ''}\n${r.traits?.length ? `Traits: ${r.traits.join(', ')}\n` : ''}${r.stats?.size ? `Size: ${r.stats.size}\n` : ''}${r.text.slice(0, 2000)}`
}

/** Paint an illustration for a rules entry (stored on the campaign). */
export async function illustrateRef(campaign: Campaign, r: RefEntry, direction?: string, ctx?: ChangeCtx): Promise<Asset> {
  const asset = await generateIllustration(campaign, refSubject(r), { aspectRatio: r.category === 'creature' ? '3:4' : '1:1', direction })
  await addRefImage(campaign.id, r.id, asset.id, ctx)
  return asset
}

export async function uploadRefImage(campaignId: string, refId: string, file: File, ctx?: ChangeCtx) {
  const a = await saveAsset(file, campaignId)
  await addRefImage(campaignId, refId, a.id, ctx)
  return a
}
