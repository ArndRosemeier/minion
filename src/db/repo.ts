import { db } from './db'
import { newId } from '@/lib/id'
import type {
  Asset,
  BattleMap,
  Campaign,
  ChangeRecord,
  Entity,
  EntityType,
  GameSystem,
  MapState,
} from '@/types'

/** Mutations made together (e.g. by one AI turn) share a batch so they can be undone together. */
export interface ChangeCtx {
  batchId: string
  source: 'user' | 'ai'
}

export const userCtx = (): ChangeCtx => ({ batchId: newId('b'), source: 'user' })

async function record(
  ctx: ChangeCtx | undefined,
  campaignId: string,
  table: ChangeRecord['table'],
  recordId: string,
  label: string,
  before: unknown,
  after: unknown,
) {
  if (!ctx) return
  await db.changes.add({
    id: newId('c'),
    campaignId,
    batchId: ctx.batchId,
    label,
    table,
    recordId,
    before,
    after,
    source: ctx.source,
    createdAt: Date.now(),
  })
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export function defaultCampaign(partial: Partial<Campaign> = {}): Campaign {
  const now = Date.now()
  return {
    id: newId('cmp'),
    name: 'New Campaign',
    system: 'pf2e' as GameSystem,
    language: 'English',
    premise: '',
    tone: '',
    partyLevel: 1,
    partySize: 4,
    party: [],
    pipeline: {},
    aiInstructions: '',
    artStyle: 'Painterly high-fantasy illustration, rich colors, dramatic lighting',
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export async function createCampaign(partial: Partial<Campaign>): Promise<Campaign> {
  const c = defaultCampaign(partial)
  await db.campaigns.add(c)
  return c
}

export async function updateCampaign(id: string, patch: Partial<Campaign>, ctx?: ChangeCtx) {
  const before = await db.campaigns.get(id)
  if (!before) throw new Error(`Campaign ${id} not found`)
  const after = { ...before, ...patch, id, updatedAt: Date.now() }
  await db.campaigns.put(after)
  await record(ctx, id, 'campaigns', id, `Updated campaign settings`, before, after)
  return after
}

export async function deleteCampaign(id: string) {
  await db.transaction('rw', [db.campaigns, db.entities, db.maps, db.assets, db.threads, db.messages, db.changes], async () => {
    await db.entities.where('campaignId').equals(id).delete()
    await db.maps.where('campaignId').equals(id).delete()
    await db.assets.where('campaignId').equals(id).delete()
    await db.threads.where('campaignId').equals(id).delete()
    await db.messages.where('campaignId').equals(id).delete()
    await db.changes.where('campaignId').equals(id).delete()
    await db.campaigns.delete(id)
  })
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export function blankEntity(campaignId: string, type: EntityType, name: string): Entity {
  const now = Date.now()
  return {
    id: newId(type.slice(0, 3)),
    campaignId,
    type,
    name,
    aliases: [],
    summary: '',
    body: '',
    tags: [],
    images: [],
    createdAt: now,
    updatedAt: now,
  }
}

export async function createEntity(
  campaignId: string,
  type: EntityType,
  data: Partial<Entity>,
  ctx?: ChangeCtx,
): Promise<Entity> {
  const e: Entity = { ...blankEntity(campaignId, type, data.name || 'Unnamed'), ...data, campaignId, type }
  if (!e.id) e.id = newId(type.slice(0, 3))
  if (e.order === undefined && (type === 'chapter' || type === 'scene')) {
    const siblings = await db.entities.where({ campaignId, type }).toArray()
    const relevant = type === 'scene' ? siblings.filter((s) => s.parentId === e.parentId) : siblings
    e.order = relevant.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1
  }
  await db.entities.add(e)
  await record(ctx, campaignId, 'entities', e.id, `Created ${type} “${e.name}”`, undefined, e)
  return e
}

export async function updateEntity(id: string, patch: Partial<Entity>, ctx?: ChangeCtx): Promise<Entity> {
  const before = await db.entities.get(id)
  if (!before) throw new Error(`Entity ${id} not found`)
  const after: Entity = { ...before, ...patch, id, campaignId: before.campaignId, updatedAt: Date.now() }
  await db.entities.put(after)
  await record(ctx, before.campaignId, 'entities', id, `Edited ${after.type} “${after.name}”`, before, after)
  return after
}

export async function deleteEntity(id: string, ctx?: ChangeCtx) {
  const before = await db.entities.get(id)
  if (!before) return
  await db.entities.delete(id)
  await record(ctx, before.campaignId, 'entities', id, `Deleted ${before.type} “${before.name}”`, before, undefined)
}

// ---------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------

export const emptyMapState = (): MapState => ({
  tokens: [],
  fogEnabled: false,
  combat: { active: false, round: 0 },
})

export function blankMap(campaignId: string, name: string): BattleMap {
  const now = Date.now()
  return {
    id: newId('map'),
    campaignId,
    name,
    description: '',
    width: 2048,
    height: 2048,
    grid: { size: 70, offsetX: 0, offsetY: 0, visible: true, color: '#000000', opacity: 0.25 },
    links: [],
    initialState: emptyMapState(),
    state: emptyMapState(),
    createdAt: now,
    updatedAt: now,
  }
}

export async function createMap(campaignId: string, data: Partial<BattleMap>, ctx?: ChangeCtx) {
  const m: BattleMap = { ...blankMap(campaignId, data.name || 'New Map'), ...data, campaignId }
  await db.maps.add(m)
  await record(ctx, campaignId, 'maps', m.id, `Created map “${m.name}”`, undefined, m)
  return m
}

/** Map edits. Pass ctx only for structural changes worth undoing (not every token drag). */
export async function updateMap(id: string, patch: Partial<BattleMap>, ctx?: ChangeCtx) {
  const before = await db.maps.get(id)
  if (!before) throw new Error(`Map ${id} not found`)
  const after: BattleMap = { ...before, ...patch, id, updatedAt: Date.now() }
  await db.maps.put(after)
  await record(ctx, before.campaignId, 'maps', id, `Edited map “${after.name}”`, before, after)
  return after
}

export async function deleteMap(id: string, ctx?: ChangeCtx) {
  const before = await db.maps.get(id)
  if (!before) return
  await db.maps.delete(id)
  // detach children
  const children = await db.maps.where('parentId').equals(id).toArray()
  for (const c of children) await db.maps.update(c.id, { parentId: before.parentId })
  await record(ctx, before.campaignId, 'maps', id, `Deleted map “${before.name}”`, before, undefined)
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

async function revert(change: ChangeRecord) {
  const table = db.table(change.table)
  if (change.before === undefined) await table.delete(change.recordId)
  else await table.put(change.before)
}

export async function undoBatch(batchId: string) {
  const changes = await db.changes.where('batchId').equals(batchId).sortBy('createdAt')
  for (const c of changes.reverse()) {
    if (c.undone) continue
    await revert(c)
    await db.changes.update(c.id, { undone: true })
  }
}

export async function undoChange(id: string) {
  const c = await db.changes.get(id)
  if (!c || c.undone) return
  await revert(c)
  await db.changes.update(id, { undone: true })
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(blob)
    const r = { width: bmp.width, height: bmp.height }
    bmp.close()
    return r
  } catch {
    return { width: 0, height: 0 }
  }
}

export async function saveAsset(blob: Blob, campaignId?: string, prompt?: string): Promise<Asset> {
  const size = blob.type.startsWith('image/') ? await imageSize(blob) : { width: 0, height: 0 }
  const a: Asset = {
    id: newId('img'),
    campaignId,
    mime: blob.type || 'application/octet-stream',
    blob,
    ...size,
    prompt,
    createdAt: Date.now(),
  }
  await db.assets.add(a)
  return a
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
