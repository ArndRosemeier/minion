import { create } from 'zustand'
import { db } from '@/db/db'
import { createEntity, createMap, undoBatch, updateEntity, updateMap, type ChangeCtx } from '@/db/repo'
import { newId } from '@/lib/id'
import { normalizeName } from '@/compendium/compendium'
import { generateBattlemapImage, generateEntityData, generateStatBlock, generateSummaries, illustrateEntities } from '@/ai/generate'
import { pool, stepPrompt, useBuilder, writeChaptersParallel } from './builder'
import { seedEncounterMap } from '@/lib/encounterSetup'
import { useAgentRun } from './agentRun'
import type { GapCategory, GapKind } from '@/lib/gaps'
import type { Campaign, Entity } from '@/types'
import type { Part } from '@/ai/complete'

export interface FillRun {
  running: boolean
  stopRequested: boolean
  total: number
  done: number
  progress: string
  errors: string[]
  /** change batches created by this run (for undo) */
  batches: string[]
  finishedAt?: number
  undone?: boolean
}

interface FillStore {
  runs: Record<string, FillRun>
  run: (campaign: Campaign, selection: { cat: GapCategory; ids: string[] }[]) => Promise<void>
  stop: (campaignId: string) => void
  undo: (campaignId: string) => Promise<void>
}

/** creation steps first (new entries), then text, then images */
const ORDER: GapKind[] = ['links', 'encStructure', 'dungeons', 'encCreatures', 'statsCreature', 'statsNpc', 'chapters', 'summaries', 'encMaps', 'encSetup', 'mapImages', 'creatureArt', 'images']

/** how many progress units a category contributes */
const units = (kind: GapKind, n: number) => (kind === 'summaries' ? Math.ceil(n / 25) : kind === 'links' ? Math.ceil(n / 40) : n)

