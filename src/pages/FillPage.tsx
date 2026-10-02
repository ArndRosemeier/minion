import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, PackageCheck, Pause, Play, Undo2 } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useSettings } from '@/state/settings'
import { useFill } from '@/state/fill'
import { listModels, type ORModel } from '@/ai/openrouter'
import { computeGaps, contextTokens, estimateCost, formatUsd, type GapCategory, type Prices } from '@/lib/gaps'
import { Button, Card, ConfirmModal, Empty, Spinner, cx } from '@/components/ui'

interface Sel {
  on: boolean
  excluded: Set<string>
}

function usePrices(): Prices | null {
  const { chatModel, fastModel, imageModel } = useSettings((s) => s.settings)
  const [models, setModels] = useState<ORModel[] | null>(null)
  useEffect(() => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]))
  }, [])
  return useMemo(() => {
    if (!models) return null
    const p = (id: string) => models.find((m) => m.id === id)?.pricing
    const num = (v?: string) => Math.max(0, Number(v) || 0)
    const chat = p(chatModel)
    const fast = p(fastModel)
    const img = p(imageModel)
    return {
      chat: { in: num(chat?.prompt), out: num(chat?.completion) },
      fast: { in: num(fast?.prompt), out: num(fast?.completion) },
      image: { in: num(img?.prompt), out: num(img?.completion), imageOut: num((img as { image_output?: string } | undefined)?.image_output) },
    }
  }, [models, chatModel, fastModel, imageModel])
}

