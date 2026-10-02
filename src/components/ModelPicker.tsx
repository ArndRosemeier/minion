import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, Clock, Image as ImageIcon, Search, Wrench } from 'lucide-react'
import { isImageModel, listModels, supportsTools, type ORModel } from '@/ai/openrouter'
import { recentModels, useSettings } from '@/state/settings'
import { Button, Input, Modal, Spinner, cx } from './ui'

const price = (p?: string) => {
  const n = Number(p)
  if (!n) return 'free'
  return `$${(n * 1_000_000).toFixed(n * 1e6 < 1 ? 2 : 1)}`
}

/** "anthropic/claude-sonnet-5.5" or "Anthropic: Claude Sonnet 5.5" -> "Claude Sonnet 5.5" */
export function shortModelName(id: string, models?: ORModel[] | null): string {
  const m = models?.find((x) => x.id === id)
  if (m) return m.name.replace(/^[^:]+:\s*/, '')
  return id.split('/').pop() ?? id
}

export function useModels() {
  const [models, setModels] = useState<ORModel[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    listModels()
      .then(setModels)
      .catch((e) => setErr(e.message))
  }, [])
  return { models, err }
}

export function ModelPicker({
  value,
  onChange,
  kind,
  allowEmpty,
  trigger,
  title,
}: {
  value: string
  onChange: (id: string) => void
  kind: 'chat' | 'image'
  allowEmpty?: string
  /** custom trigger instead of the default select-like button */
  trigger?: (open: () => void) => ReactNode
  title?: string
}) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ORModel[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const settings = useSettings((s) => s.settings)
  const remember = useSettings((s) => s.rememberModel)
  const recent = recentModels(settings)[kind]

  useEffect(() => {
    if (!open || models) return
    listModels()
      .then(setModels)
      .catch((e) => setErr(e.message))
  }, [open, models])
  useEffect(() => {
    if (open) setQ('')
  }, [open])

  const { recentList, rest } = useMemo(() => {
    if (!models) return { recentList: [], rest: [] }
    const s = q.toLowerCase()
    const fits = (m: ORModel) => (kind === 'image' ? isImageModel(m) : !isImageModel(m) || supportsTools(m))
    const matches = (m: ORModel) => !s || m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s)
    const byId = new Map(models.map((m) => [m.id, m]))
    const recentList = recent.map((id) => byId.get(id)).filter((m): m is ORModel => !!m && fits(m) && matches(m))
    const recentIds = new Set(recentList.map((m) => m.id))
    const rest = models.filter((m) => fits(m) && matches(m) && !recentIds.has(m.id)).slice(0, 200)
    return { recentList, rest }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, q, kind, recent.join('|')])

  const pick = (id: string) => {
    onChange(id)
    remember(kind, id)
    setOpen(false)
  }

  const row = (m: ORModel) => (
    <button
      key={m.id}
      onClick={() => pick(m.id)}
      className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-3', m.id === value && 'bg-accent/10')}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{m.name}</div>
        <div className="truncate text-xs text-faint">{m.id}</div>
      </div>
      {supportsTools(m) && <Wrench className="size-3.5 text-faint" aria-label="tools" />}
      {isImageModel(m) && <ImageIcon className="size-3.5 text-faint" aria-label="image output" />}
      <div className="w-24 text-right text-[11px] text-muted">
        {price(m.pricing.prompt)} / {price(m.pricing.completion)}
        <div className="text-faint">per M tok</div>
      </div>
    </button>
  )

  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true))
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-left text-sm hover:border-line-strong"
        >
          <span className={cx('min-w-0 flex-1 truncate', !value && 'text-faint')}>{value || allowEmpty || 'Choose a model'}</span>
          <ChevronDown className="size-4 text-faint" />
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={title ?? (kind === 'image' ? 'Choose image model' : 'Choose model')}>
        <div className="flex h-[65vh] flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input autoFocus className="pl-9" placeholder="Search models (e.g. claude, gemini, gpt)…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {allowEmpty && (
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              {allowEmpty}
            </Button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {err && <div className="p-4 text-sm text-danger">Could not load models: {err}</div>}
            {!models && !err && (
              <div className="flex justify-center p-8">
                <Spinner />
              </div>
            )}
            {recentList.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-3 pt-1 pb-1 text-[10px] font-bold tracking-widest text-faint uppercase">
                  <Clock className="size-3" /> Recent
                </div>
                {recentList.map(row)}
                <div className="mx-3 my-2 border-t border-line" />
                <div className="px-3 pb-1 text-[10px] font-bold tracking-widest text-faint uppercase">All models</div>
              </>
            )}
            {rest.map(row)}
          </div>
          {kind === 'chat' && <p className="text-xs text-faint">The campaign chat needs a model with tool support (🔧).</p>}
        </div>
      </Modal>
    </>
  )
}
