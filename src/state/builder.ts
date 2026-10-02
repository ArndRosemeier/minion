import { create } from 'zustand'
import { db } from '@/db/db'
import { createMap, updateCampaign, updateEntity, updateMap, type ChangeCtx } from '@/db/repo'
import { newId } from '@/lib/id'
import { extractLinks, resolveLink, EntityIndex } from '@/lib/links'
import { loadCompendium } from '@/compendium/compendium'
import { generateBattlemapImage, illustrateEntity } from '@/ai/generate'
import { useAgentRun } from './agentRun'
import { seedEncounterMap } from '@/lib/encounterSetup'
import type { AutomationMode, Campaign, ChatThread, Entity } from '@/types'
import { SYSTEM_LABEL } from '@/types'

export interface StepDef {
  id: string
  title: string
  description: string
  defaultMode: AutomationMode
  /** "agent" steps send a prompt to the campaign agent; "loop" steps iterate themselves */
  kind: 'agent' | 'loop'
}

export const SCOPES: Record<string, string> = {
  oneshot: 'a one-shot adventure (1 chapter, 3–5 scenes, 1–2 combat encounters, playable in one session)',
  short: 'a short adventure (3 chapters, about 3–4 sessions, levels as fits the party)',
  arc: 'a campaign arc (5–7 chapters, ~8–12 sessions, party grows about 2–3 levels)',
  extend: 'the NEXT part of the existing campaign (continue after the current last chapter: 2–4 new chapters, higher level as the party grows)',
}

export const STEPS: StepDef[] = [
  { id: 'premise', title: 'Premise & hook', description: 'Develop the premise, conflict, villain and tone.', defaultMode: 'assisted', kind: 'agent' },
  { id: 'outline', title: 'Story outline', description: 'Chapters and scenes in playing order.', defaultMode: 'assisted', kind: 'agent' },
  { id: 'locations', title: 'Locations', description: 'Places with descriptions, features and secrets.', defaultMode: 'auto', kind: 'agent' },
  { id: 'npcs', title: 'NPCs & factions', description: 'Characters with motives, voices, secrets, stats if needed.', defaultMode: 'auto', kind: 'agent' },
  { id: 'encounters', title: 'Encounters', description: 'Balanced fights & hazards using official or homebrew creatures.', defaultMode: 'assisted', kind: 'agent' },
  { id: 'dungeons', title: 'Dungeons', description: 'Design every dungeon: rooms, passages, encounters, floor-plan map and room maps.', defaultMode: 'auto', kind: 'loop' },
  { id: 'write', title: 'Write chapters', description: 'Full playable text per chapter: read-aloud, checks, treasure.', defaultMode: 'auto', kind: 'loop' },
  { id: 'links', title: 'Fill the gaps', description: 'Create every referenced but missing entry (homebrew).', defaultMode: 'auto', kind: 'loop' },
  { id: 'maps', title: 'Battle maps', description: 'Paint a battle map for every encounter.', defaultMode: 'auto', kind: 'loop' },
  { id: 'art', title: 'Illustrations', description: 'Portraits, places and chapter art.', defaultMode: 'auto', kind: 'loop' },
]

