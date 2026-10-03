import { db } from '@/db/db'
import { createEntity, createMap, updateEntity, updateMap, type ChangeCtx } from '@/db/repo'
import { loadCompendium, compendium, getRef } from '@/compendium/compendium'
import { EntityIndex, extractLinks, resolveLink } from '@/lib/links'
import { resolveCreature } from '@/lib/creatures'
import { encounterDifficulty } from '@/lib/encounterMath'
import { seedEncounterMap } from '@/lib/encounterSetup'
import { creatureTargetsForEncounters, paintCreature, type ArtTarget } from '@/lib/creatureArt'
import { refSubject } from '@/lib/refArt'
import { ENTITY_TYPES } from '@/lib/entityTypes'
import { levelFor } from '@/lib/levels'
import { getSettings } from '@/state/settings'
import { chatJson } from './openrouter'
import { entitySubject, generateBattlemapImage, generateEntityData, illustrateEntity, sanitizeEntityData, writeImagePrompts } from './generate'
import { campaignHeader, entityIndexLine, gmPreferences, LINK_RULES, languageRule, STATBLOCK_SCHEMA } from './prompts'
import type { Campaign, EncounterCreature, Entity, EntityType } from '@/types'
import { SYSTEM_LABEL } from '@/types'

// ---------------------------------------------------------------------------
// Parts & job steps
// ---------------------------------------------------------------------------

export type Part = 'text' | 'stats' | 'encounter' | 'creatures' | 'creatureArt' | 'map' | 'image' | 'links' | 'rooms' | 'roomMaps' | 'roomImages'

export const PART_LABEL: Record<Part, string> = {
  text: 'Text & description',
  stats: 'Stat block',
  encounter: 'Creatures, tactics & difficulty',
  creatures: 'Create missing creatures (homebrew, full stats)',
  creatureArt: 'Portraits for its creatures (also used as tokens)',
  map: 'Battle map (painted, creatures placed)',
  image: 'Illustration',
  links: 'Create linked entries that don’t exist yet',
  rooms: 'Rooms, passages & room encounters',
  roomMaps: 'Detailed maps for rooms with encounters',
  roomImages: 'Illustrations for rooms',
}

export function partsFor(type: EntityType): Part[] {
  switch (type) {
    case 'encounter':
      return ['text', 'encounter', 'creatures', 'creatureArt', 'map', 'image', 'links']
    case 'npc':
    case 'creature':
      return ['text', 'stats', 'image', 'links']
    case 'dungeon':
      return ['text', 'rooms', 'creatures', 'creatureArt', 'map', 'roomMaps', 'image', 'roomImages', 'links']
    case 'note':
      return ['text']
    default:
      return ['text', 'image', 'links']
  }
}

/** Entry types where the GM picks the party level in the generate panel. */
export const LEVEL_TYPES: EntityType[] = ['encounter', 'dungeon', 'npc', 'creature', 'chapter', 'scene', 'location', 'item']

/** parts that need an image model (for cost hints) */
export const IMAGE_PARTS: Part[] = ['map', 'image', 'creatureArt', 'roomMaps', 'roomImages']

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'
export interface JobStep {
  id: string
  label: string
  status: StepStatus
  detail?: string
}
export type Report = (id: string, patch: Partial<JobStep>) => void

