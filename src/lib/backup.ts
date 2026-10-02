import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { db } from '@/db/db'
import { newId } from './id'
import type { Asset, BattleMap, Campaign, ChatMessage, ChatThread, Entity } from '@/types'

const FORMAT = 'minion-backup'
const VERSION = 1

interface AssetMeta {
  id: string
  mime: string
  width?: number
  height?: number
  prompt?: string
  createdAt: number
  file: string
}

interface CampaignBundle {
  campaign: Campaign
  entities: Entity[]
  maps: BattleMap[]
  threads: ChatThread[]
  messages: ChatMessage[]
  assets: AssetMeta[]
}

const ext = (mime: string) => (mime.split('/')[1] || 'bin').replace('jpeg', 'jpg').replace('svg+xml', 'svg')

async function bundleCampaign(id: string, zip: Zippable, prefix: string): Promise<CampaignBundle> {
  const campaign = await db.campaigns.get(id)
  if (!campaign) throw new Error('Campaign not found')
  const [entities, maps, threads, messages, assets] = await Promise.all([
    db.entities.where('campaignId').equals(id).toArray(),
    db.maps.where('campaignId').equals(id).toArray(),
    db.threads.where('campaignId').equals(id).toArray(),
    db.messages.where('campaignId').equals(id).toArray(),
    db.assets.where('campaignId').equals(id).toArray(),
  ])
  const metas: AssetMeta[] = []
  for (const a of assets) {
    const file = `${prefix}assets/${a.id}.${ext(a.mime)}`
    zip[file] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }]
    metas.push({ id: a.id, mime: a.mime, width: a.width, height: a.height, prompt: a.prompt, createdAt: a.createdAt, file })
  }
  return { campaign, entities, maps, threads, messages, assets: metas }
}

export async function exportCampaign(id: string): Promise<Uint8Array> {
  const zip: Zippable = {}
  const bundle = await bundleCampaign(id, zip, '')
  zip['campaign.json'] = strToU8(JSON.stringify({ format: FORMAT, version: VERSION, kind: 'campaign', ...bundle }))
  return zipSync(zip)
}

export async function exportAll(): Promise<Uint8Array> {
  const zip: Zippable = {}
  const campaigns = await db.campaigns.toArray()
  const bundles: CampaignBundle[] = []
  for (const c of campaigns) bundles.push(await bundleCampaign(c.id, zip, `campaigns/${c.id}/`))
  // global assets (no campaign)
  const globalAssets = await db.assets.filter((a) => !a.campaignId).toArray()
  const gMetas: AssetMeta[] = []
  for (const a of globalAssets) {
    const file = `assets/${a.id}.${ext(a.mime)}`
    zip[file] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }]
    gMetas.push({ id: a.id, mime: a.mime, width: a.width, height: a.height, prompt: a.prompt, createdAt: a.createdAt, file })
  }
  const settings = (await db.kv.get('settings'))?.value as Record<string, unknown> | undefined
  const { apiKey: _k, ...safeSettings } = settings ?? {}
  void _k
  zip['backup.json'] = strToU8(
    JSON.stringify({ format: FORMAT, version: VERSION, kind: 'all', createdAt: Date.now(), campaigns: bundles, assets: gMetas, settings: safeSettings }),
  )
  return zipSync(zip)
}

export type ImportPreview =
  | { kind: 'campaign'; name: string; exists: boolean; files: Record<string, Uint8Array> }
  | { kind: 'all'; campaigns: string[]; files: Record<string, Uint8Array> }

export async function readBackup(file: Blob): Promise<ImportPreview> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (files['campaign.json']) {
    const j = JSON.parse(strFromU8(files['campaign.json']))
    if (j.format !== FORMAT) throw new Error('Not a Minion campaign file')
    const exists = !!(await db.campaigns.get(j.campaign.id))
    return { kind: 'campaign', name: j.campaign.name, exists, files }
  }
  if (files['backup.json']) {
    const j = JSON.parse(strFromU8(files['backup.json']))
    if (j.format !== FORMAT) throw new Error('Not a Minion backup')
    return { kind: 'all', campaigns: j.campaigns.map((c: CampaignBundle) => c.campaign.name), files }
  }
  throw new Error('Unrecognized file. Expected a Minion campaign (.minion) or backup.')
}

