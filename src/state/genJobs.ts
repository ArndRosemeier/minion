import { create } from 'zustand'
import { db } from '@/db/db'
import { newId } from '@/lib/id'
import { completeEntity, stepsFor, type CompleteInput, type CompleteOptions, type JobStep, type Part } from '@/ai/complete'
import { toast } from './ui'

export interface GenJob {
  id: string
  campaignId: string
  title: string
  steps: JobStep[]
  running: boolean
  entityId?: string
  error?: string
  batchId: string
  controller: AbortController
}

interface GenJobStore {
  jobs: Record<string, GenJob>
  start: (campaignId: string, input: CompleteInput, parts: Set<Part>, opts: Omit<CompleteOptions, 'signal'>) => string
  stop: (jobId: string) => void
}

/** Background "generate everything" jobs; they keep running when the dialog that started them closes. */
export const useGenJobs = create<GenJobStore>((set, get) => {
  const patch = (id: string, p: Partial<GenJob> | ((j: GenJob) => Partial<GenJob>)) =>
    set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...(typeof p === 'function' ? p(s.jobs[id]) : p) } } } : s))

  return {
    jobs: {},
    start: (campaignId, input, parts, opts) => {
      const id = newId('job')
      const controller = new AbortController()
      const batchId = newId('b')
      const title = input.draft.name || 'New entry'
      set((s) => ({
        jobs: { ...s.jobs, [id]: { id, campaignId, title, steps: stepsFor(input.type, parts), running: true, batchId, controller } },
      }))
      ;(async () => {
        try {
          const campaign = await db.campaigns.get(campaignId)
          if (!campaign) throw new Error('Campaign not found')
          const entityId = await completeEntity(
            campaign,
            input,
            parts,
            { ...opts, signal: controller.signal },
            (stepId, p) => patch(id, (j) => ({ steps: j.steps.map((st) => (st.id === stepId ? { ...st, ...p } : st)) })),
            { batchId, source: 'ai' },
          )
          patch(id, { entityId })
          const failed = get().jobs[id]?.steps.filter((s) => s.status === 'error') ?? []
          const name = (await db.entities.get(entityId))?.name ?? title
          toast(failed.length ? `“${name}” generated with ${failed.length} failed step(s)` : `“${name}” is complete`, failed.length ? 'info' : 'success')
        } catch (e: any) {
          const msg = e?.name === 'AbortError' ? 'Stopped' : (e?.message ?? String(e))
          patch(id, { error: msg })
          if (e?.name !== 'AbortError') toast(`Generation failed: ${msg}`, 'error')
        } finally {
          patch(id, (j) => ({ running: false, steps: j.steps.map((s) => (s.status === 'pending' || s.status === 'running' ? { ...s, status: 'skipped' } : s)) }))
        }
      })()
      return id
    },
    stop: (jobId) => get().jobs[jobId]?.controller.abort(),
  }
})