/** Steps shown in the UI for a job (several run at the same time). */
export function stepsFor(type: EntityType, parts: Set<Part>): JobStep[] {
  const s = (id: string, label: string): JobStep => ({ id, label, status: 'pending' })
  const out: JobStep[] = []
  if (type === 'dungeon') {
    out.push(s('design', parts.has('rooms') ? 'Design layout, rooms & encounters' : 'Write dungeon text'))
    out.push(s('save', 'Save entries'))
    if (parts.has('rooms')) out.push(s('rooms', 'Write all rooms (in parallel)'))
    if (parts.has('creatures')) out.push(s('creatures', PART_LABEL.creatures))
    if (parts.has('map')) out.push(s('map', 'Paint overview map from the floor plan'))
    if (parts.has('image')) out.push(s('image', 'Dungeon illustration'))
    if (parts.has('creatureArt')) out.push(s('creatureArt', 'Creature portraits'))
    if (parts.has('roomMaps')) out.push(s('roomMaps', PART_LABEL.roomMaps))
    if (parts.has('roomImages')) out.push(s('roomImages', PART_LABEL.roomImages))
    if (parts.has('links')) out.push(s('links', PART_LABEL.links))
    return out
  }
  const writes = [parts.has('text') && 'text', parts.has('stats') && 'stat block', parts.has('encounter') && 'creatures & tactics'].filter(Boolean)
  if (writes.length) out.push(s('write', `Write ${writes.join(', ')}`))
  out.push(s('save', 'Save'))
  if (parts.has('creatures')) out.push(s('creatures', PART_LABEL.creatures))
  if (parts.has('map')) out.push(s('map', PART_LABEL.map))
  if (parts.has('image')) out.push(s('image', PART_LABEL.image))
  if (parts.has('creatureArt')) out.push(s('creatureArt', 'Creature portraits'))
  if (parts.has('links')) out.push(s('links', PART_LABEL.links))
  return out
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const crNum = (cr?: string) => (cr ? (cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr)) : 0)

/** Official creatures in a sensible range around the party level + campaign creatures, as a name list for prompts. */
export async function creatureCandidates(campaign: Campaign, entities: Entity[], level = campaign.partyLevel): Promise<string> {
  await loadCompendium(campaign.system)
  const c = compendium(campaign.system)
  const official = (c?.entries ?? [])
    .filter((e) => e.category === 'creature' && e.stats)
    .filter((e) =>
      campaign.system === 'pf2e' ? (e.level ?? 0) >= level - 4 && (e.level ?? 0) <= level + 4 : crNum(e.cr) <= Math.max(1, level + 3) && crNum(e.cr) >= Math.max(0, level / 4 - 1),
    )
    .map((e) => `${e.name} (${campaign.system === 'pf2e' ? `L${e.level}` : `CR ${e.cr}`}; ${(e.traits ?? []).slice(0, 3).join(', ')})`)
  const own = entities
    .filter((e) => (e.type === 'creature' || e.type === 'npc') && e.stats)
    .map((e) => `${e.name} (${campaign.system === 'pf2e' ? `L${e.stats!.level ?? '?'}` : `CR ${e.stats!.cr ?? '?'}`}; campaign ${e.type})`)
  return [...own, ...official].join('\n')
}

export const ENCOUNTER_RULES = (c: Campaign, level: number) => `ENCOUNTER RULES:
- Party: ${c.partySize} characters of level ${level} — this is the level where this is played; balance for it.
- Put the creatures ONLY into "encounter.creatures" as [{"name", "count"}] — never as prose that needs parsing. Use EXACT names from AVAILABLE CREATURES whenever one fits.
- If nothing fits, invent a homebrew creature: give it a new name and "homebrew": true (plus a one-line "concept" and target "level"); it will be created with a full stat block automatically.
- Use the system's encounter-building rules (${c.system === 'pf2e' ? 'XP budget by creature level relative to party level' : 'XP budget by CR'}); state the result in "difficulty".
- "tactics": how the creatures fight, morale, what they want.
- "map": {"description": a concrete, organic visual prompt for an image model painting the top-down battlefield (terrain, cover, features, light — any shape, no default rooms, no creatures, no text), "cols": width in 5-ft squares (12–40), "rows": height (10–30)}.
- The body is the GM text for running it: situation & read-aloud ("> "), terrain features with mechanics, development, what happens on victory/defeat. Link creatures and rules with [[ ]].`

export async function createHomebrewCreature(campaign: Campaign, name: string, context: string, ctx: ChangeCtx): Promise<Entity> {
  const entities = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const data = await generateEntityData(campaign, entities, { type: 'creature', name, withStats: true, instructions: context })
  return createEntity(campaign.id, 'creature', { ...data, name, tags: [...new Set([...(data.tags ?? []), 'homebrew'])] }, ctx)
}

/**
 * Resolve encounter creatures to campaign/official stat blocks; create homebrew creatures for the rest —
 * all in parallel. `shared` deduplicates homebrew creatures across encounters of one job.
 */
