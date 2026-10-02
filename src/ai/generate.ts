import { chat, chatJson, generateImage } from './openrouter'
import { campaignHeader, ENTITY_FIELDS_DOC, LINK_RULES, languageRule, STATBLOCK_SCHEMA, entityIndexLine } from './prompts'
import { getSettings } from '@/state/settings'
import { dataUrlToBlob, saveAsset, updateEntity, type ChangeCtx } from '@/db/repo'
import { db } from '@/db/db'
import type { Asset, Campaign, Entity, EntityType } from '@/types'
import { SYSTEM_LABEL } from '@/types'

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)

/** Generate fields for a single entity (used for homebrew-on-demand and quick NPCs). */
export async function generateEntityData(
  campaign: Campaign,
  entities: Entity[],
  req: { type: EntityType; name?: string; instructions?: string; withStats?: boolean; fast?: boolean },
): Promise<Partial<Entity>> {
  const s = getSettings()
  const sys = [
    `You are an expert ${SYSTEM_LABEL[campaign.system]} game designer helping a GM. Return ONLY a JSON object.`,
    campaignHeader(campaign),
    languageRule(campaign),
    LINK_RULES,
    ENTITY_FIELDS_DOC,
    STATBLOCK_SCHEMA,
    `Existing campaign entities (for consistency, link to them where relevant):\n${entities.slice(0, 300).map(entityIndexLine).join('\n')}`,
  ].join('\n\n')
  const user = [
    `Create a ${req.type}${req.name ? ` named "${req.name}"` : ''}.`,
    req.instructions && `Instructions: ${req.instructions}`,
    req.withStats
      ? `Include a complete, rules-accurate "stats" StatBlock appropriate for the party level (${campaign.partyLevel}) unless instructed otherwise.`
      : req.type === 'creature' || req.type === 'spell' || req.type === 'item' || req.type === 'rule'
        ? 'This is homebrew: include complete, rules-accurate mechanics (stats for creatures; full rules text with numbers for spells/items/rules).'
        : '',
    `Return JSON: { "name", "aliases", "summary", "body", "secrets", "tags", "stats"? }`,
  ]
    .filter(Boolean)
    .join('\n')
  const { data } = await chatJson<Partial<Entity>>({
    label: `Writing ${req.type}${req.name ? `: ${req.name}` : ''}`,
    model: req.fast ? s.fastModel : s.chatModel,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
    temperature: 0.9,
  })
  return sanitizeEntityData(data)
}

