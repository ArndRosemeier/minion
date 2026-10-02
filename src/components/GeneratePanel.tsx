import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CircleDashed, Minus, Square, Undo2, Wand2 } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useSettings } from '@/state/settings'
import { useGenJobs } from '@/state/genJobs'
import { useUI } from '@/state/ui'
import { undoBatch } from '@/db/repo'
import { LEVEL_TYPES, PART_LABEL, partsFor, type Part } from '@/ai/complete'
import { levelFor } from '@/lib/levels'
import { contextTokens, formatUsd, type Prices } from '@/lib/gaps'
import { imageCost, usePrices } from '@/lib/usePrices'
import { Button, Input, Segmented, Spinner, cx } from './ui'
import type { Entity, EntityType } from '@/types'

type DungeonSize = 'small' | 'medium' | 'large'
const ROOMS: Record<DungeonSize, number> = { small: 5, medium: 8, large: 13 }

function estimate(type: EntityType, parts: Set<Part>, p: Prices, ctx: number, size: DungeonSize): number {
  const chat = (inT: number, outT: number) => inT * p.chat.in + outT * p.chat.out
  const img = imageCost(p)
  let c = 0
  if (type === 'dungeon') {
    const rooms = ROOMS[size]
    const encs = Math.ceil(rooms / 2)
    if (parts.has('text') || parts.has('rooms')) c += chat(ctx + 12000, 6000 + rooms * 1200)
    if (parts.has('creatures')) c += Math.ceil(encs / 3) * chat(ctx, 2500)
    if (parts.has('creatureArt')) c += Math.ceil(encs * 1.5) * img
    if (parts.has('map')) c += img
    if (parts.has('roomMaps')) c += encs * img
    if (parts.has('image')) c += img
    if (parts.has('roomImages')) c += rooms * img
    if (parts.has('links')) c += 4 * chat(ctx, 1500)
    return c
  }
  if (parts.has('text') || parts.has('stats') || parts.has('encounter')) c += chat(ctx + (parts.has('encounter') ? 8000 : 0), 3500)
  if (parts.has('creatures')) c += 0.5 * chat(ctx, 2500)
  if (parts.has('creatureArt')) c += 2 * img
  if (parts.has('map')) c += img
  if (parts.has('image')) c += img
  if (parts.has('links')) c += 2 * chat(ctx, 1500)
  return c
}

/**
 * "Generate with AI" — every part of an entry, each a checkbox (all on by default), run as one
 * background job with a live step list. Saves the result; everything is undoable.
 */
