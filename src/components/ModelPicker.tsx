import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Image as ImageIcon, Search, Wrench } from 'lucide-react'
import { isImageModel, listModels, supportsTools, type ORModel } from '@/ai/openrouter'
import { Button, Input, Modal, Spinner, cx } from './ui'

const price = (p?: string) => {
  const n = Number(p)
  if (!n) return 'free'
  return `$${(n * 1_000_000).toFixed(n * 1e6 < 1 ? 2 : 1)}`
}

export function ModelPicker({
  value,
  onChange,
  kind,
  allowEmpty,
}: {
  value: string
  onChange: (id: string) => void
  kind: 'chat' | 'image'
  allowEmpty?: string
}) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ORModel[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open || models) return
    listModels()
      .then(setModels)
      .catch((e) => setErr(e.message))
  }, [open, models])

  const filtered = useMemo(() => {
    if (!models) return []
    const s = q.toLowerCase()
    return models
      .filter((m) => (kind === 'image' ? isImageModel(m) : !isImageModel(m) || supportsTools(m)))
      .filter((m) => !s || m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s))
      .slice(0, 200)
  }, [models, q, kind])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-left text-sm hover:border-line-strong"
      >
        <span className={cx('min-w-0 flex-1 truncate', !value && 'text-faint')}>{value || allowEmpty || 'Choose a model'}</span>
        <ChevronDown className="size-4 text-faint" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={kind === 'image' ? 'Choose image model' : 'Choose model'}>
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
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  onChange(m.id)
                  setOpen(false)
                }}
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
            ))}
          </div>
          {kind === 'chat' && <p className="text-xs text-faint">The campaign chat needs a model with tool support (🔧).</p>}
        </div>
      </Modal>
    </>
  )
}