export function sanitizeEntityData(d: any): Partial<Entity> {
  const out: Partial<Entity> = {}
  if (typeof d.name === 'string') out.name = d.name
  if (Array.isArray(d.aliases)) out.aliases = d.aliases.filter((x: unknown) => typeof x === 'string')
  if (typeof d.summary === 'string') out.summary = d.summary
  if (typeof d.body === 'string') out.body = d.body
  if (typeof d.secrets === 'string') out.secrets = d.secrets
  if (Array.isArray(d.tags)) out.tags = d.tags.filter((x: unknown) => typeof x === 'string')
  if (d.stats && typeof d.stats === 'object') {
    const st = d.stats
    out.stats = {
      ...st,
      ac: Number(st.ac) || 10,
      hp: Number(st.hp) || 1,
      initiative: Number(st.initiative ?? st.perception ?? 0) || 0,
      actions: Array.isArray(st.actions) ? st.actions : [],
    }
  }
  if (typeof d.parentId === 'string') out.parentId = d.parentId
  if (typeof d.order === 'number') out.order = d.order
  if (typeof d.level === 'number') out.level = d.level
  if (d.encounter && typeof d.encounter === 'object') {
    out.encounter = {
      creatures: Array.isArray(d.encounter.creatures) ? d.encounter.creatures : [],
      difficulty: d.encounter.difficulty,
      tactics: d.encounter.tactics,
      mapId: d.encounter.mapId,
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

async function writeImagePrompt(campaign: Campaign, subject: string, kind: 'illustration' | 'battlemap', extra?: string) {
  const s = getSettings()
  const rules =
    kind === 'battlemap'
      ? `Write a prompt for an image model to paint a TABLETOP RPG BATTLE MAP.
Hard requirements to include in the prompt: strict top-down orthographic view (straight from above, no perspective, no horizon), no grid lines, no text, no labels, no letters, no UI, no frame or border, no characters or creatures (tokens are placed separately), consistent scale.
Be organic and specific: describe terrain, materials, light, clutter, paths, cover, elevation cues, water, vegetation, furniture, debris — whatever fits. Do NOT default to rectangular rooms; follow the description. If it is a dungeon/complex, describe its layout concretely (chambers, passages, natural caves, ruins...) as it fits the place.`
      : `Write a prompt for an image model to create an evocative illustration for a tabletop RPG (character portrait, place, scene or item as fits). No text or letters in the image.`
  const r = await chat({
    label: kind === 'battlemap' ? 'Writing map prompt' : 'Writing image prompt',
    model: s.fastModel,
    messages: [
      {
        role: 'system',
        content: `${rules}\nArt style: ${campaign.artStyle || 'painterly fantasy'}.\nAnswer with the prompt only, in English, max 120 words.`,
      },
      { role: 'user', content: `Subject:\n${clip(subject, 4000)}${extra ? `\n\nAdditional direction: ${extra}` : ''}` },
    ],
    temperature: 0.8,
  })
  return r.content.trim()
}

export function entitySubject(e: Entity) {
  return `${e.type.toUpperCase()}: ${e.name}\n${e.summary}\n${clip(e.body, 2500)}${e.stats ? `\nCreature: ${e.stats.size ?? ''} ${(e.stats.traits || []).join(' ')}` : ''}`
}

export async function generateIllustration(
  campaign: Campaign,
  subject: string,
  opts: { aspectRatio?: string; direction?: string; promptOverride?: string; reference?: string[] } = {},
): Promise<Asset> {
  const prompt = opts.promptOverride || (await writeImagePrompt(campaign, subject, 'illustration', opts.direction))
  const { images } = await generateImage({
    label: `Painting: ${subject.split('\n')[0].replace(/^[A-Z]+: /, '').slice(0, 60)}`,
    prompt: `${prompt}\nStyle: ${campaign.artStyle}`,
    aspectRatio: opts.aspectRatio ?? '4:3',
    inputImages: opts.reference,
  })
  const blob = await dataUrlToBlob(images[0])
  return saveAsset(blob, campaign.id, prompt)
}

/** Illustrate an entity and prepend the image to its gallery. */
export const entityAspect = (e: Pick<Entity, 'type'>) => (e.type === 'npc' || e.type === 'creature' ? '3:4' : e.type === 'item' ? '1:1' : '16:9')

/** Illustrate an entry; pass a ready image prompt to skip the prompt-writing call. */
export async function illustrateEntity(campaign: Campaign, e: Entity, direction?: string, ctx?: ChangeCtx, promptOverride?: string) {
  const asset = await generateIllustration(campaign, entitySubject(e), { aspectRatio: entityAspect(e), direction, promptOverride })
  // re-read: other steps may have changed the entry meanwhile
  const fresh = (await db.entities.get(e.id)) ?? e
  await updateEntity(e.id, { images: [asset.id, ...fresh.images] }, ctx)
  return asset
}

/** Write image prompts for many subjects with a few batched calls instead of one call per image. */
export async function writeImagePrompts(campaign: Campaign, items: { id: string; subject: string }[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const chunks: { id: string; subject: string }[][] = []
  for (let i = 0; i < items.length; i += 8) chunks.push(items.slice(i, i + 8))
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { data } = await chatJson<Record<string, string>>({
          label: `Writing ${chunk.length} image prompts`,
          model: getSettings().fastModel,
          temperature: 0.8,
          messages: [
            {
              role: 'system',
              content: `For each tabletop RPG subject write a prompt for an image model: an evocative illustration (character portrait, place, scene, creature or item as fits), no text or letters in the image. Art style: ${campaign.artStyle || 'painterly fantasy'}. English, max 100 words each. Return ONLY JSON mapping each id to its prompt.`,
            },
            { role: 'user', content: JSON.stringify(chunk.map((c) => ({ id: c.id, subject: clip(c.subject, 1500) }))) },
          ],
        })
        for (const c of chunk) if (typeof data?.[c.id] === 'string') out[c.id] = data[c.id]
      } catch {
        /* entries without a prompt fall back to their own prompt call */
      }
    }),
  )
  return out
}

/** Illustrate many entries: batched prompts, then all images at once (the request limiter caps concurrency). */
export async function illustrateEntities(
  campaign: Campaign,
  entities: Entity[],
  ctx?: ChangeCtx,
  onProgress?: (done: number, total: number, name: string) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const prompts = await writeImagePrompts(
    campaign,
    entities.map((e) => ({ id: e.id, subject: entitySubject(e) })),
  )
  let done = 0
  const errors: string[] = []
  await Promise.all(
    entities.map(async (e) => {
      if (signal?.aborted) return
      try {
        await illustrateEntity(campaign, e, undefined, ctx, prompts[e.id])
      } catch (err: any) {
        errors.push(`${e.name}: ${err?.message ?? err}`)
      }
      onProgress?.(++done, entities.length, e.name)
    }),
  )
  return errors
}

const ASPECTS: [string, number][] = [
  ['1:1', 1],
  ['5:4', 1.25],
  ['4:3', 4 / 3],
  ['3:2', 1.5],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
  ['4:5', 0.8],
  ['3:4', 0.75],
  ['2:3', 2 / 3],
  ['9:16', 9 / 16],
]

