import { getSettings } from '@/state/settings'
import { activity } from '@/state/activity'

const BASE = 'https://openrouter.ai/api/v1'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ORMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[] | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export interface ORTool {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ORModel {
  id: string
  name: string
  context_length: number
  pricing: { prompt: string; completion: string; image?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  supported_parameters?: string[]
}

export interface ChatResult {
  content: string
  /** model reasoning ("thinking"), if the model exposes it */
  reasoning?: string
  toolCalls: { id: string; name: string; arguments: string }[]
  cost?: number
  finishReason?: string
}

export class OpenRouterError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

function headers(): HeadersInit {
  const { apiKey } = getSettings()
  if (!apiKey) throw new OpenRouterError('No OpenRouter API key set. Add one in Settings.')
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': location.origin,
    'X-Title': 'Minion GM Companion',
  }
}

async function check(res: Response) {
  if (res.ok) return
  let msg = `${res.status} ${res.statusText}`
  try {
    const j = await res.json()
    msg = j?.error?.message || JSON.stringify(j)
    const raw = j?.error?.metadata?.raw
    if (raw) msg += ` — ${typeof raw === 'string' ? raw.slice(0, 300) : JSON.stringify(raw).slice(0, 300)}`
  } catch {
    /* ignore */
  }
  throw new OpenRouterError(msg, res.status)
}

let modelCache: ORModel[] | null = null

export async function listModels(force = false): Promise<ORModel[]> {
  if (modelCache && !force) return modelCache
  const res = await fetch(`${BASE}/models`)
  await check(res)
  const j = await res.json()
  modelCache = (j.data as ORModel[]).filter((m) => !m.id.endsWith(':batch')).sort((a, b) => a.id.localeCompare(b.id))
  return modelCache
}

export const isImageModel = (m: ORModel) => !!m.architecture?.output_modalities?.includes('image')
export const supportsTools = (m: ORModel) => !!m.supported_parameters?.includes('tools')

export interface ChatOptions {
  model: string
  messages: ORMessage[]
  tools?: ORTool[]
  temperature?: number
  maxTokens?: number
  json?: boolean
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
  /** what this call does, shown in the AI activity overlay */
  label?: string
  /** campaign chat calls are shown inline in the chat view */
  source?: 'chat'
}

/** Streaming chat completion with tool-call support; reported to the AI activity overlay. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const id = activity.start({ label: opts.label ?? 'AI', model: opts.model, kind: 'text', source: opts.source })
  try {
    const r = await chatStream({
      ...opts,
      onDelta: (t) => {
        activity.update(id, { content: t })
        opts.onDelta?.(t)
      },
      onReasoning: (t) => {
        activity.update(id, { reasoning: t })
        opts.onReasoning?.(t)
      },
    })
    activity.finish(id)
    return r
  } catch (e: any) {
    activity.finish(id, e?.name === 'AbortError' ? 'stopped' : (e?.message ?? String(e)))
    throw e
  }
}

async function chatStream(opts: ChatOptions): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    usage: { include: true },
  }
  if (opts.tools?.length) body.tools = opts.tools
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.json) body.response_format = { type: 'json_object' }

  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  await check(res)
  if (!res.body) throw new OpenRouterError('Empty response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let reasoning = ''
  let cost: number | undefined
  let finishReason: string | undefined
  const calls: Record<number, { id: string; name: string; arguments: string }> = {}

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      let j: any
      try {
        j = JSON.parse(data)
      } catch {
        continue
      }
      if (j.error) throw new OpenRouterError(j.error.message || 'Stream error')
      if (j.usage?.cost !== undefined) cost = j.usage.cost
      const choice = j.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const d = choice.delta || {}
      // reasoning arrives as plain text or as structured reasoning details, depending on the provider
      const think = typeof d.reasoning === 'string' ? d.reasoning : Array.isArray(d.reasoning_details) ? d.reasoning_details.map((r: any) => r?.text ?? r?.summary ?? '').join('') : ''
      if (think) {
        reasoning += think
        opts.onReasoning?.(reasoning)
      }
      if (d.content) {
        content += d.content
        opts.onDelta?.(content)
      }
      for (const tc of d.tool_calls || []) {
        const idx = tc.index ?? 0
        const cur = (calls[idx] ||= { id: '', name: '', arguments: '' })
        if (tc.id) cur.id = tc.id
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.arguments += tc.function.arguments
      }
    }
  }
  const toolCalls = Object.values(calls).map((c, i) => ({ ...c, id: c.id || `call_${i}_${Date.now()}` }))
  return { content, reasoning: reasoning || undefined, toolCalls, cost, finishReason }
}

/** Non-tool chat that must return a JSON object. Retries parsing leniently. */
export async function chatJson<T = any>(opts: Omit<ChatOptions, 'json' | 'tools'>): Promise<{ data: T; cost?: number }> {
  const r = await chat({ ...opts, json: true })
  return { data: parseJsonLoose<T>(r.content), cost: r.cost }
}

export function parseJsonLoose<T>(text: string): T {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1]
  const start = t.search(/[[{]/)
  if (start > 0) t = t.slice(start)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (end >= 0) t = t.slice(0, end + 1)
  return JSON.parse(t)
}

export interface ImageOptions {
  prompt: string
  model?: string
  aspectRatio?: string
  /** data URLs of reference images (image-to-image, consistency) */
  inputImages?: string[]
  signal?: AbortSignal
  /** what is being painted, shown in the AI activity overlay */
  label?: string
}

/** Generate an image through an OpenRouter image-capable chat model. Returns data URLs. */
export async function generateImage(opts: ImageOptions): Promise<{ images: string[]; text: string; cost?: number }> {
  const model = opts.model || getSettings().imageModel
  const act = activity.start({ label: opts.label ?? 'Painting', model, kind: 'image', content: opts.prompt })
  try {
    const r = await generateImageInner({ ...opts, model })
    activity.finish(act)
    return r
  } catch (e: any) {
    activity.finish(act, e?.message ?? String(e))
    throw e
  }
}

async function generateImageInner(opts: ImageOptions & { model: string }): Promise<{ images: string[]; text: string; cost?: number }> {
  const model = opts.model
  const content: ContentPart[] = [{ type: 'text', text: opts.prompt }]
  for (const url of opts.inputImages || []) content.push({ type: 'image_url', image_url: { url } })
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
    modalities: ['image', 'text'],
    usage: { include: true },
  }
  if (opts.aspectRatio) body.image_config = { aspect_ratio: opts.aspectRatio }
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  await check(res)
  const j = await res.json()
  const msg = j.choices?.[0]?.message
  const images: string[] = (msg?.images || []).map((i: any) => i.image_url?.url).filter(Boolean)
  if (!images.length) {
    throw new OpenRouterError(
      `The image model returned no image.${msg?.content ? ` Model said: ${String(msg.content).slice(0, 300)}` : ''}`,
    )
  }
  return { images, text: msg?.content || '', cost: j.usage?.cost }
}