/** Replace all ids by fresh ones (for importing a copy next to an existing campaign). */
function remapIds(bundle: CampaignBundle): CampaignBundle {
  let json = JSON.stringify(bundle)
  const ids = new Set<string>([bundle.campaign.id])
  bundle.entities.forEach((e) => ids.add(e.id))
  bundle.maps.forEach((m) => ids.add(m.id))
  bundle.threads.forEach((t) => ids.add(t.id))
  bundle.messages.forEach((m) => ids.add(m.id))
  bundle.assets.forEach((a) => ids.add(a.id))
  for (const id of ids) {
    const prefix = id.includes('_') ? id.split('_')[0] : ''
    json = json.split(id).join(newId(prefix))
  }
  return JSON.parse(json)
}

async function writeBundle(b: CampaignBundle, files: Record<string, Uint8Array>, assetFiles: Map<string, string>) {
  const assets: Asset[] = b.assets.map((m) => ({
    id: m.id,
    campaignId: b.campaign.id,
    mime: m.mime,
    width: m.width,
    height: m.height,
    prompt: m.prompt,
    createdAt: m.createdAt,
    blob: new Blob([files[assetFiles.get(m.id) ?? m.file] as BlobPart], { type: m.mime }),
  }))
  await db.transaction('rw', [db.campaigns, db.entities, db.maps, db.assets, db.threads, db.messages, db.changes], async () => {
    const id = b.campaign.id
    await db.entities.where('campaignId').equals(id).delete()
    await db.maps.where('campaignId').equals(id).delete()
    await db.assets.where('campaignId').equals(id).delete()
    await db.threads.where('campaignId').equals(id).delete()
    await db.messages.where('campaignId').equals(id).delete()
    await db.changes.where('campaignId').equals(id).delete()
    await db.campaigns.put(b.campaign)
    await db.entities.bulkPut(b.entities)
    await db.maps.bulkPut(b.maps)
    await db.threads.bulkPut(b.threads)
    await db.messages.bulkPut(b.messages)
    await db.assets.bulkPut(assets)
  })
}

export async function importCampaign(files: Record<string, Uint8Array>, mode: 'replace' | 'copy'): Promise<string> {
  let bundle = JSON.parse(strFromU8(files['campaign.json'])) as CampaignBundle
  const original = new Map(bundle.assets.map((a) => [a.id, a.file]))
  const originalOrder = bundle.assets.map((a) => a.file)
  if (mode === 'copy') {
    bundle = remapIds(bundle)
    bundle.campaign.name += ' (copy)'
  }
  // asset file paths are remapped too; map new ids back to the original files by position
  const assetFiles = new Map<string, string>()
  bundle.assets.forEach((a, i) => assetFiles.set(a.id, original.get(a.id) ?? originalOrder[i]))
  await writeBundle(bundle, files, assetFiles)
  return bundle.campaign.id
}

export async function importAll(files: Record<string, Uint8Array>) {
  const j = JSON.parse(strFromU8(files['backup.json']))
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) if (t.name !== 'kv') await t.clear()
  })
  for (const b of j.campaigns as CampaignBundle[]) {
    await writeBundle(b, files, new Map(b.assets.map((a) => [a.id, a.file])))
  }
  for (const m of j.assets as AssetMeta[]) {
    await db.assets.put({ id: m.id, mime: m.mime, width: m.width, height: m.height, prompt: m.prompt, createdAt: m.createdAt, blob: new Blob([files[m.file] as BlobPart], { type: m.mime }) })
  }
  if (j.settings) {
    const cur = ((await db.kv.get('settings'))?.value ?? {}) as Record<string, unknown>
    await db.kv.put({ key: 'settings', value: { ...j.settings, apiKey: cur.apiKey ?? '' } })
  }
}

// ---------------------------------------------------------------------------
// File pickers with download / <input> fallback
// ---------------------------------------------------------------------------

export async function saveFile(data: Uint8Array, suggestedName: string, description = 'Minion file') {
  const blob = new Blob([data as BlobPart], { type: 'application/zip' })
  const w = window as any
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { 'application/zip': ['.minion', '.zip'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (e: any) {
      if (e?.name === 'AbortError') return false
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

export async function openFile(accept = '.minion,.zip'): Promise<File | null> {
  const w = window as any
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [{ description: 'Minion file', accept: { 'application/zip': ['.minion', '.zip'] } }],
      })
      return await handle.getFile()
    } catch (e: any) {
      if (e?.name === 'AbortError') return null
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

export const safeFileName = (s: string) => s.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '-') || 'campaign'