export function nearestAspect(cols: number, rows: number) {
  const r = cols / rows
  return ASPECTS.reduce((best, a) => (Math.abs(Math.log(a[1] / r)) < Math.abs(Math.log(best[1] / r)) ? a : best))
}

export interface BattlemapResult {
  asset: Asset
  prompt: string
  cols: number
  rows: number
  gridSize: number
}

/** Generate a battle map image; grid size is derived from the requested width in squares. */
export async function generateBattlemapImage(
  campaign: Campaign,
  description: string,
  opts: { cols?: number; rows?: number; direction?: string; reference?: string; referenceKind?: 'parent' | 'layout'; promptOverride?: string } = {},
): Promise<BattlemapResult> {
  const cols = opts.cols ?? 30
  const rows = opts.rows ?? 20
  const [aspect, ratio] = nearestAspect(cols, rows)
  const rowsAdj = Math.round(cols / ratio)
  const scale = `The map shows an area of about ${cols * 5} by ${rowsAdj * 5} feet; a 5-foot square is about 1/${cols} of the image width (a human-sized figure fits one square).`
  const base = opts.promptOverride || (await writeImagePrompt(campaign, description, 'battlemap', opts.direction))
  const prompt = [
    base,
    scale,
    opts.reference
      ? opts.referenceKind === 'layout'
        ? 'The attached image is the exact FLOOR PLAN of this map: light-gray shapes are walkable floor (chambers, caves, halls, passages) and black is solid rock, earth or wall. Keep every chamber and passage exactly where and how it is drawn — same positions, shapes and proportions, nothing added or removed — but render it as a richly detailed, natural, painted battle map with real materials. Never reproduce the flat gray/black sketch look.'
        : 'The attached image is the parent map; this is a detailed, zoomed-in view of the marked area. Keep materials, colors and style consistent with it.'
      : '',
    'Top-down orthographic battle map, no grid, no text, no creatures.',
  ]
    .filter(Boolean)
    .join('\n')
  const { images } = await generateImage({
    label: `Painting map: ${description.split('\n')[0].slice(0, 60)}`,
    prompt: `${prompt}\nStyle: ${campaign.artStyle}`,
    aspectRatio: aspect,
    inputImages: opts.reference ? [opts.reference] : undefined,
  })
  const blob = await dataUrlToBlob(images[0])
  const asset = await saveAsset(blob, campaign.id, prompt)
  const width = asset.width || 1024
  return { asset, prompt: base, cols, rows: rowsAdj, gridSize: width / cols }
}

// ---------------------------------------------------------------------------
// Bulk helpers
// ---------------------------------------------------------------------------

/** Write a rules-accurate stat block for an existing NPC/creature from its description. */
export async function generateStatBlock(campaign: Campaign, e: Entity): Promise<NonNullable<Entity['stats']>> {
  const s = getSettings()
  const { data } = await chatJson<{ stats: unknown }>({
    label: `Stat block: ${e.name}`,
    model: s.chatModel,
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: [
          `You are an expert ${SYSTEM_LABEL[campaign.system]} game designer. Return ONLY a JSON object {"stats": StatBlock}.`,
          campaignHeader(campaign),
          languageRule(campaign),
          'Follow the official creature-building rules for the system (level/CR-appropriate AC, HP, attack bonus, damage, saves, DCs). Use official spells, conditions and actions by their exact English names; put rules text in the actions. Wrap rules references in action texts in [[ ]].',
          STATBLOCK_SCHEMA,
        ].join('\n\n'),
      },
      {
        role: 'user',
        content: `Create the stat block for this ${e.type}. Pick a level/CR that fits the description and its role in the campaign (party level ${campaign.partyLevel}).\n\n${entitySubject(e)}\n${e.secrets ? `GM notes: ${clip(e.secrets, 1000)}` : ''}`,
      },
    ],
  })
  const st = sanitizeEntityData({ stats: (data as any)?.stats ?? data }).stats
  if (!st) throw new Error(`No stat block returned for ${e.name}`)
  return st
}

/** Write one-line summaries for many entities in one call. Returns id -> summary. */
export async function generateSummaries(campaign: Campaign, entities: Entity[]): Promise<Record<string, string>> {
  const s = getSettings()
  const items = entities.map((e) => ({ id: e.id, type: e.type, name: e.name, text: clip(`${e.body}\n${e.secrets ?? ''}`, 1200) }))
  const { data } = await chatJson<Record<string, string>>({
    label: `Summaries (${entities.length})`,
    model: s.fastModel,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `Write a one-line summary (max ~15 words) for each tabletop RPG entry, useful as a quick reminder for the GM. ${languageRule(campaign)}\nReturn ONLY a JSON object mapping each id to its summary.`,
      },
      { role: 'user', content: JSON.stringify(items) },
    ],
  })
  const out: Record<string, string> = {}
  for (const e of entities) if (typeof data?.[e.id] === 'string') out[e.id] = data[e.id].trim()
  return out
}
