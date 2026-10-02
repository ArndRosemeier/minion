import { db } from '@/db/db'
import { createEntity, createMap, updateEntity, updateMap, type ChangeCtx } from '@/db/repo'
import { newId } from '@/lib/id'
import { placeEncounter } from '@/lib/encounterSetup'
import { cropToDataUrl } from '@/lib/mapImage'
import { creatureTargetsForEncounters } from '@/lib/creatureArt'
import { levelFor } from '@/lib/levels'
import { getSettings } from '@/state/settings'
import { chatJson } from './openrouter'
import { generateBattlemapImage, illustrateEntity, sanitizeEntityData } from './generate'
import { campaignHeader, entityIndexLine, LINK_RULES, languageRule } from './prompts'
import {
  computeDifficultyLabel,
  createMissingLinks,
  creatureCandidates,
  makeStep,
  paintAll,
  resolveEncounterCreatures,
  type CompleteInput,
  type CompleteOptions,
  type Part,
  type Report,
} from './complete'
import type { BattleMap, Campaign, DungeonRoom, Entity, MapLink } from '@/types'
import { SYSTEM_LABEL } from '@/types'

type Pt = [number, number]

const SIZES = {
  small: { cols: 32, rows: 24, rooms: '4–6' },
  medium: { cols: 44, rows: 33, rooms: '7–10' },
  large: { cols: 60, rows: 45, rooms: '11–16' },
}

interface DesignRoom {
  key: string
  name: string
  /** 1–2 sentence concept; the full text is written per room in parallel */
  summary?: string
  shape: Pt[]
  encounter?: {
    name?: string
    concept?: string
    creatures?: { name: string; count?: number; homebrew?: boolean; concept?: string; level?: number }[]
    difficulty?: string
  } | null
}

interface Design {
  name?: string
  aliases?: string[]
  summary?: string
  body?: string
  secrets?: string
  tags?: string[]
  overview?: string
  imagePrompt?: string
  rooms?: DesignRoom[]
  passages?: { from: string; to: string; points: Pt[]; width?: number }[]
}

interface RoomText {
  body?: string
  secrets?: string
  imagePrompt?: string
  mapPrompt?: string
  encounter?: { summary?: string; body?: string; tactics?: string }
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

const clampPt = (p: Pt, cols: number, rows: number): Pt => [Math.max(0, Math.min(cols, Number(p[0]) || 0)), Math.max(0, Math.min(rows, Number(p[1]) || 0))]

export function bbox(shape: Pt[]) {
  const xs = shape.map((p) => p[0])
  const ys = shape.map((p) => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) }
}

export function centroid(shape: Pt[]): { x: number; y: number } {
  const b = bbox(shape)
  return { x: Math.floor(b.x + b.w / 2), y: Math.floor(b.y + b.h / 2) }
}

function validShape(s: unknown, cols: number, rows: number): Pt[] | null {
  if (!Array.isArray(s) || s.length < 3) return null
  const pts = s.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => clampPt(p as Pt, cols, rows))
  if (pts.length < 3) return null
  const b = bbox(pts)
  return b.w >= 2 && b.h >= 2 ? pts : null
}

/** Light floor on black rock — the plan the image model paints over. No text (it would be copied). */
export function renderSketch(cols: number, rows: number, rooms: { shape: Pt[] }[], passages: { points: Pt[]; width: number }[]): string {
  const W = 1024
  const cell = W / cols
  const c = document.createElement('canvas')
  c.width = W
  c.height = Math.round(rows * cell)
  const g = c.getContext('2d')!
  g.fillStyle = '#0d0d0d'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = g.strokeStyle = '#c8c8c8'
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const p of passages) {
    if (p.points.length < 2) continue
    g.lineWidth = Math.max(1, p.width) * cell
    g.beginPath()
    g.moveTo(p.points[0][0] * cell, p.points[0][1] * cell)
    for (const q of p.points.slice(1)) g.lineTo(q[0] * cell, q[1] * cell)
    g.stroke()
  }
  for (const r of rooms) {
    g.beginPath()
    g.moveTo(r.shape[0][0] * cell, r.shape[0][1] * cell)
    for (const q of r.shape.slice(1)) g.lineTo(q[0] * cell, q[1] * cell)
    g.closePath()
    g.fill()
  }
  return c.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// AI calls
// ---------------------------------------------------------------------------

