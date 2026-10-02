import Dexie, { type Table } from 'dexie'
import type {
  Asset,
  BattleMap,
  Campaign,
  ChangeRecord,
  ChatMessage,
  ChatThread,
  Entity,
} from '@/types'

export class MinionDB extends Dexie {
  campaigns!: Table<Campaign, string>
  entities!: Table<Entity, string>
  maps!: Table<BattleMap, string>
  assets!: Table<Asset, string>
  threads!: Table<ChatThread, string>
  messages!: Table<ChatMessage, string>
  changes!: Table<ChangeRecord, string>
  kv!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('minion')
    this.version(1).stores({
      campaigns: 'id, updatedAt',
      entities: 'id, campaignId, [campaignId+type], updatedAt',
      maps: 'id, campaignId, parentId',
      assets: 'id, campaignId',
      threads: 'id, campaignId, updatedAt',
      messages: 'id, campaignId, threadId, createdAt',
      changes: 'id, campaignId, batchId, createdAt',
      kv: 'key',
    })
  }
}

export const db = new MinionDB()

/** Ask the browser not to evict our data (important on iPad Safari). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch {
    /* ignore */
  }
  return false
}
