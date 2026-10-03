import { db } from '@/db/db'
import { newId } from '@/lib/id'
import { getSettings } from '@/state/settings'
import { chat, type ORMessage } from './openrouter'
import { ADVISOR_TOOL, executeTool, TOOLS } from './tools'
import { campaignKnowledge, ENTITY_FIELDS_DOC, gmPreferences, LINK_RULES, languageRule, STATBLOCK_SCHEMA } from './prompts'
import type { Advisor, ChatMessage } from '@/types'
import { LEVEL_PLANNING } from '@/lib/levels'
import { SYSTEM_LABEL, type Campaign } from '@/types'

export const AGENT_GUIDE = `You are Minion, the co-author and assistant of a game master. You have FULL read/write access to the campaign through tools: you can create, change and delete every entry, the party, campaign settings and battle maps, and look up the official rules.

How to work:
- When the GM asks for something, do it with the tools — don't just describe what you would do. For large or ambiguous creative choices, briefly propose options first unless the GM asked you to just do it.
- After changes, reply with a short summary of what you created/changed (use [[links]] to the entries). The GM can undo every change.
- Read an entry (read_entities) before editing it if its full content isn't in context. Use edit_text for small changes in long texts.
- Prefer official creatures/spells/items (search_rules) over homebrew; create homebrew entries (with full mechanics) when nothing fits or the GM asks.

What makes content great at the table:
- Chapters ("chapter") hold the playable story flow in order: situation, what the players see (read-aloud "> " boxes), what happens, choices and consequences, links to scenes, NPCs, locations, encounters, handouts. Scenes ("scene") are concrete events within a chapter (parent = chapter).
- NPCs: look, voice/mannerism, motivation, what they know, secrets; stats only if they may fight.
- Locations: sensory description, notable features, inhabitants, hooks; sub-locations via parent.
- Dungeons (type "dungeon"): build them with generate_complete — it designs rooms, passages, encounters, floor plan and all maps. Finished encounters (creatures resolved, map painted and populated) also come from generate_complete.
- Encounters: creatures appropriate to party level (encounter.creatures with exact official names or homebrew creature entries), tactics, terrain, what happens on win/lose; a battle map description. Every fight the story contains gets its own "encounter" entry — a fight written only into chapter/scene text has no creatures to place and no battle map.
- Every rules reference (spell, condition, action, creature, item, trait) is a [[wikilink]] so the GM can tap it. The GM must never need another book.
- Keep summaries short (one line). Use Markdown headings, lists and bold for scannability on a tablet.`