async function designLayout(
  campaign: Campaign,
  base: Partial<Entity>,
  size: keyof typeof SIZES,
  level: number,
  withRooms: boolean,
  instructions: string | undefined,
  signal?: AbortSignal,
): Promise<Design> {
  const dims = SIZES[size]
  const entities = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const sys = [
    `You are a master dungeon designer for ${SYSTEM_LABEL[campaign.system]}. Return ONLY a JSON object.`,
    campaignHeader(campaign),
    `This dungeon is played at party level ${level} (${campaign.partySize} characters). Threats, DCs, hazards and treasure fit that level.`,
    languageRule(campaign),
    LINK_RULES,
    withRooms
      ? `FLOOR PLAN: The site is drawn on a grid of ${dims.cols} × ${dims.rows} squares (5 ft each). Coordinates are [x, y] in squares, x right (0–${dims.cols}), y down (0–${dims.rows}).
- Each area has an outline polygon "shape" (6–14 points). Make shapes ORGANIC and fitting the place — natural caves are irregular blobs, a crypt may be cross-shaped, a tower round, a ruin broken; never default to plain rectangles unless the place is built that way.
- Areas must not overlap; leave rock between them. Typical areas are 4–16 squares across; a grand cavern may be larger.
- "passages" connect areas as polylines (points in squares) with a "width" in squares (1–3). Every area must be reachable. At least one passage starts at a map edge (the entrance; use "from": "entrance").
- Use most of the grid; spread the areas out naturally.

AREAS (outline only — each area's full text is written afterwards):
- ${dims.rooms} areas keyed "1", "2", … in a sensible exploration order, each with "name" and "summary" (1–2 sentences: what is there and why it matters; mention traps, treasure, clues or roleplay if any).
- About half of the areas have an "encounter": {"name","concept" (one sentence),"creatures":[{"name","count","homebrew"?,"concept"?,"level"?}],"difficulty"}. Use EXACT names from AVAILABLE CREATURES; invent homebrew creatures only when nothing fits (set "homebrew": true with "concept" and "level"). Balance for ${campaign.partySize} characters of level ${level}, mixing difficulties, with a climax near the end.`
      : '',
    `DUNGEON TEXT: "body" (history, purpose, inhabitants and factions, how to enter, dungeon-wide features like light, sounds and wandering monsters, how areas connect), "secrets" (the big twist / GM info), "overview" (a concrete visual prompt for an image model painting the whole site top-down: materials, light, vegetation/water/debris, atmosphere; no text), "imagePrompt" (an evocative illustration of the place, no text).`,
    withRooms ? `AVAILABLE CREATURES (exact names):\n${await creatureCandidates(campaign, entities, level)}` : '',
    `Existing campaign entries (link to them where relevant):\n${entities.slice(0, 200).map(entityIndexLine).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const user = [
    `${withRooms ? 'Design this dungeon.' : 'Write the text of this dungeon.'} Concept so far: ${JSON.stringify({ name: base.name, summary: base.summary, body: base.body, secrets: base.secrets })}`,
    instructions && `GM instructions: ${instructions}`,
    `Return JSON: {"name","aliases","summary","body","secrets","tags","overview","imagePrompt"${withRooms ? ',"rooms":[{"key","name","summary","shape":[[x,y],…],"encounter":{…}|null}],"passages":[{"from","to","points":[[x,y],…],"width"}]' : ''}}`,
  ]
    .filter(Boolean)
    .join('\n')
  const { data } = await chatJson<Design>({
    label: `Designing dungeon: ${base.name || 'new'}`,
    model: getSettings().chatModel,
    temperature: 0.85,
    signal,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  })
  return data
}

/** Write one room's full text (runs in parallel for all rooms). */
async function writeRoom(
  campaign: Campaign,
  dungeon: Entity,
  outline: string,
  room: Entity,
  key: string,
  enc: Entity | undefined,
  level: number,
  signal?: AbortSignal,
): Promise<RoomText> {
  const sys = [
    `You write one area of a ${SYSTEM_LABEL[campaign.system]} dungeon for a GM. Return ONLY a JSON object.`,
    campaignHeader(campaign),
    `Party: ${campaign.partySize} characters of level ${level}. DCs, hazards and treasure fit that level.`,
    languageRule(campaign),
    LINK_RULES,
    `DUNGEON “${dungeon.name}”: ${dungeon.summary}\n${dungeon.body.slice(0, 2500)}`,
    `ALL AREAS (for consistency and exits):\n${outline}`,
  ].join('\n\n')
  const user = [
    `Write area ${key} “${room.name}”: ${room.summary}`,
    enc && `It has the encounter “${enc.name}” with ${(enc.encounter?.creatures ?? []).map((c) => `${c.count}× [[${c.name}]]`).join(', ')}. ${enc.summary}`,
    `Return JSON: {"body" (markdown: read-aloud "> " box, notable features with mechanics/DCs, treasure as [[links]] to official items, hazards/traps, clues, exits to other areas by key and name), "secrets", "imagePrompt" (English, evocative illustration of this area, no text, max 80 words), "mapPrompt" (English, top-down battle-map painting prompt of this area: terrain, cover, features, light; no creatures, no text, max 80 words)${enc ? ', "encounter": {"summary","body" (how it plays out: setup, read-aloud, development, victory/defeat),"tactics"}' : ''}}`,
  ]
    .filter(Boolean)
    .join('\n')
  const { data } = await chatJson<RoomText>({
    label: `Writing area ${key}: ${room.name}`,
    model: getSettings().chatModel,
    temperature: 0.85,
    signal,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  })
  return data ?? {}
}

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

export async function buildDungeon(
  campaign: Campaign,
  input: CompleteInput,
  parts: Set<Part>,
  opts: CompleteOptions,
  report: Report,
  ctx: ChangeCtx,
): Promise<string> {
  const step = makeStep(report, opts.signal)
  const existing = input.id ? await db.entities.get(input.id) : undefined
  const base: Partial<Entity> = { ...existing, ...input.draft }
  const all0 = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const level = opts.level ?? levelFor(base, all0, campaign)
  const size = opts.size ?? 'medium'
  const hasRooms = !!existing?.dungeon?.rooms?.length
  const wantRooms = parts.has('rooms') && !hasRooms
  const dims = existing?.dungeon?.cols ? { cols: existing.dungeon.cols, rows: existing.dungeon.rows ?? SIZES[size].rows } : SIZES[size]

  // 1) layout & outline (small, fast call — room texts come later in parallel)
  let d: Design = {}
  if (parts.has('text') || wantRooms) {
    await step(
      'design',
      async (detail) => {
        if (hasRooms && parts.has('rooms')) detail('rooms already exist — keeping them')
        d = await designLayout(campaign, base, size, level, wantRooms, opts.instructions, opts.signal)
        const rooms = (d.rooms ?? []).filter((r) => r && r.name)
        if (wantRooms) detail(`${rooms.length} areas, ${rooms.filter((r) => r.encounter?.creatures?.length).length} encounters`)
      },
      true,
    )
  } else report('design', { status: 'skipped' })

  // 2) save dungeon, rooms (outline) and encounters (creatures)
  const hints: Record<string, { concept?: string; level?: number }> = {}
  const saved = (await step(
    'save',
    async (detail) => {
      const text = parts.has('text') ? sanitizeEntityData(d) : {}
      const dungeonData: Partial<Entity> = { ...input.draft, ...text, name: text.name || base.name || 'Unnamed dungeon' }
      if (base.level === undefined) dungeonData.level = level
      let dungeon = existing ? await updateEntity(existing.id, dungeonData, ctx) : await createEntity(campaign.id, 'dungeon', dungeonData, ctx)
      if (!wantRooms) return dungeon
      const rooms: DungeonRoom[] = []
      let order = 0
      for (const r of d.rooms ?? []) {
        const shape = validShape(r.shape, dims.cols, dims.rows)
        if (!r?.name || !shape) continue
        const key = String(r.key ?? ++order)
        const room = await createEntity(campaign.id, 'location', { name: r.name, summary: r.summary ?? '', body: '', parentId: dungeon.id, tags: ['room', `room ${key}`] }, ctx)
        let encounterId: string | undefined
        if (r.encounter?.creatures?.length) {
          for (const c of r.encounter.creatures) hints[String(c.name).toLowerCase()] = { concept: c.concept, level: c.level }
          const enc = await createEntity(
            campaign.id,
            'encounter',
            {
              name: r.encounter.name || `${r.name}: encounter`,
              summary: r.encounter.concept ?? '',
              body: '',
              parentId: room.id,
              encounter: {
                creatures: r.encounter.creatures.filter((c) => c?.name).map((c) => ({ refId: '', name: String(c.name), count: Math.max(1, Number(c.count) || 1) })),
                difficulty: r.encounter.difficulty,
              },
            },
            ctx,
          )
          encounterId = enc.id
        }
        rooms.push({ key, locationId: room.id, shape, encounterId })
        detail(`${rooms.length} areas saved`)
      }
      const passages = (d.passages ?? [])
        .filter((p) => Array.isArray(p?.points) && p.points.length >= 2)
        .map((p) => ({ from: String(p.from), to: String(p.to), points: p.points.map((q) => clampPt(q, dims.cols, dims.rows)), width: Math.max(1, Math.min(4, Number(p.width) || 2)) }))
      dungeon = await updateEntity(dungeon.id, { dungeon: { ...(dungeon.dungeon ?? {}), cols: dims.cols, rows: dims.rows, rooms, passages } }, ctx)
      return dungeon
    },
    true,
  ))!

  const fresh = async () => (await db.entities.get(saved.id))!
  const rooms = (await fresh()).dungeon?.rooms ?? []
  const roomPrompts = new Map<string, { image?: string; map?: string }>()

  // 3a) write every room in parallel (the request limiter caps concurrency)
  const roomWritten = new Map<string, Promise<void>>()
  if (wantRooms) {
    report('rooms', { status: 'running' })
    const dg = await fresh()
    const all = await db.entities.where('campaignId').equals(campaign.id).toArray()
    const byId = new Map(all.map((e) => [e.id, e]))
    const outline = rooms.map((r) => `${r.key}. ${byId.get(r.locationId)?.name}: ${byId.get(r.locationId)?.summary}`).join('\n')
    let n = 0
    const errors: string[] = []
    for (const r of rooms) {
      roomWritten.set(
        r.locationId,
        (async () => {
          const room = byId.get(r.locationId)
          if (!room) return
          const enc = r.encounterId ? byId.get(r.encounterId) : undefined
          try {
            const t = await writeRoom(campaign, dg, outline, room, r.key, enc, level, opts.signal)
            roomPrompts.set(r.locationId, { image: t.imagePrompt, map: t.mapPrompt })
            await updateEntity(room.id, { body: t.body ?? room.body, secrets: t.secrets }, ctx)
            if (enc && t.encounter) {
              const e = (await db.entities.get(enc.id))!
              await updateEntity(enc.id, { summary: t.encounter.summary || e.summary, body: t.encounter.body ?? '', encounter: { ...(e.encounter ?? { creatures: [] }), tactics: t.encounter.tactics } }, ctx)
            }
          } catch (e: any) {
            if (e?.name === 'AbortError') throw e
            errors.push(`${room.name}: ${e?.message ?? e}`)
          }
          report('rooms', { detail: `${++n}/${rooms.length} areas written${errors.length ? ` · ${errors.length} failed` : ''}` })
        })(),
      )
    }
    Promise.all(roomWritten.values()).then(
      () => report('rooms', { status: errors.length ? 'error' : 'done', detail: errors.length ? errors.join('; ') : `${rooms.length} areas written` }),
      () => report('rooms', { status: 'error', detail: 'stopped' }),
    )
  }
  const roomsWrittenAll = Promise.all(roomWritten.values()).catch(() => undefined)

  // 3b) creatures for all room encounters, in parallel (homebrew deduplicated across rooms)
  const creaturesDone: Promise<unknown> = parts.has('creatures')
    ? step('creatures', async (detail) => {
        const shared = new Map<string, Promise<Entity>>()
        let n = 0
        await Promise.all(
          rooms
            .filter((r) => r.encounterId)
            .map(async (r) => {
              const enc = await db.entities.get(r.encounterId!)
              if (!enc?.encounter?.creatures.length) return
              const creatures = await resolveEncounterCreatures(campaign, enc, hints, ctx, detail, shared, level)
              const difficulty = await computeDifficultyLabel(campaign, creatures, level)
              const e = (await db.entities.get(enc.id))!
              await updateEntity(enc.id, { encounter: { ...(e.encounter ?? { creatures: [] }), creatures, difficulty } }, ctx)
              detail(`${++n} encounters ready`)
            }),
        )
      })
    : Promise.resolve()

  // 3c) overview map painted over the floor plan (starts right away)
  let overview: BattleMap | undefined = (await fresh()).dungeon?.mapId ? await db.maps.get((await fresh()).dungeon!.mapId!) : undefined
  const overviewDone: Promise<unknown> = parts.has('map')
    ? step('map', async (detail) => {
        const dg = await fresh()
        const data = dg.dungeon ?? {}
        const cols = data.cols ?? dims.cols
        const rows = data.rows ?? dims.rows
        if (!overview) {
          overview = await createMap(campaign.id, { name: dg.name, description: d.overview || dg.summary || dg.name, locationId: dg.id, width: cols * 70, height: rows * 70, seeded: true }, ctx)
          await updateEntity(dg.id, { dungeon: { ...((await fresh()).dungeon ?? data), mapId: overview.id } }, ctx)
        }
        if (!overview.image) {
          detail('painting over the floor plan…')
          const sketch = rooms.length ? renderSketch(cols, rows, rooms, data.passages ?? []) : undefined
          const description = `${dg.name}: ${d.overview || dg.summary}\n${dg.body.slice(0, 1500)}`
          const r = await generateBattlemapImage(campaign, description, { cols, rows, reference: sketch, referenceKind: 'layout', promptOverride: d.overview })
          const sx = r.asset.width! / cols
          const sy = r.asset.height! / rows
          const all = await db.entities.where('campaignId').equals(campaign.id).toArray()
          const links: MapLink[] = rooms.map((room) => {
            const b = bbox(room.shape)
            const loc = all.find((e) => e.id === room.locationId)
            return { id: newId('lnk'), x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy, label: `${room.key} ${loc?.name ?? ''}`.trim(), locationId: room.locationId }
          })
          overview = await updateMap(
            overview.id,
            {
              image: r.asset.id,
              width: r.asset.width,
              height: r.asset.height,
              prompt: r.prompt,
              grid: { ...overview.grid, size: sx, offsetX: 0, offsetY: 0 },
              links,
              state: { ...overview.state, fogEnabled: true },
              initialState: { ...overview.initialState, fogEnabled: true },
            },
            ctx,
          )
        }
      })
    : Promise.resolve()

  // 3d) dungeon illustration (prompt came with the design)
  const imageDone: Promise<unknown> = parts.has('image')
    ? step('image', async () => {
        await illustrateEntity(campaign, await fresh(), opts.instructions, ctx, d.imagePrompt)
      })
    : Promise.resolve()

  // 4a) portraits once the creatures exist
  const artDone: Promise<unknown> = parts.has('creatureArt')
    ? (async () => {
        await creaturesDone
        return step('creatureArt', async (detail) => {
          const encIds = rooms.flatMap((r) => (r.encounterId ? [r.encounterId] : []))
          const targets = await creatureTargetsForEncounters(campaign.id, encIds)
          if (!targets.length) return detail('all creatures already have art')
          await paintAll(campaign.id, targets, ctx, detail, opts.signal)
        })
      })()
    : Promise.resolve()

  // 4b) room maps: each starts when the overview (crop reference) and that room's text are ready
  const roomMap = new Map<string, string>()
  const roomMapsDone: Promise<unknown> = parts.has('roomMaps')
    ? (async () => {
        await overviewDone
        return step('roomMaps', async (detail) => {
          const todo = rooms.filter((r) => r.encounterId && !r.mapId)
          let n = 0
          const errors: string[] = []
          await Promise.all(
            todo.map(async (room) => {
              await roomWritten.get(room.locationId)
              if (opts.signal?.aborted) return
              const loc = await db.entities.get(room.locationId)
              const enc = room.encounterId ? await db.entities.get(room.encounterId) : undefined
              if (!loc) return
              const b = bbox(room.shape)
              const cols = Math.max(12, Math.min(36, Math.round(b.w) + 4))
              const rows = Math.max(10, Math.min(30, Math.round(b.h) + 4))
              let reference: string | undefined
              if (overview?.image) {
                const px = overview.grid.size // image pixels per square
                reference = await cropToDataUrl(overview.image, { x: (b.x - 2) * px, y: (b.y - 2) * px, w: (b.w + 4) * px, h: (b.h + 4) * px })
              }
              const description = `${loc.name}: ${loc.summary}\n${loc.body.slice(0, 2000)}\n${enc ? `Encounter: ${enc.encounter?.tactics ?? ''}` : ''}`
              try {
                const map = await createMap(
                  campaign.id,
                  { name: loc.name, description, parentId: overview?.id, encounterId: enc?.id, locationId: loc.id, width: cols * 70, height: rows * 70, seeded: true },
                  ctx,
                )
                const r = await generateBattlemapImage(campaign, description, { cols, rows, reference, referenceKind: 'parent', promptOverride: roomPrompts.get(loc.id)?.map })
                await updateMap(map.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } }, ctx)
                if (enc) {
                  const e = (await db.entities.get(enc.id))!
                  await updateEntity(enc.id, { encounter: { ...(e.encounter ?? { creatures: [] }), mapId: map.id } }, ctx)
                }
                roomMap.set(room.locationId, map.id)
              } catch (e: any) {
                errors.push(`${loc.name}: ${e.message}`)
              }
              detail(`${++n}/${todo.length} room maps${errors.length ? ` · ${errors.join('; ')}` : ''}`)
            }),
          )
          // store sub-maps on the dungeon and point the overview's area links at them
          const dg = await fresh()
          await updateEntity(dg.id, { dungeon: { ...dg.dungeon, rooms: (dg.dungeon?.rooms ?? []).map((r) => (roomMap.has(r.locationId) ? { ...r, mapId: roomMap.get(r.locationId) } : r)) } }, ctx)
          if (overview) {
            const ov = (await db.maps.get(overview.id))!
            await updateMap(ov.id, { links: ov.links.map((l) => (l.locationId && roomMap.has(l.locationId) ? { ...l, targetMapId: roomMap.get(l.locationId) } : l)) }, ctx)
          }
        })
      })()
    : Promise.resolve()

  // 4c) room illustrations, each as soon as its room text (and prompt) exists
  const roomImagesDone: Promise<unknown> = parts.has('roomImages')
    ? step('roomImages', async (detail) => {
        let n = 0
        const errors: string[] = []
        await Promise.all(
          rooms.map(async (r) => {
            await roomWritten.get(r.locationId)
            if (opts.signal?.aborted) return
            const e = await db.entities.get(r.locationId)
            if (!e || e.images.length) return
            try {
              await illustrateEntity(campaign, e, undefined, ctx, roomPrompts.get(r.locationId)?.image)
            } catch (err: any) {
              errors.push(`${e.name}: ${err.message}`)
            }
            detail(`${++n}/${rooms.length}${errors.length ? ` · ${errors.join('; ')}` : ''}`)
          }),
        )
      })
    : Promise.resolve()

  // 5) creatures go on their room map; rooms without one get them on the overview (hidden, in place)
  const placementDone = (async () => {
    await Promise.all([creaturesDone, overviewDone, roomMapsDone])
    const dg = await fresh()
    for (const r of dg.dungeon?.rooms ?? []) {
      if (!r.encounterId) continue
      const enc = await db.entities.get(r.encounterId)
      if (!enc) continue
      if (r.mapId) await placeEncounter(r.mapId, enc.id, { asStart: true }, ctx)
      else if (overview && !enc.encounter?.mapId) {
        await placeEncounter(overview.id, enc.id, { at: centroid(r.shape), hidden: true, asStart: true }, ctx)
        await updateEntity(enc.id, { encounter: { ...(enc.encounter ?? { creatures: [] }), mapId: overview.id } }, ctx)
      }
    }
  })()

  // 6) links once all texts exist (rooms, encounters, homebrew creatures)
  const linksDone: Promise<unknown> = parts.has('links')
    ? (async () => {
        await Promise.all([roomsWrittenAll, creaturesDone])
        return step('links', async (detail) => {
          const ids = [saved.id, ...rooms.map((r) => r.locationId), ...rooms.flatMap((r) => (r.encounterId ? [r.encounterId] : []))]
          const extra = (await db.changes.where('batchId').equals(ctx.batchId).toArray()).filter((c) => c.table === 'entities').map((c) => c.recordId)
          const n = await createMissingLinks(campaign, [...new Set([...ids, ...extra])], ctx, detail)
          detail(n ? `${n} entries created` : 'all links resolve')
        })
      })()
    : Promise.resolve()

  await Promise.all([roomsWrittenAll, creaturesDone, overviewDone, imageDone, artDone, roomMapsDone, roomImagesDone, placementDone, linksDone])
  return saved.id
}