export async function resolveEncounterCreatures(
  campaign: Campaign,
  enc: Entity,
  hints: Record<string, { concept?: string; level?: number }>,
  ctx: ChangeCtx,
  onProgress?: (s: string) => void,
  shared: Map<string, Promise<Entity>> = new Map(),
  level?: number,
): Promise<EncounterCreature[]> {
  await loadCompendium(campaign.system)
  const entities = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const index = new EntityIndex(entities)
  return Promise.all(
    (enc.encounter?.creatures ?? []).map(async (c) => {
      const info = resolveCreature(c.refId, c.name, index, campaign.system)
      if (info?.stats) return { refId: info.refId, name: info.name, count: c.count }
      const key = c.name.trim().toLowerCase()
      let p = shared.get(key)
      if (!p) {
        onProgress?.(`Creating ${c.name}`)
        const h = hints[key]
        const target = h?.level ?? level
        p = createHomebrewCreature(
          campaign,
          c.name,
          `Appears in the encounter “${enc.name}” (${c.count}×). ${h?.concept ?? ''} ${target !== undefined ? `Target ${campaign.system === 'pf2e' ? 'level' : 'CR'}: ${target}.` : ''} The party is level ${level ?? campaign.partyLevel}.\nEncounter: ${enc.summary}\n${enc.body.slice(0, 1500)}`,
          ctx,
        )
        shared.set(key, p)
      }
      const created = await p
      return { refId: created.id, name: created.name, count: c.count }
    }),
  )
}

export async function computeDifficultyLabel(campaign: Campaign, creatures: EncounterCreature[], level = campaign.partyLevel): Promise<string> {
  const entities = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const index = new EntityIndex(entities)
  const d = encounterDifficulty(
    campaign.system,
    creatures.map((c) => ({ count: c.count, stats: resolveCreature(c.refId, c.name, index, campaign.system)?.stats })),
    level,
    campaign.partySize,
  )
  return `${d.label} (${d.xp} XP for ${campaign.partySize}× level ${level})`
}

/** Create entries for [[links]] in the given entities that resolve to nothing. Returns created count. */
export async function createMissingLinks(campaign: Campaign, entityIds: string[], ctx: ChangeCtx, onProgress?: (s: string) => void): Promise<number> {
  await loadCompendium(campaign.system)
  const all = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const index = new EntityIndex(all)
  const missing = new Map<string, { name: string; where: string }>()
  for (const e of all.filter((x) => entityIds.includes(x.id))) {
    const text = `${e.body}\n${e.secrets ?? ''}\n${(e.stats?.actions ?? []).map((a) => a.text ?? '').join('\n')}`
    for (const t of extractLinks(text)) {
      if (resolveLink(t, index, campaign.system).kind === 'unresolved' && !missing.has(t.toLowerCase())) missing.set(t.toLowerCase(), { name: t, where: e.name })
    }
  }
  if (!missing.size) return 0
  const list = [...missing.values()]
  const types = Object.keys(ENTITY_TYPES).filter((t) => t !== 'note' && t !== 'chapter')
  const { data } = await chatJson<Record<string, string>>({
    label: 'Sorting missing entries',
    model: getSettings().fastModel,
    temperature: 0,
    messages: [
      { role: 'system', content: `Classify each tabletop RPG reference into one entry type: ${types.join(', ')}. Rules mechanics, conditions, actions and house rules are "rule". Return ONLY JSON {name: type}.` },
      { role: 'user', content: JSON.stringify(list) },
    ],
  })
  let n = 0
  await Promise.all(
    list.map(async (it) => {
      const type = (types.includes(data?.[it.name]) ? data[it.name] : 'rule') as EntityType
      onProgress?.(`Creating ${ENTITY_TYPES[type].label} “${it.name}”`)
      try {
        const ents = await db.entities.where('campaignId').equals(campaign.id).toArray()
        const d = await generateEntityData(campaign, ents, {
          type,
          name: it.name,
          withStats: type === 'creature',
          instructions: `Referenced as [[${it.name}]] in “${it.where}”. Create it so it fits there.`,
        })
        await createEntity(campaign.id, type, { ...d, name: it.name, aliases: d.name && d.name !== it.name ? [d.name, ...(d.aliases ?? [])] : d.aliases }, ctx)
        n++
      } catch (e) {
        console.warn('link entry failed', it.name, e)
      }
    }),
  )
  return n
}

