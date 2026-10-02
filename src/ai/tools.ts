import { db } from '@/db/db'
import {
  createEntity,
  createMap,
  deleteEntity,
  deleteMap,
  updateCampaign,
  updateEntity,
  updateMap,
  type ChangeCtx,
} from '@/db/repo'
import { loadCompendium, normalizeName, searchRefs, findRef } from '@/compendium/compendium'
import { newId } from '@/lib/id'
import { ENTITY_TYPES } from '@/lib/entityTypes'
import { generateBattlemapImage, illustrateEntity, sanitizeEntityData } from './generate'
import { seedEncounterMap } from '@/lib/encounterSetup'
import { entityFull, entityIndexLine } from './prompts'
import type { ORTool } from './openrouter'
import type { Campaign, Entity, EntityType, PartyMember, RefCategory } from '@/types'

const ENTITY_TYPE_LIST = Object.keys(ENTITY_TYPES)

const entitySchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ENTITY_TYPE_LIST },
    name: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    body: { type: 'string', description: 'Markdown with [[wikilinks]]; "> " for read-aloud text' },
    secrets: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    parent: { type: 'string', description: 'id or exact name of the parent entity (scene -> chapter, sub-location -> location)' },
    order: { type: 'number' },
    stats: { type: 'object', description: 'StatBlock (see schema in system prompt)' },
    encounter: {
      type: 'object',
      properties: {
        creatures: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, refId: { type: 'string' }, count: { type: 'number' } },
            required: ['name', 'count'],
          },
        },
        tactics: { type: 'string' },
        difficulty: { type: 'string' },
        map: { type: 'string', description: 'map id or name' },
      },
    },
  },
}