export const useFill = create<FillStore>((set, get) => {
  const patch = (cid: string, p: Partial<FillRun> | ((r: FillRun) => Partial<FillRun>)) =>
    set((s) => {
      const cur = s.runs[cid]
      if (!cur) return s
      return { runs: { ...s.runs, [cid]: { ...cur, ...(typeof p === 'function' ? p(cur) : p) } } }
    })
  const stopped = (cid: string) => !!get().runs[cid]?.stopRequested
  const tick = (cid: string, progress?: string) => patch(cid, (r) => ({ done: r.done + 1, ...(progress ? { progress } : {}) }))
  const fail = (cid: string, msg: string) => patch(cid, (r) => ({ errors: [...r.errors, msg] }))
  const addBatch = (cid: string, b: string | null) => b && patch(cid, (r) => ({ batches: r.batches.includes(b) ? r.batches : [...r.batches, b] }))

  async function agent(cid: string, prompt: string) {
    const thread = await useBuilder.getState().threadId(cid)
    const b = await useAgentRun.getState().send(cid, thread, prompt, { background: true, label: 'Fill gaps' })
    addBatch(cid, b)
    if (!b) throw new Error('AI step did not complete')
  }

  async function runCategory(campaign: Campaign, cat: GapCategory, ids: string[], ctx: ChangeCtx) {
    const cid = campaign.id
    const fresh = async (id: string) => db.entities.get(id)
    switch (cat.kind) {
      case 'links': {
        for (let i = 0; i < ids.length && !stopped(cid); i += 40) {
          const chunk = ids.slice(i, i + 40)
          patch(cid, { progress: `Creating missing entries (${i + chunk.length}/${ids.length})…` })
          const list = chunk.map((t) => `- [[${t}]] (${cat.items.find((x) => x.id === t)?.sub ?? ''})`).join('\n')
          try {
            await agent(cid, stepPrompt('links', campaign, `Unresolved links:\n${list}`))
          } catch (e: any) {
            fail(cid, `Links: ${e.message}`)
          }
          tick(cid)
        }
        return
      }
      case 'encStructure':
      case 'dungeons': {
        const { completeEntity } = await import('@/ai/complete')
        const parts: Part[] = cat.kind === 'dungeons' ? ['text', 'rooms', 'creatures', 'map', 'roomMaps', 'links'] : ['encounter', 'creatures']
        for (const id of ids) {
          if (stopped(cid)) return
          const e = await fresh(id)
          if (!e) {
            tick(cid)
            continue
          }
          patch(cid, { progress: `${cat.kind === 'dungeons' ? 'Building dungeon' : 'Setting up encounter'}: ${e.name}` })
          try {
            await completeEntity(
              campaign,
              { type: e.type, id: e.id, draft: {} },
              new Set(parts),
              {},
              (_s, p) => p.detail && patch(cid, { progress: `${e.name}: ${p.detail}` }),
              ctx,
            )
          } catch (err: any) {
            fail(cid, `${e.name}: ${err.message}`)
          }
          tick(cid)
        }
        return
      }
      case 'encCreatures': {
        // one homebrew creature per distinct name, then point all encounter slots at it
        const byName = new Map<string, string[]>()
        for (const id of ids) {
          const item = cat.items.find((x) => x.id === id)
          if (!item) continue
          const k = normalizeName(item.label)
          byName.set(k, [...(byName.get(k) ?? []), id])
        }
        await pool(
          [...byName.values()],
          12,
          async (slots) => {
            const first = cat.items.find((x) => x.id === slots[0])!
            patch(cid, { progress: `Creating stat block: ${first.label}` })
            try {
              const [encId] = slots[0].split('::')
              const enc = await fresh(encId)
              const entities = await db.entities.where('campaignId').equals(cid).toArray()
              const data = await generateEntityData(campaign, entities, {
                type: 'creature',
                name: first.label,
                withStats: true,
                instructions: `This creature appears in the encounter “${enc?.name}”: ${enc?.summary ?? ''}\n${(enc?.body ?? '').slice(0, 1500)}`,
              })
              const created = await createEntity(cid, 'creature', { ...data, name: first.label, tags: [...(data.tags ?? []), 'homebrew'] }, ctx)
              for (const slot of slots) {
                const [eid, idx] = slot.split('::')
                const e = await fresh(eid)
                if (!e?.encounter) continue
                const creatures = e.encounter.creatures.map((c, i) => (i === Number(idx) ? { ...c, refId: created.id, name: created.name } : c))
                await updateEntity(eid, { encounter: { ...e.encounter, creatures } }, ctx)
              }
            } catch (e: any) {
              fail(cid, `${first.label}: ${e.message}`)
            }
            for (let i = 0; i < slots.length; i++) tick(cid)
          },
          () => stopped(cid),
        )
        return
      }
      case 'statsCreature':
      case 'statsNpc': {
        await pool(
          ids,
          12,
          async (id) => {
            const e = await fresh(id)
            if (!e || e.stats) return tick(cid)
            patch(cid, { progress: `Stat block: ${e.name}` })
            try {
              await updateEntity(id, { stats: await generateStatBlock(campaign, e) }, ctx)
            } catch (err: any) {
              fail(cid, `${e.name}: ${err.message}`)
            }
            tick(cid)
          },
          () => stopped(cid),
        )
        return
      }
      case 'chapters': {
        patch(cid, { progress: `Writing ${ids.length} chapters in parallel…` })
        const r = await writeChaptersParallel(campaign, ids, (msg) => patch(cid, { progress: msg }), () => stopped(cid))
        r.batches.forEach((b) => addBatch(cid, b))
        r.errors.forEach((name) => fail(cid, `Chapter not written: ${name}`))
        for (let i = 0; i < ids.length; i++) tick(cid)
        return
      }
      case 'summaries': {
        for (let i = 0; i < ids.length && !stopped(cid); i += 25) {
          patch(cid, { progress: `Writing summaries (${Math.min(i + 25, ids.length)}/${ids.length})…` })
          const batch = (await db.entities.bulkGet(ids.slice(i, i + 25))).filter((e): e is Entity => !!e && !e.summary.trim())
          try {
            const res = await generateSummaries(campaign, batch)
            for (const [id, summary] of Object.entries(res)) await updateEntity(id, { summary }, ctx)
          } catch (e: any) {
            fail(cid, `Summaries: ${e.message}`)
          }
          tick(cid)
        }
        return
      }
      case 'encMaps': {
        await pool(
          ids,
          12,
          async (id) => {
            const enc = await fresh(id)
            if (!enc) return tick(cid)
            patch(cid, { progress: `Painting battle map: ${enc.name}` })
            try {
              const ents = await db.entities.where('campaignId').equals(cid).toArray()
              const loc = ents.find((l) => l.type === 'location' && (enc.body.includes(l.name) || enc.parentId === l.id))
              const description = `${enc.name}\n${enc.encounter?.tactics ?? ''}\n${enc.body}\n${loc ? `Location: ${loc.name}\n${loc.body}` : ''}`.slice(0, 5000)
              const map = await createMap(cid, { name: enc.name, description, encounterId: enc.id, locationId: loc?.id, width: 30 * 70, height: 20 * 70 }, ctx)
              await updateEntity(enc.id, { encounter: { ...(enc.encounter ?? { creatures: [] }), mapId: map.id } }, ctx)
              await seedEncounterMap(map.id, ctx)
              const r = await generateBattlemapImage(campaign, description, { cols: 30, rows: 20 })
              await updateMap(map.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } }, ctx)
            } catch (e: any) {
              fail(cid, `Map “${enc.name}”: ${e.message}`)
            }
            tick(cid)
          },
          () => stopped(cid),
        )
        return
      }
      case 'encSetup': {
        for (const id of ids) {
          if (stopped(cid)) return
          patch(cid, { progress: 'Placing encounter creatures…' })
          try {
            await seedEncounterMap(id, ctx)
          } catch (e: any) {
            fail(cid, `Map setup: ${e.message}`)
          }
          tick(cid)
        }
        return
      }
      case 'mapImages': {
        await pool(
          ids,
          12,
          async (id) => {
            const map = await db.maps.get(id)
            if (!map || map.image) return tick(cid)
            patch(cid, { progress: `Painting battle map: ${map.name}` })
            try {
              const cols = Math.max(5, Math.round(map.width / map.grid.size)) || 30
              const rows = Math.max(5, Math.round(map.height / map.grid.size)) || 20
              const r = await generateBattlemapImage(campaign, map.description || map.name, { cols, rows })
              await updateMap(id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize, offsetX: 0, offsetY: 0 } }, ctx)
            } catch (e: any) {
              fail(cid, `Map “${map.name}”: ${e.message}`)
            }
            tick(cid)
          },
          () => stopped(cid),
        )
        return
      }
      case 'creatureArt': {
        const { paintAll } = await import('@/ai/complete')
        const targets = ids.map((key) => {
          const [source, ...rest] = key.split(':')
          return { id: rest.join(':'), name: cat.items.find((x) => x.id === key)?.label ?? key, source: source as 'rules' | 'campaign' }
        })
        let last = 0
        await paintAll(cid, targets, ctx, (d) => {
          const m = d.match(/^(\d+)\//)
          const n = m ? Number(m[1]) : last
          for (; last < n; last++) tick(cid)
          patch(cid, { progress: `Portraits: ${d}` })
        })
        for (; last < targets.length; last++) tick(cid)
        return
      }
      case 'images': {
        const list = (await db.entities.bulkGet(ids)).filter((e): e is Entity => !!e && !e.images.length)
        for (let i = 0; i < ids.length - list.length; i++) tick(cid)
        const errors = await illustrateEntities(campaign, list, ctx, (_d, _t, name) => tick(cid, `Illustrated: ${name}`), undefined)
        errors.forEach((e) => fail(cid, e))
        return
      }
    }
  }

  return {
    runs: {},
    run: async (campaign, selection) => {
      const cid = campaign.id
      if (get().runs[cid]?.running) return
      const work = selection.filter((s) => s.ids.length).sort((a, b) => ORDER.indexOf(a.cat.kind) - ORDER.indexOf(b.cat.kind))
      const total = work.reduce((s, w) => s + units(w.cat.kind, w.ids.length), 0)
      const ctx: ChangeCtx = { batchId: newId('b'), source: 'ai' }
      set((s) => ({ runs: { ...s.runs, [cid]: { running: true, stopRequested: false, total, done: 0, progress: 'Starting…', errors: [], batches: [ctx.batchId] } } }))
      try {
        // two lanes in parallel: text/structure work in dependency order, and images
        const IMAGE_KINDS: GapKind[] = ['mapImages', 'creatureArt', 'images']
        const lane = async (items: typeof work) => {
          for (const w of items) {
            if (stopped(cid)) break
            // re-read campaign so steps see settings changed meanwhile
            const c = (await db.campaigns.get(cid)) ?? campaign
            await runCategory(c, w.cat, w.ids, ctx)
          }
        }
        await Promise.all([lane(work.filter((w) => !IMAGE_KINDS.includes(w.cat.kind))), lane(work.filter((w) => IMAGE_KINDS.includes(w.cat.kind)))])
      } finally {
        patch(cid, { running: false, progress: stopped(cid) ? 'Stopped.' : 'Done.', finishedAt: Date.now() })
      }
    },
    stop: (cid) => {
      patch(cid, { stopRequested: true, progress: 'Stopping after the current item…' })
      useBuilder
        .getState()
        .threadId(cid)
        .then((t) => useAgentRun.getState().stop(t))
      useAgentRun.getState().stopBackground()
    },
    undo: async (cid) => {
      const r = get().runs[cid]
      if (!r) return
      for (const b of [...r.batches].reverse()) await undoBatch(b)
      patch(cid, { undone: true })
    },
  }
})
