import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { loadCompendium, onCompendiumLoaded } from '@/compendium/compendium'
import { buildAutoLinkRegex, EntityIndex } from '@/lib/links'
import type { BattleMap, Campaign, Entity } from '@/types'

export interface CampaignCtx {
  campaign: Campaign
  entities: Entity[]
  index: EntityIndex
  maps: BattleMap[]
  autoLinkRe: RegExp | null
  /** bumps when the compendium finished loading so link chips re-resolve */
  compendiumVersion: number
}

const Ctx = createContext<CampaignCtx | null>(null)

export function CampaignProvider({ campaignId, children, fallback }: { campaignId: string; children: ReactNode; fallback?: ReactNode }) {
  const campaign = useLiveQuery(async () => (await db.campaigns.get(campaignId)) ?? null, [campaignId])
  const entities = useLiveQuery(() => db.entities.where('campaignId').equals(campaignId).toArray(), [campaignId])
  const maps = useLiveQuery(() => db.maps.where('campaignId').equals(campaignId).toArray(), [campaignId])
  const [compendiumVersion, setCV] = useState(0)

  useEffect(() => {
    if (campaign?.system) loadCompendium(campaign.system)
  }, [campaign?.system])
  useEffect(() => onCompendiumLoaded(() => setCV((v) => v + 1)) as () => void, [])

  const value = useMemo<CampaignCtx | null>(() => {
    if (!campaign || !entities || !maps) return null
    return {
      campaign,
      entities,
      maps,
      index: new EntityIndex(entities),
      autoLinkRe: buildAutoLinkRegex(entities),
      compendiumVersion,
    }
  }, [campaign, entities, maps, compendiumVersion])

  if (campaign === null) return <>{fallback}</>
  if (!value) return null
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCampaign(): CampaignCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCampaign outside CampaignProvider')
  return c
}

export const useOptionalCampaign = () => useContext(Ctx)