export function stepPrompt(step: string, c: Campaign, extra = ''): string {
  const scope = SCOPES[c.brief?.scope ?? 'short'] ?? SCOPES.short
  const notes = c.brief?.notes ? `\nGM's wishes for this module: ${c.brief.notes}` : ''
  const head = `[MODULE BUILDER — step “${step}”] We are building ${scope} for ${SYSTEM_LABEL[c.system]}, party of ${c.partySize} at level ${c.partyLevel}.${notes}\nWork autonomously with the tools; don't ask questions — make good decisions. When done, reply with a brief summary.`
  const extend = c.brief?.scope === 'extend' ? '\nThis is an EXTENSION: keep everything that exists, continue the story consistently, and only add/adjust what the new part needs.' : ''
  const body: Record<string, string> = {
    premise:
      'Develop (or refine, if already present) the premise: central conflict, antagonist and their plan, stakes, setting region, themes, tone, a strong hook for the party. Update the campaign settings (update_campaign: premise, tone, artStyle, and name if it is still generic). Create one note "Campaign Overview" with the big picture, secrets and the overall arc (GM-only info in secrets).',
    outline:
      'Create the chapters (type chapter, use order) and their scenes (type scene, parent = chapter name, use order). Chapter body: GM overview — situation, goals, how the party enters and leaves, key choices — then the scene flow with [[links]]. Scene body: a concise outline of what happens (details come later). Reference planned NPCs, locations and encounters by [[Name]] — they will be created in later steps. If the adventure has a dungeon or complex site (cave system, ruin, keep, ship, sewer…), create it as a "dungeon" entry with name, summary and concept in body — it is designed in full (rooms, encounters, maps) in a later step; don\'t create its rooms yourself.',
    locations:
      'Create all locations the story references (check the outline for [[links]] that do not exist yet) plus other key places. Each: summary, evocative read-aloud description ("> "), notable features (with game-relevant details), inhabitants, secrets, hooks. Use parent for sub-locations (e.g. rooms/areas of a dungeon or building).',
    npcs:
      'Create all NPCs and factions the story references plus other useful ones. NPC body: appearance, voice/mannerism, personality, motivation, what they know, how they react to the party; secrets in "secrets". Give stat blocks to NPCs who might fight (official creature as base where sensible).',
    encounters: `Create an encounter entity for every combat or hazard in the scenes. Balance for ${c.partySize} characters of level ${c.partyLevel} (vary difficulty; use the system's encounter-building rules). Use official creatures (search_rules to find exact names and levels) where they fit; otherwise create homebrew creature entities with complete stat blocks first. Include tactics, terrain/cover, morale, and what happens on victory/defeat. Link each encounter from its scene (edit the scene text).`,
    links:
      'Some [[links]] in the campaign do not resolve to any entry or official rule. Create each missing entry now (homebrew with full mechanics where it is a rules element; or the NPC/location/item it refers to). If a link is just misspelled, fix the link text in the referencing entry instead.',
  }
  return `${head}${extend}\n\n${body[step] ?? ''}${extra ? `\n\n${extra}` : ''}`
}

export type StepStatus = 'idle' | 'running' | 'review' | 'done' | 'skipped' | 'error' | 'manual'

interface BuilderRun {
  campaignId: string
  status: Record<string, StepStatus>
  batches: Record<string, string[]>
  progress: string
  running: boolean
  stopRequested: boolean
  /** resolves the assisted-review pause */
  reviewResolver?: (decision: 'continue' | 'stop') => void
  error?: string
}

interface BuilderStore {
  runs: Record<string, BuilderRun>
  start: (campaign: Campaign, opts?: { only?: string; allAuto?: boolean; from?: string }) => Promise<void>
  decide: (campaignId: string, decision: 'continue' | 'stop') => void
  stop: (campaignId: string) => void
  feedback: (campaignId: string, stepId: string, text: string) => Promise<void>
  threadId: (campaignId: string) => Promise<string>
}

const threadPromises = new Map<string, Promise<string>>()

/** Get or create the builder's chat thread (deduplicated against concurrent calls). */
function builderThread(campaignId: string): Promise<string> {
  let p = threadPromises.get(campaignId)
  if (!p) {
    p = findOrCreateBuilderThread(campaignId).catch((e) => {
      threadPromises.delete(campaignId)
      throw e
    })
    threadPromises.set(campaignId, p)
  }
  return p.then(async (id) => {
    if (await db.threads.get(id)) return id
    threadPromises.delete(campaignId)
    return builderThread(campaignId)
  })
}