export function FillPage() {
  const { campaign, entities, maps, index, compendiumVersion } = useCampaign()
  const apiKey = useSettings((s) => s.settings.apiKey)
  const prices = usePrices()
  const run = useFill((s) => s.runs[campaign.id])
  const start = useFill((s) => s.run)
  const stop = useFill((s) => s.stop)
  const undo = useFill((s) => s.undo)
  const [sel, setSel] = useState<Record<string, Sel>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [confirmUndo, setConfirmUndo] = useState(false)

  const gaps = useMemo(
    () => computeGaps(campaign, entities, maps, index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaign, entities, maps, index, compendiumVersion],
  )
  const ctxTok = useMemo(() => contextTokens(entities), [entities])

  const selOf = (c: GapCategory): Sel => sel[c.id] ?? { on: c.defaultOn, excluded: new Set() }
  const chosen = (c: GapCategory) => {
    const s = selOf(c)
    return s.on ? c.items.filter((i) => !s.excluded.has(i.id)).map((i) => i.id) : []
  }
  const update = (c: GapCategory, fn: (s: Sel) => Sel) => setSel((all) => ({ ...all, [c.id]: fn(selOf(c)) }))

  const withItems = gaps.filter((g) => g.items.length)
  const complete = gaps.filter((g) => !g.items.length)
  const total = withItems.reduce((s, c) => s + chosen(c).length, 0)
  const cost = prices ? withItems.reduce((s, c) => s + estimateCost(c, chosen(c).length, prices, ctxTok), 0) : null
  const running = !!run?.running

  const go = () =>
    start(
      campaign,
      withItems.map((cat) => ({ cat, ids: chosen(cat) })),
    )

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-6 p-5 pb-24 lg:px-8 xl:grid-cols-[1fr_380px] xl:items-start">
        <div className="space-y-5">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl">
              <PackageCheck className="size-6 text-accent" /> Fill gaps
            </h1>
            <p className="text-sm text-muted">Everything that is still missing in “{campaign.name}”. Pick what to generate — the list updates live as gaps get filled.</p>
          </div>

          {withItems.length === 0 ? (
            <Empty icon={<CheckCircle2 />} title="Nothing missing">
              Every entry has an image and summary, all links resolve, encounters have maps and stat blocks.
            </Empty>
          ) : (
            <div className="columns-[30rem] gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
              {withItems.map((c) => {
                const s = selOf(c)
                const n = chosen(c).length
                const isOpen = !!open[c.id]
                return (
                  <Card key={c.id} className={cx('overflow-hidden', s.on && n > 0 && 'border-accent/40')}>
                    <div className="flex items-start gap-3 p-4">
                      <input
                        type="checkbox"
                        className="mt-1 size-5 shrink-0 accent-[var(--color-accent)]"
                        checked={s.on && n > 0}
                        disabled={running}
                        onChange={(e) => update(c, (x) => ({ on: e.target.checked, excluded: e.target.checked && n === 0 ? new Set() : x.excluded }))}
                      />
                      <button className="min-w-0 flex-1 text-left" onClick={() => setOpen({ ...open, [c.id]: !isOpen })}>
                        <div className="flex items-center gap-2 font-medium">
                          {c.title}
                          <span className="rounded-full bg-surface-3 px-2 text-xs text-muted">
                            {s.on ? `${n}/${c.items.length}` : c.items.length}
                          </span>
                        </div>
                        <div className="text-xs text-muted">{c.description}</div>
                      </button>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-accent">{prices && s.on && n ? `≈ ${formatUsd(estimateCost(c, n, prices, ctxTok))}` : ''}</div>
                        <button className="text-faint hover:text-ink" onClick={() => setOpen({ ...open, [c.id]: !isOpen })} aria-label="Show items">
                          {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="border-t border-line bg-surface-2/50">
                        <div className="flex gap-3 px-4 py-2 text-xs">
                          <button className="text-accent hover:underline" onClick={() => update(c, () => ({ on: true, excluded: new Set() }))}>
                            Select all
                          </button>
                          <button className="text-muted hover:underline" onClick={() => update(c, () => ({ on: true, excluded: new Set(c.items.map((i) => i.id)) }))}>
                            Select none
                          </button>
                        </div>
                        <div className="max-h-72 overflow-y-auto px-2 pb-2">
                          {c.items.map((item) => {
                            const checked = s.on && !s.excluded.has(item.id)
                            return (
                              <label key={item.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-3">
                                <input
                                  type="checkbox"
                                  className="size-4 accent-[var(--color-accent)]"
                                  checked={checked}
                                  disabled={running}
                                  onChange={() =>
                                    update(c, (x) => {
                                      const excluded = new Set(x.on ? x.excluded : c.items.map((i) => i.id))
                                      if (checked) excluded.add(item.id)
                                      else excluded.delete(item.id)
                                      return { on: true, excluded }
                                    })
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                                {item.sub && <span className="max-w-[45%] truncate text-xs text-faint">{item.sub}</span>}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}

          {complete.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
              <span className="font-semibold">Complete:</span>
              {complete.map((c) => (
                <span key={c.id} className="flex items-center gap-1">
                  <CheckCircle2 className="size-3 text-success" /> {c.title.replace(/ without.*| not written out| without a battle map/, '')}
                </span>
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-5">
          <Card className="space-y-4 p-5">
            <div>
              <div className="text-xs font-semibold tracking-wide text-muted uppercase">Selected</div>
              <div className="font-display text-3xl">{total} item{total === 1 ? '' : 's'}</div>
              <div className="text-sm text-muted">
                {cost === null ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner className="size-3.5" /> loading prices…
                  </span>
                ) : (
                  <>
                    Estimated cost <b className="text-accent">≈ {formatUsd(cost)}</b>
                  </>
                )}
              </div>
              <p className="mt-1 text-[11px] text-faint">Rough estimate from current OpenRouter prices for your chosen models; text steps scale with campaign size.</p>
            </div>
            {running ? (
              <Button variant="danger" className="w-full" icon={<Pause className="size-4" />} onClick={() => stop(campaign.id)}>
                Stop
              </Button>
            ) : (
              <Button variant="primary" size="lg" className="w-full" icon={<Play className="size-5" />} disabled={!apiKey || !total} onClick={go}>
                Generate {total} item{total === 1 ? '' : 's'}
              </Button>
            )}
            {!apiKey && <p className="text-sm text-danger">Add your OpenRouter API key in Settings first.</p>}
          </Card>

          {run && (
            <Card className="space-y-3 p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{running ? 'Working…' : run.undone ? 'Undone' : 'Last run'}</span>
                <span className="text-muted tabular-nums">
                  {run.done}/{run.total}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-accent transition-all" style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                {running && <Spinner className="size-3.5" />}
                <span className="truncate">{run.progress}</span>
              </div>
              {run.errors.length > 0 && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
                  {run.errors.map((e, i) => (
                    <div key={i} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {e}
                    </div>
                  ))}
                </div>
              )}
              {!running && !run.undone && run.done > 0 && (
                <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setConfirmUndo(true)}>
                  Undo this run
                </Button>
              )}
              {!running && run.batches.length > 1 && (
                <p className="text-[11px] text-faint">
                  Text steps ran in the “Module Builder” chat thread — open it in Chat to see what the AI did.
                </p>
              )}
            </Card>
          )}
        </aside>
      </div>
      <ConfirmModal
        open={confirmUndo}
        onClose={() => setConfirmUndo(false)}
        title="Undo this run?"
        text="Everything this run created or changed is reverted (generated images stay in storage until you clean up unused images)."
        confirmLabel="Undo"
        onConfirm={() => undo(campaign.id)}
      />
    </div>
  )
}