/** Paint portraits for creature targets: batched prompts, then all images (the request limiter caps concurrency). */
export async function paintAll(campaignId: string, targets: ArtTarget[], ctx: ChangeCtx, detail: (d: string) => void, signal?: AbortSignal) {
  if (!targets.length) return
  const campaign = await db.campaigns.get(campaignId)
  if (!campaign) return
  await loadCompendium(campaign.system)
  const subjects = await Promise.all(
    targets.map(async (t) => {
      if (t.source === 'rules') {
        const r = getRef(campaign.system, t.id)
        return { id: t.id, subject: r ? refSubject(r) : t.name }
      }
      const e = await db.entities.get(t.id)
      return { id: t.id, subject: e ? entitySubject(e) : t.name }
    }),
  )
  const prompts = await writeImagePrompts(campaign, subjects)
  let n = 0
  const errors: string[] = []
  await Promise.all(
    targets.map(async (t) => {
      if (signal?.aborted) return
      try {
        await paintCreature(campaignId, t, ctx, prompts[t.id])
      } catch (e: any) {
        errors.push(`${t.name}: ${e.message}`)
      }
      detail(`${++n}/${targets.length} portraits`)
    }),
  )
  if (errors.length) detail(errors.join('; '))
}

// ---------------------------------------------------------------------------
// Complete one entity
// ---------------------------------------------------------------------------

export interface CompleteInput {
  type: EntityType
  /** existing entity to complete (otherwise a new one is created from the draft) */
  id?: string
  draft: Partial<Entity>
}

export interface CompleteOptions {
  instructions?: string
  /** dungeon size */
  size?: 'small' | 'medium' | 'large'
  /** party level where this is played (default: inherited, see levelFor) */
  level?: number
  signal?: AbortSignal
}

/** Run a step: reports status, never throws unless fatal (or aborted). */
export function makeStep(report: Report, signal?: AbortSignal) {
  return async <T,>(id: string, fn: (detail: (d: string) => void) => Promise<T>, fatal = false): Promise<T | undefined> => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    report(id, { status: 'running' })
    try {
      const r = await fn((d) => report(id, { detail: d }))
      report(id, { status: 'done' })
      return r
    } catch (e: any) {
      report(id, { status: 'error', detail: e?.message ?? String(e) })
      if (fatal || e?.name === 'AbortError') throw e
      return undefined
    }
  }
}

