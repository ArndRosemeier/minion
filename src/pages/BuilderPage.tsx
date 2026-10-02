import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { AlertTriangle, Check, CheckCircle2, CircleDashed, Hand, MessageSquare, PackageCheck, Pause, Play, RotateCcw, Sparkles, Undo2, Wand2, Zap } from 'lucide-react'
import { db } from '@/db/db'
import { undoBatch, updateCampaign } from '@/db/repo'
import { useCampaign } from '@/state/campaign'
import { SCOPES, STEPS, useBuilder, type StepStatus } from '@/state/builder'
import { useAgentRun } from '@/state/agentRun'
import { useSettings } from '@/state/settings'
import { LinkChip } from '@/components/Markdown'
import { Button, Card, Field, Input, LiveInput, Segmented, Select, Spinner, Textarea, cx } from '@/components/ui'
import type { AutomationMode } from '@/types'

const MODE_OPTIONS: { value: AutomationMode; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'assisted', label: 'Assisted' },
  { value: 'auto', label: 'Auto' },
]

export function BuilderPage() {
  const { campaign, entities, maps } = useCampaign()
  const nav = useNavigate()
  const run = useBuilder((s) => s.runs[campaign.id])
  const start = useBuilder((s) => s.start)
  const stop = useBuilder((s) => s.stop)
  const apiKey = useSettings((s) => s.settings.apiKey)
  const [threadId, setThreadId] = useState<string | null>(null)
  useEffect(() => {
    useBuilder.getState().threadId(campaign.id).then(setThreadId)
  }, [campaign.id])
  const agentRun = useAgentRun((s) => (threadId ? s.runs[threadId] : undefined))
  const cost = useLiveQuery(
    async () => (threadId ? (await db.messages.where('threadId').equals(threadId).toArray()).reduce((s, m) => s + (m.cost ?? 0), 0) : 0),
    [threadId],
  )

  const brief = campaign.brief ?? { scope: entities.some((e) => e.type === 'chapter') ? 'extend' : 'short', notes: '' }
  const [notes, setNotes] = useState(brief.notes)
  const [premise, setPremise] = useState(campaign.premise)
  useEffect(() => setPremise(campaign.premise), [campaign.premise])
  const setBrief = (p: Partial<typeof brief>) => updateCampaign(campaign.id, { brief: { ...brief, ...p } })
  const defaultToLevel = Math.min(20, campaign.partyLevel + ({ oneshot: 0, short: 1, arc: 3, extend: 2 } as Record<string, number>)[brief.scope ?? 'short'])
  const setMode = (step: string, mode: AutomationMode) => updateCampaign(campaign.id, { pipeline: { ...campaign.pipeline, [step]: mode } })
  const allMode = (mode: AutomationMode) => updateCampaign(campaign.id, { pipeline: Object.fromEntries(STEPS.map((s) => [s.id, mode])) })

  const running = !!run?.running
  const counts = {
    chapters: entities.filter((e) => e.type === 'chapter').length,
    npcs: entities.filter((e) => e.type === 'npc').length,
    locations: entities.filter((e) => e.type === 'location').length,
    encounters: entities.filter((e) => e.type === 'encounter').length,
    maps: maps.length,
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-5 p-5 pb-24 lg:px-8 xl:grid-cols-[440px_1fr] 2xl:grid-cols-[540px_1fr] xl:items-start xl:gap-8">
        {/* left: brief & controls (sticky on wide screens) */}
        <div className="space-y-5 xl:sticky xl:top-5">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl">
            <Wand2 className="size-6 text-accent" /> Module Builder
          </h1>
          <p className="text-sm text-muted">
            Choose per step: <b className="text-ink">Manual</b> (you do it), <b className="text-ink">Assisted</b> (AI does it, you review) or <b className="text-ink">Auto</b>. All on auto = one-click module.
          </p>
        </div>

        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What to build">
              <Select value={brief.scope} onChange={(e) => setBrief({ scope: e.target.value })} disabled={running}>
                <option value="oneshot">One-shot</option>
                <option value="short">Short adventure (3 chapters)</option>
                <option value="arc">Campaign arc (5–7 chapters)</option>
                <option value="extend">Extend the existing campaign</option>
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Party level">
                <LiveInput type="number" min={1} max={20} value={campaign.partyLevel} onCommit={(v) => updateCampaign(campaign.id, { partyLevel: Number(v) || 1 })} />
              </Field>
              <Field label="Party size">
                <LiveInput type="number" min={1} max={8} value={campaign.partySize} onCommit={(v) => updateCampaign(campaign.id, { partySize: Number(v) || 4 })} />
              </Field>
              <Field label="Level at the end" hint="The AI plans which chapter is played at which level.">
                <LiveInput
                  type="number"
                  min={1}
                  max={20}
                  placeholder={String(defaultToLevel)}
                  value={brief.toLevel ?? ''}
                  onCommit={(v) => setBrief({ toLevel: v === '' ? undefined : Math.max(campaign.partyLevel, Number(v) || campaign.partyLevel) })}
                />
              </Field>
            </div>
          </div>
          <p className="-mt-2 text-xs text-faint">{SCOPES[brief.scope]}</p>
          <Field label="Premise" hint="Leave empty and the AI invents one.">
            <Textarea minRows={2} value={premise} onChange={(e) => setPremise(e.target.value)} onBlur={() => premise !== campaign.premise && updateCampaign(campaign.id, { premise })} />
          </Field>
          <Field label="Wishes & constraints">
            <Textarea
              minRows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== brief.notes && setBrief({ notes })}
              placeholder="e.g. lots of investigation, a heist in the middle, no undead, a recurring rival party…"
            />
          </Field>
          <div className="flex flex-wrap gap-2 text-xs text-muted">
            <span>{counts.chapters} chapters</span>·<span>{counts.locations} locations</span>·<span>{counts.npcs} NPCs</span>·<span>{counts.encounters} encounters</span>·<span>{counts.maps} maps</span>
            {cost ? <span className="ml-auto">AI cost so far: ${cost.toFixed(2)}</span> : null}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="danger" icon={<Pause className="size-4" />} onClick={() => stop(campaign.id)}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="primary" size="lg" icon={<Play className="size-5" />} disabled={!apiKey} onClick={() => start(campaign)}>
                Run pipeline
              </Button>
              <Button size="lg" icon={<Zap className="size-5" />} disabled={!apiKey} onClick={() => start(campaign, { allAuto: true })}>
                One-click module
              </Button>
            </>
          )}
          <div className="flex-1" />
          <span className="text-xs text-faint">Set all:</span>
          <Segmented size="sm" value={'' as AutomationMode} onChange={allMode} options={MODE_OPTIONS} />
        </div>
        {!apiKey && <p className="text-sm text-danger">Add your OpenRouter API key in Settings to use the builder.</p>}
        {run?.error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {run.error}
          </div>
        )}
        </div>

        {/* right: pipeline steps */}
        <div className="space-y-5">
        <div className="columns-[34rem] gap-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
          {STEPS.map((step, i) => {
            const mode = campaign.pipeline[step.id] ?? step.defaultMode
            const status: StepStatus = run?.status[step.id] ?? (campaign.pipelineDone?.[step.id] ? 'done' : 'idle')
            const isRunning = status === 'running'
            return (
              <div
                key={step.id}
                className={cx(
                  'rounded-xl border bg-surface transition-colors',
                  isRunning ? 'border-accent/60' : status === 'review' ? 'border-info/60' : 'border-line',
                )}
              >
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <StatusIcon status={status} n={i + 1} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{step.title}</div>
                    <div className="text-xs text-muted">{isRunning && run?.progress ? run.progress : step.description}</div>
                  </div>
                  <Segmented size="sm" value={mode} onChange={(m) => setMode(step.id, m)} options={MODE_OPTIONS} />
                  {!running && (
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} disabled={!apiKey} onClick={() => start(campaign, { only: step.id })}>
                      Run
                    </Button>
                  )}
                </div>
                {isRunning && agentRun && (
                  <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs text-muted">
                    <Spinner className="size-3.5" /> {agentRun.progress || 'Writing…'}
                  </div>
                )}
                {status === 'manual' && (
                  <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-xs text-muted">
                    <Hand className="size-3.5" /> Manual step — create this content yourself in the Library or Chat.
                  </div>
                )}
                {status === 'review' && <ReviewBox stepId={step.id} batches={run?.batches[step.id] ?? []} />}
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="ghost" icon={<PackageCheck className="size-4" />} onClick={() => nav(`/c/${campaign.id}/fill`)}>
            Fill what’s missing (images, maps, stats…)
          </Button>
          <Button variant="ghost" icon={<MessageSquare className="size-4" />} onClick={() => nav(`/c/${campaign.id}/chat`)}>
            See the builder’s conversation in Chat → “Module Builder”
          </Button>
        </div>
        </div>
      </div>
    </div>
  )
}

function StatusIcon({ status, n }: { status: StepStatus; n: number }) {
  if (status === 'running') return <Spinner className="size-6" />
  if (status === 'done') return <CheckCircle2 className="size-6 text-success" />
  if (status === 'review') return <Sparkles className="size-6 text-info" />
  if (status === 'error') return <AlertTriangle className="size-6 text-danger" />
  if (status === 'manual') return <Hand className="size-6 text-faint" />
  return (
    <span className="relative flex size-6 items-center justify-center">
      <CircleDashed className="absolute size-6 text-faint" />
      <span className="text-[10px] font-bold text-faint">{n}</span>
    </span>
  )
}

function ReviewBox({ stepId, batches }: { stepId: string; batches: string[] }) {
  const { campaign } = useCampaign()
  const decide = useBuilder((s) => s.decide)
  const feedback = useBuilder((s) => s.feedback)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const changes = useLiveQuery(() => db.changes.where('batchId').anyOf(batches).toArray(), [batches.join(',')])
  const created = (changes ?? []).filter((c) => c.table === 'entities' && c.before === undefined && !c.undone)
  const edited = (changes ?? []).filter((c) => !(c.table === 'entities' && c.before === undefined))
  return (
    <div className="space-y-3 border-t border-line px-4 py-3">
      <div className="text-sm text-muted">
        Review: {created.length} new, {edited.length} other changes. Tap to inspect.
      </div>
      {created.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {created.map((c) => (
            <LinkChip key={c.id} target={`id:${c.recordId}`}>
              {(c.after as { name?: string })?.name ?? 'entry'}
            </LinkChip>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Feedback, e.g. “make the villain more sympathetic”" />
        <Button
          loading={busy}
          disabled={!text.trim()}
          onClick={async () => {
            setBusy(true)
            await feedback(campaign.id, stepId, text)
            setText('')
            setBusy(false)
          }}
        >
          Revise
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Check className="size-4" />} onClick={() => decide(campaign.id, 'continue')}>
          Looks good — continue
        </Button>
        <Button
          variant="ghost"
          icon={<Undo2 className="size-4" />}
          onClick={async () => {
            for (const b of [...batches].reverse()) await undoBatch(b)
            decide(campaign.id, 'stop')
          }}
        >
          Undo step & stop
        </Button>
        <Button variant="ghost" onClick={() => decide(campaign.id, 'stop')}>
          Stop here
        </Button>
      </div>
    </div>
  )
}