async function findOrCreateBuilderThread(campaignId: string): Promise<string> {
  const existing = await db.threads.where('campaignId').equals(campaignId).filter((t) => t.title === 'Module Builder').first()
  if (existing) return existing.id
  const t: ChatThread = { id: newId('th'), campaignId, title: 'Module Builder', createdAt: Date.now(), updatedAt: Date.now() }
  await db.threads.add(t)
  return t.id
}

const IMAGE_TYPES: Entity['type'][] = ['npc', 'location', 'dungeon', 'chapter', 'creature', 'item', 'faction']

export async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>, shouldStop: () => boolean) {
  let i = 0
  const worker = async () => {
    while (i < items.length && !shouldStop()) {
      const it = items[i++]
      await fn(it)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

export const useBuilder = create<BuilderStore>((set, get) => {
  const patch = (cid: string, p: Partial<BuilderRun> | ((r: BuilderRun) => Partial<BuilderRun>)) =>
    set((s) => {
      const cur = s.runs[cid]
      if (!cur) return s
      const add = typeof p === 'function' ? p(cur) : p
      return { runs: { ...s.runs, [cid]: { ...cur, ...add } } }
    })
  const setStatus = (cid: string, step: string, st: StepStatus) => patch(cid, (r) => ({ status: { ...r.status, [step]: st } }))
  const addBatch = (cid: string, step: string, batch: string) => patch(cid, (r) => ({ batches: { ...r.batches, [step]: [...(r.batches[step] ?? []), batch] } }))
  const stopped = (cid: string) => !!get().runs[cid]?.stopRequested

  async function runAgentStep(cid: string, thread: string, prompt: string): Promise<string | null> {
    const batch = await useAgentRun.getState().send(cid, thread, prompt)
    return batch
  }

  async function runStep(campaign: Campaign, step: StepDef, thread: string) {
    const cid = campaign.id
    const fresh = (await db.campaigns.get(cid))!
    const ctx: ChangeCtx = { batchId: newId('b'), source: 'ai' }
    if (step.kind === 'agent') {
      patch(cid, { progress: `${step.title}…` })
      const b = await runAgentStep(cid, thread, stepPrompt(step.id, fresh))
      if (!b) throw new Error('The AI step did not complete')
      addBatch(cid, step.id, b)
      return
    }
    if (step.id === 'dungeons') {
      const { completeEntity } = await import('@/ai/complete')
      const todo = (await db.entities.where({ campaignId: cid, type: 'dungeon' }).toArray()).filter((d) => !d.dungeon?.rooms?.length)
      for (const [i, d] of todo.entries()) {
        if (stopped(cid)) return
        patch(cid, { progress: `Designing dungeon ${i + 1}/${todo.length}: ${d.name}` })
        try {
          // images come in the illustrations step
          await completeEntity(fresh, { type: 'dungeon', id: d.id, draft: {} }, new Set(['text', 'rooms', 'creatures', 'map', 'roomMaps', 'links']), {}, (_sid, p) => p.detail && patch(cid, { progress: `${d.name}: ${p.detail}` }), ctx)
        } catch (e: any) {
          patch(cid, { error: `Dungeon “${d.name}”: ${e.message}` })
        }
      }
      addBatch(cid, step.id, ctx.batchId)
      return
    }
    if (step.id === 'write') {
      const chapters = (await db.entities.where({ campaignId: cid, type: 'chapter' }).toArray()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const todo = fresh.brief?.scope === 'extend' ? chapters.filter((c) => !c.tags.includes('written')) : chapters
      for (const [i, ch] of todo.entries()) {
        if (stopped(cid)) return
        patch(cid, { progress: `Writing chapter ${i + 1}/${todo.length}: ${ch.name}` })
        const b = await runAgentStep(
          cid,
          thread,
          stepPrompt(
            'write',
            fresh,
            `Write chapter “${ch.name}” (id ${ch.id}) and all its scenes out in full, playable detail: read-aloud boxes ("> "), what happens and why, NPC lines and reactions, skill checks with DCs, clues, treasure (official items linked), consequences and transitions to the next scene. Keep the existing structure, expand and improve it. Link every rules element and entry with [[ ]]. Finish by adding the tag "written" to the chapter (update_entity tags).`,
          ),
        )
        if (b) addBatch(cid, step.id, b)
      }
      return
    }
    if (step.id === 'links') {
      await loadCompendium(fresh.system)
      for (let round = 0; round < 2; round++) {
        const ents = await db.entities.where('campaignId').equals(cid).toArray()
        const index = new EntityIndex(ents)
        const missing = new Map<string, string[]>()
        for (const e of ents) {
          for (const t of extractLinks(`${e.body}\n${e.secrets ?? ''}\n${(e.stats?.actions ?? []).map((a) => a.text ?? '').join('\n')}`)) {
            const r = resolveLink(t, index, fresh.system)
            if (r.kind === 'unresolved') missing.set(t, [...(missing.get(t) ?? []), e.name])
          }
        }
        if (!missing.size) return
        patch(cid, { progress: `Creating ${missing.size} missing entries…` })
        const list = [...missing.entries()]
          .slice(0, 60)
          .map(([t, where]) => `- [[${t}]] (used in: ${[...new Set(where)].slice(0, 3).join(', ')})`)
          .join('\n')
        const b = await runAgentStep(cid, thread, stepPrompt('links', fresh, `Unresolved links:\n${list}`))
        if (b) addBatch(cid, step.id, b)
        if (stopped(cid)) return
      }
      return
    }
    if (step.id === 'maps') {
      const ents = await db.entities.where('campaignId').equals(cid).toArray()
      const maps = await db.maps.where('campaignId').equals(cid).toArray()
      const todo = ents.filter((e) => e.type === 'encounter' && !(e.encounter?.mapId && maps.some((m) => m.id === e.encounter!.mapId)))
      let n = 0
      await pool(
        todo,
        2,
        async (enc) => {
          patch(cid, { progress: `Painting battle map ${++n}/${todo.length}: ${enc.name}` })
          const loc = ents.find((l) => l.type === 'location' && (enc.body.includes(l.name) || enc.parentId === l.id))
          const description = `${enc.name}\n${enc.encounter?.tactics ?? ''}\n${enc.body}\n${loc ? `Location: ${loc.name}\n${loc.body}` : ''}`.slice(0, 5000)
          const map = await createMap(cid, { name: enc.name, description, encounterId: enc.id, locationId: loc?.id, width: 30 * 70, height: 20 * 70 }, ctx)
          await updateEntity(enc.id, { encounter: { ...(enc.encounter ?? { creatures: [] }), mapId: map.id } }, ctx)
          try {
            const r = await generateBattlemapImage(fresh, description, { cols: 30, rows: 20 })
            await updateMap(map.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } })
          } catch (e: any) {
            patch(cid, { error: `Map “${enc.name}”: ${e.message}` })
          }
          await seedEncounterMap(map.id, ctx)
        },
        () => stopped(cid),
      )
      addBatch(cid, step.id, ctx.batchId)
      return
    }
    if (step.id === 'art') {
      const ents = await db.entities.where('campaignId').equals(cid).toArray()
      const todo = ents.filter((e) => IMAGE_TYPES.includes(e.type) && !e.images.length && (e.type !== 'creature' || !e.tags.includes('official')))
      let n = 0
      await pool(
        todo,
        3,
        async (e) => {
          patch(cid, { progress: `Illustrating ${++n}/${todo.length}: ${e.name}` })
          try {
            const cur = await db.entities.get(e.id)
            if (cur && !cur.images.length) await illustrateEntity(fresh, cur, undefined, ctx)
          } catch (err: any) {
            patch(cid, { error: `${e.name}: ${err.message}` })
          }
        },
        () => stopped(cid),
      )
      // portraits for rules creatures used in encounters
      {
        const { creatureTargetsForEncounters, paintCreature } = await import('@/lib/creatureArt')
        const encIds = ents.filter((e) => e.type === 'encounter').map((e) => e.id)
        const targets = (await creatureTargetsForEncounters(cid, encIds)).filter((t) => t.source === 'rules')
        let k = 0
        await pool(
          targets,
          3,
          async (t) => {
            patch(cid, { progress: `Creature portrait ${++k}/${targets.length}: ${t.name}` })
            try {
              await paintCreature(cid, t, ctx)
            } catch (err: any) {
              patch(cid, { error: `${t.name}: ${err.message}` })
            }
          },
          () => stopped(cid),
        )
      }
      if (!fresh.coverImage) {
        try {
          const ch = ents.find((x) => x.type === 'chapter')
          const withImg = ch ? await db.entities.get(ch.id) : undefined
          if (withImg?.images[0]) await updateCampaign(cid, { coverImage: withImg.images[0] })
        } catch {
          /* ignore */
        }
      }
      addBatch(cid, step.id, ctx.batchId)
    }
  }

  return {
    runs: {},
    threadId: builderThread,
    start: async (campaign, opts = {}) => {
      const cid = campaign.id
      if (get().runs[cid]?.running) return
      const thread = await builderThread(cid)
      set((s) => ({
        runs: {
          ...s.runs,
          [cid]: { campaignId: cid, status: opts.only ? { ...(s.runs[cid]?.status ?? {}) } : {}, batches: s.runs[cid]?.batches ?? {}, progress: '', running: true, stopRequested: false },
        },
      }))
      const startIdx = opts.from ? STEPS.findIndex((s) => s.id === opts.from) : 0
      const steps = opts.only ? STEPS.filter((s) => s.id === opts.only) : STEPS.slice(Math.max(0, startIdx))
      try {
        for (const step of steps) {
          if (stopped(cid)) break
          const c = (await db.campaigns.get(cid))!
          const mode: AutomationMode = opts.allAuto ? 'auto' : (c.pipeline[step.id] ?? step.defaultMode)
          if (mode === 'manual' && !opts.only) {
            setStatus(cid, step.id, 'manual')
            continue
          }
          setStatus(cid, step.id, 'running')
          try {
            await runStep(c, step, thread)
          } catch (e: any) {
            setStatus(cid, step.id, 'error')
            patch(cid, { error: e?.message ?? String(e) })
            break
          }
          if (stopped(cid)) {
            setStatus(cid, step.id, 'idle')
            break
          }
          await updateCampaign(cid, { pipelineDone: { ...((await db.campaigns.get(cid))?.pipelineDone ?? {}), [step.id]: true } })
          if (mode === 'assisted' && !opts.allAuto) {
            setStatus(cid, step.id, 'review')
            patch(cid, { progress: `Review “${step.title}”` })
            const decision = await new Promise<'continue' | 'stop'>((resolve) => patch(cid, { reviewResolver: resolve }))
            patch(cid, { reviewResolver: undefined })
            setStatus(cid, step.id, 'done')
            if (decision === 'stop') break
          } else setStatus(cid, step.id, 'done')
        }
      } finally {
        patch(cid, { running: false, progress: '' })
      }
    },
    decide: (cid, decision) => get().runs[cid]?.reviewResolver?.(decision),
    stop: (cid) => {
      patch(cid, { stopRequested: true })
      const thread = get().runs[cid]
      if (thread) builderThread(cid).then((t) => useAgentRun.getState().stop(t))
      get().runs[cid]?.reviewResolver?.('stop')
    },
    feedback: async (cid, stepId, text) => {
      const thread = await builderThread(cid)
      patch(cid, { progress: 'Applying your feedback…' })
      const b = await useAgentRun.getState().send(cid, thread, `Feedback from the GM on the step you just did — please revise accordingly:\n${text}`)
      if (b) addBatch(cid, stepId, b)
      patch(cid, { progress: '' })
    },
  }
})