export const TOOLS: ORTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_entities',
      description: 'Read the full content of campaign entities by id or exact name.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_campaign',
      description: 'Full-text search over all campaign entities. Returns index lines.',
      parameters: { type: 'object', properties: { query: { type: 'string' }, type: { type: 'string', enum: ENTITY_TYPE_LIST } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_entities',
      description:
        'Create one or more campaign entities. Entities in the same call may reference each other by name (e.g. scenes with parent = chapter name). Returns the new ids.',
      parameters: { type: 'object', properties: { entities: { type: 'array', items: { ...entitySchema, required: ['type', 'name'] } } }, required: ['entities'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_entity',
      description: 'Replace fields of an entity. Only given fields change. To change a long text partially prefer edit_text.',
      parameters: { type: 'object', properties: { id: { type: 'string', description: 'id or exact name' }, fields: entitySchema }, required: ['id', 'fields'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_text',
      description: 'Surgical find & replace inside a text field of an entity (body, secrets or summary). "find" must match exactly once. Use an empty find to append.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          field: { type: 'string', enum: ['body', 'secrets', 'summary'] },
          find: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['id', 'field', 'find', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_entities',
      description: 'Delete entities by id or exact name.',
      parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_campaign',
      description: 'Change campaign settings.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          premise: { type: 'string' },
          tone: { type: 'string' },
          artStyle: { type: 'string' },
          partyLevel: { type: 'number' },
          partySize: { type: 'number' },
          language: { type: 'string' },
          aiInstructions: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_party',
      description: 'Replace the list of player characters (only what the GM needs: name, short description, initiative bonus, optional HP/AC).',
      parameters: {
        type: 'object',
        properties: {
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                player: { type: 'string' },
                description: { type: 'string' },
                initBonus: { type: 'number' },
                maxHp: { type: 'number' },
                ac: { type: 'number' },
              },
              required: ['name'],
            },
          },
        },
        required: ['members'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_rules',
      description: 'Search the official rules reference (spells, conditions, creatures, actions, items, traits). Use to find exact names and suitable official creatures by level.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'name or trait, may be empty to list by category' },
          category: { type: 'string', enum: ['spell', 'condition', 'creature', 'action', 'item', 'rule', 'trait'] },
          maxLevel: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_rule',
      description: 'Read the full text (and stat block) of an official rules entry by exact name.',
      parameters: { type: 'object', properties: { name: { type: 'string' }, category: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'illustrate',
      description: 'Generate an illustration for an entity with the image model (slow, costs money — only when asked or when the automation settings say so).',
      parameters: { type: 'object', properties: { id: { type: 'string' }, direction: { type: 'string' } }, required: ['id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_battlemap',
      description:
        'Create a battle map (optionally generating its image, slow). Describe the area organically and concretely — any shape, wilderness or complex dungeon. Size in 5-ft squares. Can be a sub-map of a parent map.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'Detailed visual description of the area for the image model' },
          cols: { type: 'number', description: 'width in squares (default 30)' },
          rows: { type: 'number', description: 'height in squares (default 20)' },
          encounter: { type: 'string', description: 'id or name of the encounter that uses this map' },
          location: { type: 'string', description: 'id or name of the location' },
          parentMap: { type: 'string', description: 'id or name of parent map' },
          generateImage: { type: 'boolean' },
        },
        required: ['name', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_battlemap',
      description: 'Rename/describe/delete a battle map or (re)generate its image.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          regenerateImage: { type: 'boolean' },
          delete: { type: 'boolean' },
        },
        required: ['id'],
      },
    },
  },
]

TOOLS.push({
  type: 'function',
  function: {
    name: 'generate_complete',
    description:
      'Fully generate (or complete) one entry with ALL its parts in one go, exactly like the GM\'s "Generate" button: text, stat block, structured encounter creatures (official stat blocks or new homebrew creatures with full stats), painted battle map with creatures placed, illustration, and entries for missing links. For type "dungeon" it designs the whole site: rooms/caves of any shape, passages, room encounters, an overview map painted from the floor plan with clickable areas, detailed room maps. Slow and uses image generation — use it when the GM wants something finished, especially encounters and dungeons.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ENTITY_TYPE_LIST },
        id: { type: 'string', description: 'id or exact name of an existing entry to complete (omit to create a new one)' },
        name: { type: 'string' },
        summary: { type: 'string' },
        instructions: { type: 'string', description: 'what it should be like' },
        parts: {
          type: 'array',
          items: { type: 'string', enum: ['text', 'stats', 'encounter', 'creatures', 'map', 'image', 'links', 'rooms', 'roomMaps', 'roomImages'] },
          description: 'which parts to generate; default: all parts that apply to the type',
        },
        size: { type: 'string', enum: ['small', 'medium', 'large'], description: 'dungeon size' },
        parent: { type: 'string', description: 'id or name of the parent entry (e.g. the location of an encounter)' },
      },
      required: ['type'],
    },
  },
})

export const ADVISOR_TOOL: ORTool = {
  type: 'function',
  function: {
    name: 'consult_advisors',
    description: 'Ask the GM’s advisor panel for opinions on a plan or question. Use for important design decisions when the GM wants feedback.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ToolEnv {
  campaignId: string
  ctx: ChangeCtx
  signal?: AbortSignal
  consultAdvisors?: (question: string) => Promise<string>
  onProgress?: (text: string) => void
}

async function allEntities(campaignId: string) {
  return db.entities.where('campaignId').equals(campaignId).toArray()
}

function findByRef(list: Entity[], ref: string | undefined): Entity | undefined {
  if (!ref) return undefined
  const byId = list.find((e) => e.id === ref)
  if (byId) return byId
  const n = normalizeName(ref)
  return list.find((e) => normalizeName(e.name) === n) ?? list.find((e) => e.aliases.some((a) => normalizeName(a) === n))
}

async function findMap(campaignId: string, ref?: string) {
  if (!ref) return undefined
  const maps = await db.maps.where('campaignId').equals(campaignId).toArray()
  return maps.find((m) => m.id === ref) ?? maps.find((m) => normalizeName(m.name) === normalizeName(ref))
}

async function prepareFields(campaign: Campaign, raw: any, list: Entity[]): Promise<Partial<Entity>> {
  const data = sanitizeEntityData(raw)
  if (raw.parent !== undefined) {
    const p = findByRef(list, raw.parent)
    data.parentId = p?.id
  }
  if (data.encounter) {
    const creatures = data.encounter.creatures.map((c: any) => {
      const own = findByRef(list, c.refId) ?? findByRef(list, c.name)
      if (own) return { refId: own.id, name: own.name, count: Number(c.count) || 1 }
      const ref = findRef(campaign.system, c.refId?.includes('-') ? c.name : c.refId || c.name, 'creature') ?? findRef(campaign.system, c.name, 'creature')
      return { refId: ref?.id ?? c.refId ?? '', name: ref?.name ?? c.name, count: Number(c.count) || 1 }
    })
    const map = raw.encounter?.map ? await findMap(campaign.id, raw.encounter.map) : undefined
    data.encounter = { ...data.encounter, creatures, mapId: map?.id ?? data.encounter.mapId }
  }
  return data
}

const ok = (o: unknown) => JSON.stringify(o)

export async function executeTool(name: string, argsJson: string, env: ToolEnv): Promise<string> {
  let args: any
  try {
    args = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return ok({ error: 'Invalid JSON arguments' })
  }
  const campaign = await db.campaigns.get(env.campaignId)
  if (!campaign) return ok({ error: 'campaign missing' })

  switch (name) {
    case 'read_entities': {
      const list = await allEntities(env.campaignId)
      const out = (args.ids as string[]).map((r) => {
        const e = findByRef(list, r)
        return e ? entityFull(e) : JSON.stringify({ error: `not found: ${r}` })
      })
      return out.join('\n')
    }
    case 'search_campaign': {
      const list = await allEntities(env.campaignId)
      const q = normalizeName(args.query || '')
      const hits = list.filter(
        (e) => (!args.type || e.type === args.type) && normalizeName(`${e.name} ${e.aliases.join(' ')} ${e.summary} ${e.body} ${e.secrets ?? ''}`).includes(q),
      )
      return hits.slice(0, 40).map(entityIndexLine).join('\n') || 'No matches.'
    }
    case 'create_entities': {
      const items: any[] = Array.isArray(args.entities) ? args.entities : []
      const created: { id: string; name: string; type: string }[] = []
      const list = await allEntities(env.campaignId)
      // create parents first so children can reference them by name
      const rank = (t: string) => (t === 'chapter' ? 0 : t === 'location' ? 1 : t === 'faction' ? 2 : t === 'creature' || t === 'npc' ? 3 : 4)
      const sorted = [...items].sort((a, b) => rank(a.type) - rank(b.type))
      for (const raw of sorted) {
        const type = (ENTITY_TYPE_LIST.includes(raw.type) ? raw.type : 'note') as EntityType
        const fields = await prepareFields(campaign, raw, list)
        const e = await createEntity(env.campaignId, type, { ...fields, name: raw.name }, env.ctx)
        list.push(e)
        created.push({ id: e.id, name: e.name, type })
      }
      env.onProgress?.(`Created ${created.length} entr${created.length === 1 ? 'y' : 'ies'}`)
      return ok({ created })
    }
    case 'update_entity': {
      const list = await allEntities(env.campaignId)
      const e = findByRef(list, args.id)
      if (!e) return ok({ error: `not found: ${args.id}` })
      const fields = await prepareFields(campaign, args.fields || {}, list)
      if (args.fields?.type && ENTITY_TYPE_LIST.includes(args.fields.type)) (fields as any).type = args.fields.type
      await updateEntity(e.id, fields, env.ctx)
      return ok({ updated: e.id })
    }
    case 'edit_text': {
      const list = await allEntities(env.campaignId)
      const e = findByRef(list, args.id)
      if (!e) return ok({ error: `not found: ${args.id}` })
      const field = args.field as 'body' | 'secrets' | 'summary'
      const cur = (e[field] as string) ?? ''
      let next: string
      if (!args.find) next = cur + (cur ? '\n\n' : '') + args.replace
      else {
        const count = cur.split(args.find).length - 1
        if (count === 0) return ok({ error: 'find text not found — read the entity and use an exact snippet' })
        if (count > 1) return ok({ error: `find text occurs ${count} times — use a longer, unique snippet` })
        next = cur.replace(args.find, () => args.replace)
      }
      await updateEntity(e.id, { [field]: next }, env.ctx)
      return ok({ updated: e.id })
    }
    case 'delete_entities': {
      const list = await allEntities(env.campaignId)
      const deleted: string[] = []
      for (const r of args.ids as string[]) {
        const e = findByRef(list, r)
        if (e) {
          await deleteEntity(e.id, env.ctx)
          deleted.push(e.name)
        }
      }
      return ok({ deleted })
    }
    case 'update_campaign': {
      const allowed = ['name', 'premise', 'tone', 'artStyle', 'partyLevel', 'partySize', 'language', 'aiInstructions']
      const patch: Record<string, unknown> = {}
      for (const k of allowed) if (args[k] !== undefined) patch[k] = args[k]
      await updateCampaign(env.campaignId, patch, env.ctx)
      return ok({ updated: Object.keys(patch) })
    }
    case 'set_party': {
      const colors = ['#4f9dde', '#58b368', '#d9a441', '#b06ad9', '#de6a5a', '#4fc2c2', '#d96aa8', '#8c9bab']
      const party: PartyMember[] = (args.members as any[]).map((m, i) => {
        const existing = campaign.party.find((p) => normalizeName(p.name) === normalizeName(m.name))
        return {
          id: existing?.id ?? newId('pc'),
          name: m.name,
          player: m.player ?? existing?.player,
          description: m.description ?? existing?.description,
          initBonus: Number(m.initBonus ?? existing?.initBonus ?? 0),
          maxHp: m.maxHp ?? existing?.maxHp,
          ac: m.ac ?? existing?.ac,
          color: existing?.color ?? colors[i % colors.length],
          image: existing?.image,
        }
      })
      await updateCampaign(env.campaignId, { party, partySize: party.length || campaign.partySize }, env.ctx)
      return ok({ party: party.map((p) => p.name) })
    }
    case 'search_rules': {
      await loadCompendium(campaign.system)
      const hits = searchRefs(campaign.system, args.query ?? '', {
        category: args.category as RefCategory | undefined,
        maxLevel: args.maxLevel,
        limit: Math.min(Number(args.limit) || 25, 60),
      })
      if (!hits.length) return 'No official entries found. Create homebrew if needed.'
      return hits
        .map((r) => `- [${r.category}] ${r.name}${r.level !== undefined ? ` (level ${r.level})` : ''}${r.cr ? ` (CR ${r.cr})` : ''}${r.traits?.length ? ` [${r.traits.slice(0, 6).join(', ')}]` : ''}: ${r.summary ?? ''} (id=${r.id})`)
        .join('\n')
    }
    case 'read_rule': {
      await loadCompendium(campaign.system)
      const r = findRef(campaign.system, args.name, args.category)
      if (!r) return 'Not found in the rules reference.'
      return JSON.stringify({ ...r, text: r.text.slice(0, 6000) })
    }
    case 'illustrate': {
      const list = await allEntities(env.campaignId)
      const e = findByRef(list, args.id)
      if (!e) return ok({ error: `not found: ${args.id}` })
      env.onProgress?.(`Painting ${e.name}…`)
      const a = await illustrateEntity(campaign, e, args.direction, env.ctx)
      return ok({ image: a.id, entity: e.id })
    }
    case 'create_battlemap': {
      const list = await allEntities(env.campaignId)
      const encounter = findByRef(list, args.encounter)
      const location = findByRef(list, args.location)
      const parent = await findMap(env.campaignId, args.parentMap)
      const cols = Math.max(5, Math.min(120, Number(args.cols) || 30))
      const rows = Math.max(5, Math.min(120, Number(args.rows) || 20))
      let map = await createMap(
        env.campaignId,
        {
          name: args.name,
          description: args.description,
          parentId: parent?.id,
          encounterId: encounter?.id,
          locationId: location?.id,
          width: cols * 70,
          height: rows * 70,
        },
        env.ctx,
      )
      if (encounter?.encounter) await updateEntity(encounter.id, { encounter: { ...encounter.encounter, mapId: map.id } }, env.ctx)
      if (args.generateImage) {
        env.onProgress?.(`Painting map “${args.name}”…`)
        const r = await generateBattlemapImage(campaign, args.description, { cols, rows })
        map = await updateMap(
          map.id,
          { image: r.asset.id, width: r.asset.width || map.width, height: r.asset.height || map.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } },
          env.ctx,
        )
      }
      const placed = encounter ? await seedEncounterMap(map.id, env.ctx) : 0
      return ok({ map: map.id, image: !!map.image, tokensPlaced: placed })
    }
    case 'update_battlemap': {
      const map = await findMap(env.campaignId, args.id)
      if (!map) return ok({ error: 'map not found' })
      if (args.delete) {
        await deleteMap(map.id, env.ctx)
        return ok({ deleted: map.id })
      }
      const patch: Record<string, unknown> = {}
      if (args.name) patch.name = args.name
      if (args.description) patch.description = args.description
      if (args.regenerateImage) {
        env.onProgress?.(`Painting map “${map.name}”…`)
        const cols = Math.round(map.width / map.grid.size) || 30
        const rows = Math.round(map.height / map.grid.size) || 20
        const r = await generateBattlemapImage(campaign, (args.description as string) || map.description, { cols, rows })
        Object.assign(patch, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize, offsetX: 0, offsetY: 0 } })
      }
      await updateMap(map.id, patch, env.ctx)
      return ok({ updated: map.id })
    }
    case 'generate_complete': {
      const { completeEntity, partsFor } = await import('./complete')
      const list = await allEntities(env.campaignId)
      const type = (ENTITY_TYPE_LIST.includes(args.type) ? args.type : 'note') as EntityType
      const target = args.id ? findByRef(list, args.id) : undefined
      const all = partsFor(type)
      const wanted = Array.isArray(args.parts) && args.parts.length ? all.filter((x) => args.parts.includes(x)) : all
      const parent = findByRef(list, args.parent)
      const log: string[] = []
      const id = await completeEntity(
        campaign,
        { type, id: target?.id, draft: { name: args.name ?? target?.name, summary: args.summary ?? target?.summary, parentId: parent?.id ?? target?.parentId } },
        new Set(wanted),
        { instructions: args.instructions, size: args.size },
        (step, patch) => {
          if (patch.detail) env.onProgress?.(`${step}: ${patch.detail}`)
          if (patch.status === 'done' || patch.status === 'error') log.push(`${step}: ${patch.status}${patch.detail ? ' — ' + patch.detail : ''}`)
        },
        env.ctx,
      )
      const e = await db.entities.get(id)
      return ok({ id, name: e?.name, steps: log })
    }
    case 'consult_advisors': {
      if (!env.consultAdvisors) return 'Advisors unavailable.'
      return env.consultAdvisors(args.question)
    }
  }
  return ok({ error: `unknown tool ${name}` })
}