export async function completeEntity(
  campaign: Campaign,
  input: CompleteInput,
  parts: Set<Part>,
  opts: CompleteOptions,
  report: Report,
  ctx: ChangeCtx,
): Promise<string> {
  if (input.type === 'dungeon') {
    const { buildDungeon } = await import('./dungeon')
    return buildDungeon(campaign, input, parts, opts, report, ctx)
  }
  const step = makeStep(report, opts.signal)
  const type = input.type
  const existing = input.id ? await db.entities.get(input.id) : undefined
  const base: Partial<Entity> = { ...existing, ...input.draft }
  const entities0 = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const level = opts.level ?? levelFor(base, entities0, campaign)
  const wantText = parts.has('text')
  const wantStats = parts.has('stats') && (type === 'npc' || type === 'creature')
  const wantEnc = parts.has('encounter') && type === 'encounter'
  const wantImage = parts.has('image')
  let hints: Record<string, { concept?: string; level?: number }> = {}
  let mapPlan: { description?: string; cols?: number; rows?: number } | undefined
  let imagePrompt: string | undefined
  const fields: Partial<Entity> = {}

  // 1) one writing call: text, stats, encounter structure — plus the image/map prompts (saves extra calls later)
  if (wantText || wantStats || wantEnc) {
    await step(
      'write',
      async () => {
        const sys = [
          `You are an expert ${SYSTEM_LABEL[campaign.system]} game designer helping a GM. Return ONLY a JSON object.`,
          campaignHeader(campaign),
          `This ${ENTITY_TYPES[type].label.toLowerCase()} is played at party level ${level}: make DCs, threats, stats and treasure fit that level.`,
          languageRule(campaign),
          LINK_RULES,
          wantStats ? STATBLOCK_SCHEMA : '',
          wantEnc ? ENCOUNTER_RULES(campaign, level) : '',
          wantEnc ? `AVAILABLE CREATURES (exact names):\n${await creatureCandidates(campaign, entities0, level)}` : '',
          `Existing campaign entries (link to them where relevant):\n${entities0.slice(0, 300).map(entityIndexLine).join('\n')}`,
          gmPreferences(wantEnc ? [type, 'creature'] : [type], true),
        ]
          .filter(Boolean)
          .join('\n\n')
        const keys = [
          wantText && '"name", "aliases" (string[]), "summary" (one line), "body" (markdown), "secrets", "tags" (string[])',
          wantStats && '"stats" (complete StatBlock fitting the description, role and level)',
          wantEnc && '"encounter": {"creatures": [{"name","count","homebrew"?,"concept"?,"level"?}], "tactics", "difficulty", "map": {"description","cols","rows"}}',
          wantImage && '"imagePrompt" (English prompt for an image model: an evocative illustration of it, no text or letters, max 100 words)',
        ]
          .filter(Boolean)
          .join(', ')
        const user = [
          `${existing || base.body || base.summary ? 'Complete and improve' : 'Create'} this ${ENTITY_TYPES[type].label}.`,
          `Current state (keep what is good, fill everything missing): ${JSON.stringify({ name: base.name, summary: base.summary, body: base.body, secrets: base.secrets, encounter: base.encounter, stats: base.stats ? 'present' : undefined })}`,
          opts.instructions && `GM instructions: ${opts.instructions}`,
          !wantText && 'Do NOT rewrite the text fields; only produce the requested structured fields.',
          `Return JSON with: ${keys}.`,
        ]
          .filter(Boolean)
          .join('\n')
        const { data } = await chatJson<any>({
          label: `Writing ${ENTITY_TYPES[type].label}: ${base.name || 'new'}`,
          model: getSettings().chatModel,
          temperature: 0.8,
          signal: opts.signal,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: user },
          ],
        })
        const clean = sanitizeEntityData(data)
        if (wantText) Object.assign(fields, { name: clean.name, aliases: clean.aliases, summary: clean.summary, body: clean.body, secrets: clean.secrets, tags: clean.tags })
        if (wantStats && clean.stats) fields.stats = clean.stats
        if (typeof data?.imagePrompt === 'string') imagePrompt = data.imagePrompt
        if (wantEnc && data?.encounter) {
          const raw: any[] = Array.isArray(data.encounter.creatures) ? data.encounter.creatures : []
          hints = Object.fromEntries(raw.map((c) => [String(c.name ?? '').toLowerCase(), { concept: c.concept, level: typeof c.level === 'number' ? c.level : undefined }]))
          fields.encounter = {
            ...(base.encounter ?? { creatures: [] }),
            creatures: raw.filter((c) => c?.name).map((c) => ({ refId: '', name: String(c.name), count: Math.max(1, Number(c.count) || 1) })),
            tactics: data.encounter.tactics ?? base.encounter?.tactics,
            difficulty: data.encounter.difficulty ?? base.encounter?.difficulty,
          }
          mapPlan = data.encounter.map
        }
        for (const k of Object.keys(fields) as (keyof Entity)[]) if (fields[k] === undefined) delete fields[k]
      },
      true,
    )
  }

  // 2) save
  const saved = (await step(
    'save',
    async () => {
      const data: Partial<Entity> = { ...input.draft, ...fields }
      if (!data.name) data.name = base.name || 'Unnamed'
      if ((type === 'encounter' || opts.level !== undefined) && base.level === undefined) data.level = level
      if (existing) return updateEntity(existing.id, data, ctx)
      return createEntity(campaign.id, type, data, ctx)
    },
    true,
  ))!

  // 3) everything below runs concurrently where it can
  const creaturesDone: Promise<unknown> =
    parts.has('creatures') && type === 'encounter'
      ? step('creatures', async (detail) => {
          const enc = (await db.entities.get(saved.id))!
          if (!enc.encounter?.creatures.length) return detail('no creatures listed')
          const creatures = await resolveEncounterCreatures(campaign, enc, hints, ctx, detail, new Map(), level)
          const difficulty = await computeDifficultyLabel(campaign, creatures, level)
          const fresh = (await db.entities.get(enc.id))!
          await updateEntity(enc.id, { encounter: { ...(fresh.encounter ?? { creatures: [] }), creatures, difficulty } }, ctx)
          detail(`${creatures.reduce((s, c) => s + c.count, 0)} creatures · ${difficulty}`)
        })
      : Promise.resolve()

  const mapDone: Promise<unknown> =
    parts.has('map') && type === 'encounter'
      ? step('map', async (detail) => {
          const enc = (await db.entities.get(saved.id))!
          const maps = await db.maps.where('campaignId').equals(campaign.id).toArray()
          let map = enc.encounter?.mapId ? maps.find((m) => m.id === enc.encounter!.mapId) : undefined
          const all = await db.entities.where('campaignId').equals(campaign.id).toArray()
          const loc = all.find((l) => l.type === 'location' && (l.id === enc.parentId || enc.body.includes(l.name)))
          const description = mapPlan?.description || `${enc.name}\n${enc.encounter?.tactics ?? ''}\n${enc.body}\n${loc ? `Location: ${loc.name}\n${loc.body}` : ''}`.slice(0, 5000)
          const cols = Math.max(10, Math.min(40, Number(mapPlan?.cols) || 30))
          const rows = Math.max(8, Math.min(30, Number(mapPlan?.rows) || 20))
          if (!map) {
            map = await createMap(campaign.id, { name: enc.name, description, encounterId: enc.id, locationId: loc?.id, width: cols * 70, height: rows * 70 }, ctx)
            const fresh = (await db.entities.get(enc.id))!
            await updateEntity(enc.id, { encounter: { ...(fresh.encounter ?? { creatures: [] }), mapId: map.id } }, ctx)
          }
          if (!map.image) {
            detail('painting…')
            // the writing call already produced a visual prompt — skip the prompt-writing call
            const r = await generateBattlemapImage(campaign, description, { cols, rows, promptOverride: mapPlan?.description })
            await updateMap(map.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } }, ctx)
          }
          // tokens need the resolved creatures
          detail('placing creatures…')
          await creaturesDone
          const n = await seedEncounterMap(map.id, ctx)
          detail(n ? `${n} tokens placed` : 'ready')
        })
      : Promise.resolve()

  const imageDone: Promise<unknown> = wantImage
    ? step('image', async () => {
        const e = (await db.entities.get(saved.id))!
        await illustrateEntity(campaign, e, opts.instructions, ctx, imagePrompt)
      })
    : Promise.resolve()

  const artDone: Promise<unknown> =
    parts.has('creatureArt') && type === 'encounter'
      ? (async () => {
          await creaturesDone
          return step('creatureArt', async (detail) => {
            const targets = await creatureTargetsForEncounters(campaign.id, [saved.id])
            if (!targets.length) return detail('all creatures already have art')
            await paintAll(campaign.id, targets, ctx, detail, opts.signal)
          })
        })()
      : Promise.resolve()

  // links include the action texts of new homebrew creatures, so wait for them
  const linksDone: Promise<unknown> = parts.has('links')
    ? (async () => {
        await creaturesDone
        return step('links', async (detail) => {
          const extra = (await db.changes.where('batchId').equals(ctx.batchId).toArray()).filter((c) => c.table === 'entities').map((c) => c.recordId)
          const n = await createMissingLinks(campaign, [...new Set([saved.id, ...extra])], ctx, detail)
          detail(n ? `${n} entries created` : 'all links resolve')
        })
      })()
    : Promise.resolve()

  await Promise.all([creaturesDone, mapDone, imageDone, artDone, linksDone])
  return saved.id
}
