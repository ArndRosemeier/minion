import { db } from '@/db/db'
import { createEntity, createMap, updateEntity, updateMap, type ChangeCtx } from '@/db/repo'
import { newId } from '@/lib/id'
import { placeEncounter } from '@/lib/encounterSetup'
import { cropToDataUrl } from '@/lib/mapImage'
import { getSettings } from '@/state/settings'
import { chatJson } from './openrouter'
import { generateBattlemapImage, illustrateEntity, sanitizeEntityData } from './generate'
import { campaignHeader, entityIndexLine, LINK_RULES, languageRule } from './prompts'
import {
  computeDifficultyLabel,
  createMissingLinks,
  creatureCandidates,
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
  summary?: string
  body?: string
  secrets?: string
  shape: Pt[]
  encounter?: {
    name?: string
    summary?: string
    body?: string
    creatures?: { name: string; count?: number; homebrew?: boolean; concept?: string; level?: number }[]
    tactics?: string
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
  rooms?: DesignRoom[]
  passages?: { from: string; to: string; points: Pt[]; width?: number }[]
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
// design
// ---------------------------------------------------------------------------

async function design(campaign: Campaign, base: Partial<Entity>, size: keyof typeof SIZES, instructions: string | undefined, signal?: AbortSignal): Promise<Design> {
  const s = getSettings()
  const dims = SIZES[size]
  const entities = await db.entities.where('campaignId').equals(campaign.id).toArray()
  const sys = [
    `You are a master dungeon designer for ${SYSTEM_LABEL[campaign.system]}. Return ONLY a JSON object.`,
    campaignHeader(campaign),
    languageRule(campaign),
    LINK_RULES,
    `FLOOR PLAN: The site is drawn on a grid of ${dims.cols} × ${dims.rows} squares (5 ft each). Coordinates are [x, y] in squares, x right (0–${dims.cols}), y down (0–${dims.rows}).
- Each room/area has an outline polygon "shape" (6–14 points). Make shapes ORGANIC and fitting the place — natural caves are irregular blobs, a crypt may be cross-shaped, a tower round, a ruin broken; never default to plain rectangles unless the place is built that way.
- Areas must not overlap; leave rock between them. Typical areas are 4–16 squares across; a grand cavern may be larger.
- "passages" connect areas as polylines (points in squares) with a "width" in squares (1–3). Every area must be reachable. At least one passage starts at a map edge (the entrance; use "from": "entrance").
- Use most of the grid; spread the areas out naturally.`,
    `CONTENT:
- ${dims.rooms} areas, keyed "1", "2", … in a sensible exploration order.
- Each area: "name", "summary" (one line), "body" (markdown: read-aloud "> " box, notable features with mechanics/DCs, treasure (official items as [[links]]), hazards/traps, clues, exits), "secrets".
- About half of the areas have an "encounter" (others: traps, puzzles, treasure, roleplay, empty atmosphere). Encounter: {"name","summary","body" (how it plays out),"creatures":[{"name","count","homebrew"?,"concept"?,"level"?}],"tactics","difficulty"}. Use EXACT names from AVAILABLE CREATURES; invent homebrew creatures only when nothing fits (set "homebrew": true with "concept" and "level"). Balance for ${campaign.partySize} characters of level ${campaign.partyLevel}, mixing difficulties, with a climax near the end.
- Dungeon "body": history, purpose, current inhabitants and factions, how to enter, dungeon-wide features (light, sounds, wandering monsters), how areas connect. "secrets": the big twist/GM info.
- "overview": a concrete visual description for painting the whole site top-down (materials, light, vegetation/water/debris, atmosphere).`,
    `AVAILABLE CREATURES (exact names):\n${await creatureCandidates(campaign, entities)}`,
    `Existing campaign entries (link to them where relevant):\n${entities.slice(0, 200).map(entityIndexLine).join('\n')}`,
  ].join('\n\n')
  const user = [
    `Design this dungeon completely. Concept so far: ${JSON.stringify({ name: base.name, summary: base.summary, body: base.body, secrets: base.secrets })}`,
    instructions && `GM instructions: ${instructions}`,
    'Return JSON: {"name","aliases","summary","body","secrets","tags","overview","rooms":[{"key","name","summary","body","secrets","shape":[[x,y],…],"encounter":{…}|null}],"passages":[{"from","to","points":[[x,y],…],"width"}]}',
  ]
    .filter(Boolean)
    .join('\n')
  const { data } = await chatJson<Design>({
    model: s.chatModel,
    temperature: 0.85,
    signal,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  })
  return data
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
  const step = async <T,>(id: string, fn: (detail: (d: string) => void) => Promise<T>, fatal = false): Promise<T | undefined> => {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
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

  const existing = input.id ? await db.entities.get(input.id) : undefined
  const base: Partial<Entity> = { ...existing, ...input.draft }
  const size = opts.size ?? 'medium'
  const hasRooms = !!existing?.dungeon?.rooms?.length
  const wantRooms = parts.has('rooms') && !hasRooms

  // 1) design
  let d: Design = {}
  const dims = existing?.dungeon?.cols ? { cols: existing.dungeon.cols, rows: existing.dungeon.rows ?? SIZES[size].rows } : SIZES[size]
  if (parts.has('text') || wantRooms) {
    await step(
      'design',
      async (detail) => {
        if (hasRooms && parts.has('rooms')) detail('rooms already exist — keeping them')
        d = await design(campaign, base, size, opts.instructions, opts.signal)
        const rooms = (d.rooms ?? []).filter((r) => r && r.name)
        detail(`${rooms.length} areas, ${rooms.filter((r) => r.encounter?.creatures?.length).length} encounters`)
      },
      true,
    )
  } else report('design', { status: 'skipped' })

  // 2) save dungeon, rooms, encounters
  const hints: Record<string, { concept?: string; level?: number }> = {}
  const saved = (await step(
    'save',
    async (detail) => {
      const text = parts.has('text') ? sanitizeEntityData(d) : {}
      const dungeonData: Partial<Entity> = { ...input.draft, ...text, name: text.name || base.name || 'Unnamed dungeon' }
      let dungeon = existing ? await updateEntity(existing.id, dungeonData, ctx) : await createEntity(campaign.id, 'dungeon', dungeonData, ctx)
      if (!wantRooms) return dungeon
      const rooms: DungeonRoom[] = []
      const keyToId = new Map<string, string>()
      let order = 0
      for (const r of d.rooms ?? []) {
        const shape = validShape(r.shape, dims.cols, dims.rows)
        if (!r?.name || !shape) continue
        const key = String(r.key ?? ++order)
        const room = await createEntity(
          campaign.id,
          'location',
          { name: r.name, summary: r.summary ?? '', body: r.body ?? '', secrets: r.secrets, parentId: dungeon.id, tags: ['room', `room ${key}`] },
          ctx,
        )
        keyToId.set(key, room.id)
        let encounterId: string | undefined
        if (r.encounter?.creatures?.length) {
          for (const c of r.encounter.creatures) hints[String(c.name).toLowerCase()] = { concept: c.concept, level: c.level }
          const enc = await createEntity(
            campaign.id,
            'encounter',
            {
              name: r.encounter.name || `${r.name}: encounter`,
              summary: r.encounter.summary ?? '',
              body: r.encounter.body ?? '',
              parentId: room.id,
              encounter: {
                creatures: r.encounter.creatures.filter((c) => c?.name).map((c) => ({ refId: '', name: String(c.name), count: Math.max(1, Number(c.count) || 1) })),
                tactics: r.encounter.tactics,
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

  // 3) creatures for every room encounter
  if (parts.has('creatures')) {
    await step('creatures', async (detail) => {
      let n = 0
      for (const r of rooms) {
        if (!r.encounterId) continue
        const enc = await db.entities.get(r.encounterId)
        if (!enc?.encounter?.creatures.length) continue
        const creatures = await resolveEncounterCreatures(campaign, enc, hints, ctx, detail)
        await updateEntity(enc.id, { encounter: { ...enc.encounter, creatures, difficulty: await computeDifficultyLabel(campaign, creatures) } }, ctx)
        n++
        detail(`${n} encounters ready`)
      }
    })
  }

  // 4) overview map painted over the floor plan, with area links per room
  let overview: BattleMap | undefined = (await fresh()).dungeon?.mapId ? await db.maps.get((await fresh()).dungeon!.mapId!) : undefined
  if (parts.has('map')) {
    await step('map', async (detail) => {
      const dg = await fresh()
      const data = dg.dungeon ?? {}
      const cols = data.cols ?? dims.cols
      const rows = data.rows ?? dims.rows
      if (!overview) {
        overview = await createMap(
          campaign.id,
          { name: dg.name, description: d.overview || dg.summary || dg.name, locationId: dg.id, width: cols * 70, height: rows * 70, seeded: true },
          ctx,
        )
        await updateEntity(dg.id, { dungeon: { ...data, mapId: overview.id } }, ctx)
      }
      if (!overview.image) {
        detail('painting over the floor plan…')
        const sketch = rooms.length ? renderSketch(cols, rows, rooms, data.passages ?? []) : undefined
        const description = `${dg.name}: ${d.overview || dg.summary}\n${dg.body.slice(0, 1500)}`
        const r = await generateBattlemapImage(campaign, description, { cols, rows, reference: sketch, referenceKind: 'layout' })
        const sx = r.asset.width! / cols
        const sy = r.asset.height! / rows
        const all = await db.entities.where('campaignId').equals(campaign.id).toArray()
        const links: MapLink[] = rooms.map((room) => {
          const b = bbox(room.shape)
          const loc = all.find((e) => e.id === room.locationId)
          return { id: newId('lnk'), x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy, label: `${room.key} ${loc?.name ?? ''}`.trim(), locationId: room.locationId }
        })
        const fog = { ...overview.state, fogEnabled: true }
        overview = await updateMap(
          overview.id,
          {
            image: r.asset.id,
            width: r.asset.width,
            height: r.asset.height,
            prompt: r.prompt,
            grid: { ...overview.grid, size: sx, offsetX: 0, offsetY: 0 },
            links,
            state: fog,
            initialState: { ...overview.initialState, fogEnabled: true },
          },
          ctx,
        )
      }
    })
  }

  // 5) detailed maps for rooms with encounters
  const roomMap = new Map<string, string>()
  if (parts.has('roomMaps')) {
    await step('roomMaps', async (detail) => {
      const todo = rooms.filter((r) => r.encounterId && !r.mapId)
      let n = 0
      const work = [...todo]
      const worker = async () => {
        for (let room = work.shift(); room; room = work.shift()) {
          if (opts.signal?.aborted) return
          const loc = await db.entities.get(room.locationId)
          const enc = room.encounterId ? await db.entities.get(room.encounterId) : undefined
          if (!loc) continue
          detail(`painting ${++n}/${todo.length}: ${loc.name}`)
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
            const r = await generateBattlemapImage(campaign, description, { cols, rows, reference, referenceKind: 'parent' })
            await updateMap(map.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } }, ctx)
            if (enc) {
              await updateEntity(enc.id, { encounter: { ...(enc.encounter ?? { creatures: [] }), mapId: map.id } }, ctx)
              await placeEncounter(map.id, enc.id, { asStart: true }, ctx)
            }
            roomMap.set(room.locationId, map.id)
          } catch (e: any) {
            report('roomMaps', { detail: `${loc.name}: ${e.message}` })
          }
        }
      }
      await Promise.all([worker(), worker()])
      // store sub-maps on the dungeon and point the overview's area links at them
      const dg = await fresh()
      const updatedRooms = (dg.dungeon?.rooms ?? []).map((r) => (roomMap.has(r.locationId) ? { ...r, mapId: roomMap.get(r.locationId) } : r))
      await updateEntity(dg.id, { dungeon: { ...dg.dungeon, rooms: updatedRooms } }, ctx)
      if (overview) {
        const ov = (await db.maps.get(overview.id))!
        await updateMap(ov.id, { links: ov.links.map((l) => (l.locationId && roomMap.has(l.locationId) ? { ...l, targetMapId: roomMap.get(l.locationId) } : l)) }, ctx)
      }
      detail(`${roomMap.size} room maps`)
    })
  }

  // encounters without their own room map live on the overview, at their room, hidden until discovered
  if (overview) {
    const ov = overview
    for (const r of (await fresh()).dungeon?.rooms ?? []) {
      if (!r.encounterId || r.mapId || roomMap.has(r.locationId)) continue
      const enc = await db.entities.get(r.encounterId)
      if (!enc || enc.encounter?.mapId) continue
      await placeEncounter(ov.id, enc.id, { at: centroid(r.shape), hidden: true, asStart: true }, ctx)
      await updateEntity(enc.id, { encounter: { ...(enc.encounter ?? { creatures: [] }), mapId: ov.id } }, ctx)
    }
  }

  if (parts.has('image')) {
    await step('image', async () => {
      await illustrateEntity(campaign, await fresh(), opts.instructions, ctx)
    })
  }

  if (parts.has('roomImages')) {
    await step('roomImages', async (detail) => {
      const locs = (await Promise.all(rooms.map((r) => db.entities.get(r.locationId)))).filter((e): e is Entity => !!e && !e.images.length)
      let n = 0
      const work = [...locs]
      const worker = async () => {
        for (let e = work.shift(); e; e = work.shift()) {
          if (opts.signal?.aborted) return
          detail(`${++n}/${locs.length}: ${e.name}`)
          try {
            await illustrateEntity(campaign, e, undefined, ctx)
          } catch (err: any) {
            report('roomImages', { detail: `${e.name}: ${err.message}` })
          }
        }
      }
      await Promise.all([worker(), worker(), worker()])
    })
  }

  if (parts.has('links')) {
    await step('links', async (detail) => {
      const ids = [saved.id, ...rooms.map((r) => r.locationId), ...rooms.flatMap((r) => (r.encounterId ? [r.encounterId] : []))]
      const n = await createMissingLinks(campaign, ids, ctx, detail)
      detail(n ? `${n} entries created` : 'all links resolve')
    })
  }
  return saved.id
}