export function GeneratePanel({
  type,
  getDraft,
  existingId,
  onDone,
  onStart,
  context,
  compact,
}: {
  type: EntityType
  /** current (possibly unsaved) editor state */
  getDraft: () => Partial<Entity>
  existingId?: string
  onDone?: (entityId: string) => void
  /** called when a job starts (e.g. to lock the editor) */
  onStart?: () => void
  /** extra context for the AI (e.g. where a missing entry is referenced) */
  context?: string
  compact?: boolean
}) {
  const { campaign, entities } = useCampaign()
  const apiKey = useSettings((s) => s.settings.apiKey)
  const prices = usePrices()
  const available = useMemo(() => partsFor(type), [type])
  const [off, setOff] = useState<Set<Part>>(new Set())
  const [instructions, setInstructions] = useState('')
  const [size, setSize] = useState<DungeonSize>('medium')
  const [levelOverride, setLevelOverride] = useState<number | undefined>(undefined)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useGenJobs((s) => (jobId ? s.jobs[jobId] : undefined))
  const start = useGenJobs((s) => s.start)
  const stop = useGenJobs((s) => s.stop)
  const openDetail = useUI((s) => s.openDetail)

  useEffect(() => setOff(new Set()), [type])
  const parts = useMemo(() => new Set(available.filter((p) => !off.has(p))), [available, off])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inheritedLevel = useMemo(() => levelFor(getDraft(), entities, campaign), [entities, campaign, type])
  const cost = prices ? estimate(type, parts, prices, contextTokens(entities), size) : null

  // finished successfully → hand over
  useEffect(() => {
    if (job && !job.running && job.entityId && !job.error) onDone?.(job.entityId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.running])

  const run = () => {
    const draft = getDraft()
    onStart?.()
    setJobId(start(campaign.id, { type, id: existingId, draft: { ...draft, type } }, parts, { instructions: [instructions.trim(), context].filter(Boolean).join('\n') || undefined, size, level: levelOverride }))
  }

  if (job) {
    return (
      <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent">
          {job.running ? <Spinner className="size-4" /> : job.error ? <AlertTriangle className="size-4 text-danger" /> : <Check className="size-4 text-success" />}
          {job.running ? 'Generating…' : job.error ? job.error : 'Done'}
        </div>
        <ol className="space-y-1.5">
          {job.steps.map((s) => (
            <li key={s.id} className="flex gap-2 text-sm">
              <span className="mt-0.5 shrink-0">
                {s.status === 'running' ? (
                  <Spinner className="size-4" />
                ) : s.status === 'done' ? (
                  <Check className="size-4 text-success" />
                ) : s.status === 'error' ? (
                  <AlertTriangle className="size-4 text-danger" />
                ) : s.status === 'skipped' ? (
                  <Minus className="size-4 text-faint" />
                ) : (
                  <CircleDashed className="size-4 text-faint" />
                )}
              </span>
              <span className="min-w-0">
                <span className={cx(s.status === 'pending' || s.status === 'skipped' ? 'text-faint' : 'text-ink')}>{s.label}</span>
                {s.detail && <span className={cx('block truncate text-xs', s.status === 'error' ? 'text-danger' : 'text-muted')}>{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {job.running ? (
            <Button size="sm" variant="danger" icon={<Square className="size-4" />} onClick={() => stop(job.id)}>
              Stop
            </Button>
          ) : (
            <>
              {job.entityId && (
                <Button size="sm" variant="primary" onClick={() => openDetail({ kind: 'entity', id: job.entityId! })}>
                  Open result
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<Undo2 className="size-4" />}
                onClick={async () => {
                  await undoBatch(job.batchId)
                  setJobId(null)
                }}
              >
                Undo all
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setJobId(null)}>
                New run
              </Button>
            </>
          )}
        </div>
        {job.running && <p className="text-[11px] text-faint">You can close this dialog — generation continues in the background.</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-accent/25 bg-accent/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-accent">
        <Wand2 className="size-4" /> Generate with AI
      </div>
      <div className={cx('space-y-1.5', compact && 'sm:columns-2')}>
        {available.map((p) => (
          <label key={p} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
              checked={!off.has(p)}
              onChange={(e) =>
                setOff((o) => {
                  const n = new Set(o)
                  if (e.target.checked) n.delete(p)
                  else n.add(p)
                  return n
                })
              }
            />
            <span>{PART_LABEL[p]}</span>
          </label>
        ))}
      </div>
      {type === 'dungeon' && (
        <div className="flex items-center gap-2 text-sm text-muted">
          Size
          <Segmented
            size="sm"
            value={size}
            onChange={setSize}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
            ]}
          />
        </div>
      )}
      {LEVEL_TYPES.includes(type) && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Party level
          <input
            type="number"
            min={1}
            max={20}
            value={levelOverride ?? inheritedLevel}
            onChange={(e) => setLevelOverride(e.target.value === '' ? undefined : Number(e.target.value))}
            className="h-8 w-16 rounded-md border border-line bg-surface-2 px-2 text-center text-sm text-ink"
          />
          {levelOverride === undefined && <span className="text-xs text-faint">inherited</span>}
        </label>
      )}
      <Input
        placeholder={type === 'dungeon' ? 'Direction, e.g. “a drowned dwarven mine taken over by a fungus cult”' : 'Optional direction for the AI…'}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button variant="primary" icon={<Wand2 className="size-4" />} disabled={!apiKey || !parts.size} onClick={run}>
          Generate
        </Button>
        <span className="text-xs text-muted">{cost !== null && parts.size ? `≈ ${formatUsd(cost)}` : ''}</span>
      </div>
      {!apiKey && <p className="text-xs text-danger">Add your OpenRouter API key in Settings.</p>}
    </div>
  )
}