export function buildSystemPrompt(campaignKnowledgeText: string, campaign: Campaign) {
  return [
    AGENT_GUIDE,
    `Game system: ${SYSTEM_LABEL[campaign.system]}.`,
    languageRule(campaign),
    LINK_RULES,
    ENTITY_FIELDS_DOC,
    STATBLOCK_SCHEMA,
    LEVEL_PLANNING(campaign),
    gmPreferences('all', true),
    `=== CURRENT CAMPAIGN STATE ===\n${campaignKnowledgeText}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function loadKnowledge(campaignId: string) {
  const [campaign, entities, maps] = await Promise.all([
    db.campaigns.get(campaignId),
    db.entities.where('campaignId').equals(campaignId).toArray(),
    db.maps.where('campaignId').equals(campaignId).toArray(),
  ])
  if (!campaign) throw new Error('Campaign not found')
  const k = campaignKnowledge(campaign, entities, maps, getSettings().contextMode)
  return { campaign, entities, maps, knowledge: k.text }
}

/** Convert stored chat history to OpenRouter messages (older tool outputs truncated). */
export function historyToMessages(history: ChatMessage[]): ORMessage[] {
  const out: ORMessage[] = []
  const lastUserIdx = history.map((m) => m.role).lastIndexOf('user')
  history.forEach((m, i) => {
    const old = i < lastUserIdx
    if (m.role === 'user') out.push({ role: 'user', content: m.content })
    else if (m.role === 'advisor') {
      // advisor comments reach the writer only when the GM forwards them (as a user message);
      // ones the writer asked for itself are part of its tool result
      return
    } else if (m.role === 'assistant') {
      if (!m.content && !m.toolCalls?.length) return
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls?.length ? m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })) : undefined,
      })
    } else if (m.role === 'tool') {
      const c = old && m.content.length > 400 ? m.content.slice(0, 400) + '… (truncated)' : m.content
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: c })
    }
  })
  // drop dangling tool calls (e.g. aborted turns) — providers reject them
  const answered = new Set(out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id))
  return out
    .map((m) => (m.role === 'assistant' && m.tool_calls ? { ...m, tool_calls: m.tool_calls.filter((t) => answered.has(t.id)) } : m))
    .map((m) => (m.role === 'assistant' && m.tool_calls && !m.tool_calls.length ? { ...m, tool_calls: undefined, content: m.content || '…' } : m))
}

export interface AgentCallbacks {
  onStream?: (text: string) => void
  onReasoning?: (text: string) => void
  onProgress?: (text: string) => void
  onMessage?: (m: ChatMessage) => void
}

const MAX_STEPS = 40

/** tools without side effects — safe to run in parallel with anything */
const READ_TOOLS = new Set(['read_entities', 'search_campaign', 'search_rules', 'read_rule'])
/** slow generation tools — run together after the edits of the same turn */
const SLOW_TOOLS = new Set(['illustrate', 'create_battlemap', 'update_battlemap', 'generate_complete', 'consult_advisors'])

/**
 * Run one agent turn: the user message is already stored. Loops tool calls until the model answers.
 * Returns the change batch id used for this turn.
 */
export async function runAgentTurn(
  campaignId: string,
  threadId: string,
  cb: AgentCallbacks = {},
  signal?: AbortSignal,
  opts: { batchId?: string; extraSystem?: string; model?: string; label?: string; background?: boolean } = {},
): Promise<string> {
  const settings = getSettings()
  const batchId = opts.batchId ?? newId('b')
  const ctx = { batchId, source: 'ai' as const }
  const tools = [...TOOLS, ...(settings.advisors.some((a) => a.enabled) ? [ADVISOR_TOOL] : [])]

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const { campaign, knowledge } = await loadKnowledge(campaignId)
    const history = await db.messages.where('threadId').equals(threadId).sortBy('createdAt')
    const messages: ORMessage[] = [
      { role: 'system', content: buildSystemPrompt(knowledge, campaign) + (opts.extraSystem ? `\n\n${opts.extraSystem}` : '') },
      ...historyToMessages(history),
    ]
    const model = opts.model || settings.chatModel
    const res = await chat({ model, messages, tools, signal, onDelta: cb.onStream, onReasoning: cb.onReasoning, temperature: 0.7, label: opts.label ?? 'Campaign chat', source: opts.background ? undefined : 'chat' })
    const msg: ChatMessage = {
      id: newId('m'),
      campaignId,
      threadId,
      role: 'assistant',
      content: res.content,
      model,
      toolCalls: res.toolCalls.length ? res.toolCalls : undefined,
      changeBatch: batchId,
      cost: res.cost,
      createdAt: Date.now(),
    }
    await db.messages.add(msg)
    cb.onMessage?.(msg)
    cb.onStream?.('')
    if (!res.toolCalls.length) break

    // Run this turn's tool calls concurrently where safe: lookups in parallel, edits in the
    // order the model asked for them, then slow generation work (images, maps, advisors) all at once.
    const exec = async (call: (typeof res.toolCalls)[number]): Promise<string> => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      cb.onProgress?.(toolLabel(call.name, call.arguments))
      try {
        return await executeTool(call.name, call.arguments, {
          campaignId,
          ctx,
          signal,
          onProgress: cb.onProgress,
          consultAdvisors: async (q) => {
            const answers = await consultAdvisors(campaignId, threadId, q, signal, undefined, true)
            return answers.map((a) => `${a.advisor}: ${a.content}`).join('\n\n')
          },
        })
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e
        return JSON.stringify({ error: e?.message ?? String(e) })
      }
    }
    const results = new Map<string, string>()
    const run = async (call: (typeof res.toolCalls)[number]) => results.set(call.id, await exec(call))
    const reads = Promise.all(res.toolCalls.filter((c) => READ_TOOLS.has(c.name)).map(run))
    for (const call of res.toolCalls.filter((c) => !READ_TOOLS.has(c.name) && !SLOW_TOOLS.has(c.name))) await run(call)
    await reads
    await Promise.all(res.toolCalls.filter((c) => SLOW_TOOLS.has(c.name)).map(run))
    // store results in the order of the calls (providers expect that)
    let t = Date.now()
    for (const call of res.toolCalls) {
      const toolMsg: ChatMessage = {
        id: newId('m'),
        campaignId,
        threadId,
        role: 'tool',
        content: results.get(call.id) ?? JSON.stringify({ error: 'not executed' }),
        toolCallId: call.id,
        createdAt: t++,
      }
      await db.messages.add(toolMsg)
    }
    await db.threads.update(threadId, { updatedAt: Date.now() })
  }
  return batchId
}

export function toolLabel(name: string, args: string): string {
  let a: any = {}
  try {
    a = JSON.parse(args)
  } catch {
    /* partial */
  }
  switch (name) {
    case 'read_entities':
      return `Reading ${a.ids?.length ?? ''} entr${a.ids?.length === 1 ? 'y' : 'ies'}`
    case 'search_campaign':
      return `Searching campaign for “${a.query ?? ''}”`
    case 'create_entities':
      return `Creating ${(a.entities ?? []).map((e: any) => e.name).slice(0, 4).join(', ')}${(a.entities?.length ?? 0) > 4 ? '…' : ''}`
    case 'update_entity':
    case 'edit_text':
      return `Editing ${a.id ?? ''}`
    case 'delete_entities':
      return `Deleting ${(a.ids ?? []).join(', ')}`
    case 'update_campaign':
      return 'Updating campaign settings'
    case 'set_party':
      return 'Updating the party'
    case 'search_rules':
      return `Looking up rules: ${a.query ?? ''}${a.category ? ` (${a.category})` : ''}`
    case 'read_rule':
      return `Reading rule: ${a.name ?? ''}`
    case 'illustrate':
      return `Illustrating ${a.id ?? ''}`
    case 'create_battlemap':
      return `Creating battle map “${a.name ?? ''}”`
    case 'update_battlemap':
      return `Updating battle map`
    case 'consult_advisors':
      return 'Consulting advisors'
    case 'generate_complete':
      return `Generating ${a.type ?? 'entry'} “${a.name ?? a.id ?? ''}” completely (text, creatures, maps, images…)`
  }
  return name
}

// ---------------------------------------------------------------------------
// Advisors
// ---------------------------------------------------------------------------

const ADVISOR_TOOLS = TOOLS.filter((t) => READ_TOOLS.has(t.function.name))
const ADVISOR_MAX_STEPS = 6

/** One advisor answer: may read entries and rules (never change anything) before commenting. */
async function advisorChat(campaignId: string, model: string, label: string, signal: AbortSignal | undefined, messages: ORMessage[]) {
  let cost = 0
  for (let step = 0; ; step++) {
    const last = step >= ADVISOR_MAX_STEPS - 1
    const res = await chat({ label, model, signal, temperature: 0.7, messages, tools: last ? undefined : ADVISOR_TOOLS })
    cost += res.cost ?? 0
    if (last || !res.toolCalls.length) return { content: res.content, cost }
    messages = [
      ...messages,
      { role: 'assistant', content: res.content || null, tool_calls: res.toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } })) },
    ]
    for (const call of res.toolCalls) {
      const content = READ_TOOLS.has(call.name)
        ? await executeTool(call.name, call.arguments, { campaignId, ctx: { batchId: newId('b'), source: 'ai' }, signal }).catch((e) => JSON.stringify({ error: e?.message ?? String(e) }))
        : JSON.stringify({ error: 'Advisors can only read.' })
      messages = [...messages, { role: 'tool', tool_call_id: call.id, content }]
    }
  }
}

export async function consultAdvisors(
  campaignId: string,
  threadId: string,
  question: string | undefined,
  signal?: AbortSignal,
  advisors?: Advisor[],
  viaTool = false,
): Promise<ChatMessage[]> {
  const settings = getSettings()
  const list = (advisors ?? settings.advisors).filter((a) => a.enabled)
  if (!list.length) return []
  const { campaign, knowledge } = await loadKnowledge(campaignId)
  const history = await db.messages.where('threadId').equals(threadId).sortBy('createdAt')
  const convo = history
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content) || m.role === 'advisor')
    .slice(-12)
    .map((m) => `${m.role === 'user' ? 'GM' : m.role === 'advisor' ? `Advisor ${m.advisor}` : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const results = await Promise.all(
    list.map(async (a) => {
      try {
        const r = await advisorChat(campaignId, a.model || settings.fastModel, `Advisor: ${a.name}`, signal, [
          {
            role: 'system',
            content: [
              `You are “${a.name}”, an advisor on a game master's advisory panel. ${a.persona}`,
              `You cannot change the campaign yourself — you read and comment. The GM decides what to pass on to the story writer. Base your comments on the actual text: when the campaign below is only an index, read the entries you comment on with read_entities (and look up rules with search_rules/read_rule) before answering. Be concise (max ~180 words), concrete and actionable. Use bullet points. Reference entries with [[Name]]. Disagree when warranted.`,
              languageRule(campaign),
              gmPreferences('all'),
              `=== CAMPAIGN ===\n${knowledge}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
          {
            role: 'user',
            content: `Recent conversation:\n${convo || '(none)'}\n\n${question ? `Question for the panel: ${question}` : 'Give your opinion on the current state/plan.'}`,
          },
        ])
        const m: ChatMessage = {
          id: newId('m'),
          campaignId,
          threadId,
          role: 'advisor',
          viaTool,
          advisor: `${a.emoji} ${a.name}`,
          model: a.model || settings.fastModel,
          content: r.content,
          cost: r.cost,
          createdAt: Date.now(),
        }
        await db.messages.add(m)
        return m
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e
        const m: ChatMessage = {
          id: newId('m'),
          campaignId,
          threadId,
          role: 'advisor',
          viaTool,
          advisor: `${a.emoji} ${a.name}`,
          content: '',
          error: e?.message ?? String(e),
          createdAt: Date.now(),
        }
        await db.messages.add(m)
        return m
      }
    }),
  )
  return results
}
