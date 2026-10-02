import { create } from 'zustand'
import { newId } from '@/lib/id'

export interface AiStream {
  id: string
  label: string
  model: string
  kind: 'text' | 'image'
  /** campaign chat streams are shown inline in the chat instead of the overlay */
  source?: 'chat'
  reasoning: string
  content: string
  startedAt: number
  /** waiting for a free request slot */
  queued?: boolean
  endedAt?: number
  error?: string
}

interface ActivityState {
  streams: AiStream[]
  /** overlay minimized by the user until the AI is idle again */
  minimized: boolean
  /** overlay explicitly opened (even if auto-show is off) */
  pinnedOpen: boolean
  /** the campaign chat is on screen (its streams are shown inline there) */
  chatVisible: boolean
  setMinimized: (v: boolean) => void
  setPinnedOpen: (v: boolean) => void
  setChatVisible: (v: boolean) => void
}

export const useActivity = create<ActivityState>((set) => ({
  streams: [],
  minimized: false,
  pinnedOpen: false,
  chatVisible: false,
  setChatVisible: (chatVisible) => set({ chatVisible }),
  setMinimized: (minimized) => set({ minimized }),
  setPinnedOpen: (pinnedOpen) => set({ pinnedOpen }),
}))

// Stream deltas arrive many times per second; batch store updates per animation frame.
const pending = new Map<string, Partial<AiStream>>()
let frame = 0
function flush() {
  frame = 0
  if (!pending.size) return
  const updates = new Map(pending)
  pending.clear()
  useActivity.setState((s) => ({ streams: s.streams.map((st) => (updates.has(st.id) ? { ...st, ...updates.get(st.id) } : st)) }))
}
const schedule = () => {
  if (frame) return
  frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 50) as unknown as number)
}

const KEEP_FINISHED_MS = 8000

export const activity = {
  start(s: { label: string; model: string; kind: AiStream['kind']; source?: AiStream['source']; content?: string; queued?: boolean }): string {
    const id = newId('ai')
    useActivity.setState((st) => ({
      // the overlay opens again when the AI starts after being idle
      minimized: st.streams.some((x) => !x.endedAt) ? st.minimized : false,
      streams: [...st.streams.filter((x) => !x.endedAt || Date.now() - x.endedAt < KEEP_FINISHED_MS), { id, reasoning: '', content: s.content ?? '', startedAt: Date.now(), ...s }],
    }))
    return id
  },
  /** a request slot was granted (timer restarts) */
  running(id: string) {
    flush()
    useActivity.setState((s) => ({ streams: s.streams.map((x) => (x.id === id ? { ...x, queued: false, startedAt: Date.now() } : x)) }))
  },
  update(id: string, patch: Partial<Pick<AiStream, 'reasoning' | 'content'>>) {
    pending.set(id, { ...(pending.get(id) ?? {}), ...patch })
    schedule()
  },
  finish(id: string, error?: string) {
    flush()
    useActivity.setState((s) => ({ streams: s.streams.map((x) => (x.id === id ? { ...x, endedAt: Date.now(), error } : x)) }))
    setTimeout(() => useActivity.setState((s) => ({ streams: s.streams.filter((x) => x.id !== id || !x.endedAt || Date.now() - x.endedAt < KEEP_FINISHED_MS) })), KEEP_FINISHED_MS + 100)
  },
}
