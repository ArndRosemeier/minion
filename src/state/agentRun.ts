import { create } from 'zustand'
import { db } from '@/db/db'
import { newId } from '@/lib/id'
import { consultAdvisors, runAgentTurn } from '@/ai/agent'
import type { Advisor, ChatMessage } from '@/types'
import { toast } from './ui'

interface RunState {
  threadId: string
  stream: string
  reasoning: string
  progress: string
  kind: 'agent' | 'advisors'
  controller: AbortController
}

interface AgentRunStore {
  runs: Record<string, RunState>
  send: (campaignId: string, threadId: string, text: string, opts?: { extraSystem?: string }) => Promise<string | null>
  advise: (campaignId: string, threadId: string, question?: string, advisors?: Advisor[]) => Promise<void>
  stop: (threadId: string) => void
}

export const useAgentRun = create<AgentRunStore>((set, get) => {
  const patch = (threadId: string, p: Partial<RunState>) =>
    set((s) => (s.runs[threadId] ? { runs: { ...s.runs, [threadId]: { ...s.runs[threadId], ...p } } } : s))
  const end = (threadId: string) =>
    set((s) => {
      const runs = { ...s.runs }
      delete runs[threadId]
      return { runs }
    })

  return {
    runs: {},
    send: async (campaignId, threadId, text, opts) => {
      if (get().runs[threadId]) return null
      const controller = new AbortController()
      set((s) => ({ runs: { ...s.runs, [threadId]: { threadId, stream: '', reasoning: '', progress: 'Thinking…', kind: 'agent', controller } } }))
      try {
        if (text.trim()) {
          const m: ChatMessage = { id: newId('m'), campaignId, threadId, role: 'user', content: text, createdAt: Date.now() }
          await db.messages.add(m)
          const th = await db.threads.get(threadId)
          if (th && (th.title === 'New chat' || !th.title)) await db.threads.update(threadId, { title: text.slice(0, 60), updatedAt: Date.now() })
        }
        const batch = await runAgentTurn(
          campaignId,
          threadId,
          {
            onStream: (stream) => patch(threadId, { stream, progress: stream ? '' : get().runs[threadId]?.progress }),
            onReasoning: (reasoning) => patch(threadId, { reasoning }),
            onProgress: (progress) => patch(threadId, { progress }),
          },
          controller.signal,
          { extraSystem: opts?.extraSystem },
        )
        return batch
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          await db.messages.add({ id: newId('m'), campaignId, threadId, role: 'assistant', content: '', error: e?.message ?? String(e), createdAt: Date.now() })
          toast(e?.message ?? String(e), 'error')
        }
        return null
      } finally {
        end(threadId)
      }
    },
    advise: async (campaignId, threadId, question, advisors) => {
      if (get().runs[threadId]) return
      const controller = new AbortController()
      set((s) => ({ runs: { ...s.runs, [threadId]: { threadId, stream: '', reasoning: '', progress: 'Asking the advisors…', kind: 'advisors', controller } } }))
      try {
        if (question?.trim()) {
          await db.messages.add({ id: newId('m'), campaignId, threadId, role: 'user', content: `🗣️ To the advisors: ${question}`, createdAt: Date.now() })
        }
        await consultAdvisors(campaignId, threadId, question, controller.signal, advisors)
      } catch (e: any) {
        if (e?.name !== 'AbortError') toast(e?.message ?? String(e), 'error')
      } finally {
        end(threadId)
      }
    },
    stop: (threadId) => get().runs[threadId]?.controller.abort(),
  }
})
