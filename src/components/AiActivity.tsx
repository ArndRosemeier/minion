import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, Brain, Check, ChevronDown, Image as ImageIcon, Minimize2, Sparkles } from 'lucide-react'
import { useActivity, type AiStream } from '@/state/activity'
import { useSettings } from '@/state/settings'
import { Spinner, Toggle, cx } from './ui'

const shortModel = (id: string) => id.split('/').pop() ?? id

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** Scroll container that sticks to the bottom while text streams in (unless the user scrolled up). */
function AutoScroll({ text, className, children }: { text: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className={cx('overflow-y-auto', className)}
    >
      {children}
    </div>
  )
}

/** Live view of the model's thinking, for reuse (overlay and chat). */
export function ThinkingBlock({ text, defaultOpen = true, live }: { text: string; defaultOpen?: boolean; live?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (!text) return null
  return (
    <div className="rounded-lg border border-line bg-black/20">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-semibold tracking-wide text-faint uppercase">
        <Brain className={cx('size-3.5', live && 'animate-pulse text-info')} />
        Thinking
        <span className="font-normal normal-case">· {text.length.toLocaleString()} chars</span>
        <ChevronDown className={cx('ml-auto size-3.5 transition-transform', !open && '-rotate-90')} />
      </button>
      {open && (
        <AutoScroll text={text} className="max-h-40 px-2.5 pb-2">
          <div className="text-xs leading-relaxed whitespace-pre-wrap text-muted italic">{text}</div>
        </AutoScroll>
      )}
    </div>
  )
}

function StreamCard({ s, now }: { s: AiStream; now: number }) {
  const done = !!s.endedAt
  const secs = Math.round(((s.endedAt ?? now) - s.startedAt) / 1000)
  const isJson = /^\s*[[{]/.test(s.content)
  return (
    <div className={cx('space-y-2 rounded-xl border bg-surface-2 p-3 transition-opacity', done ? 'border-line opacity-70' : 'border-accent/30')}>
      <div className="flex items-center gap-2">
        {s.error ? (
          <AlertTriangle className="size-4 shrink-0 text-danger" />
        ) : done ? (
          <Check className="size-4 shrink-0 text-success" />
        ) : s.kind === 'image' ? (
          <ImageIcon className="size-4 shrink-0 animate-pulse text-accent" />
        ) : (
          <Spinner className="size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{s.label}</div>
          <div className="truncate text-[11px] text-faint">
            {shortModel(s.model)} · {secs}s{s.error ? ` · ${s.error}` : ''}
          </div>
        </div>
      </div>
      {s.kind === 'text' && <ThinkingBlock text={s.reasoning} defaultOpen={!s.content} live={!done && !s.content} />}
      {s.kind === 'image' ? (
        <div className="line-clamp-4 text-xs text-muted">{s.content}</div>
      ) : s.content ? (
        <AutoScroll text={s.content} className="max-h-56 rounded-lg bg-black/20 p-2.5">
          <div className={cx('text-xs leading-relaxed whitespace-pre-wrap text-ink', isJson && 'font-mono text-[11px]')}>{s.content}</div>
        </AutoScroll>
      ) : (
        !done && !s.reasoning && <div className="text-xs text-faint">Waiting for the first words…</div>
      )}
    </div>
  )
}

/** Floating, dismissible overlay with everything the AI is doing right now. */
export function AiActivity() {
  const streams = useActivity((s) => s.streams)
  const minimized = useActivity((s) => s.minimized)
  const pinnedOpen = useActivity((s) => s.pinnedOpen)
  const chatVisible = useActivity((s) => s.chatVisible)
  const setMinimized = useActivity((s) => s.setMinimized)
  const setPinnedOpen = useActivity((s) => s.setPinnedOpen)
  const autoShow = useSettings((s) => s.settings.showAiActivity !== false)
  const update = useSettings((s) => s.update)

  const visible = streams.filter((s) => !(s.source === 'chat' && chatVisible))
  const active = visible.filter((s) => !s.endedAt)
  const now = useNow(active.length > 0)

  useEffect(() => {
    if (!visible.length && pinnedOpen) setPinnedOpen(false)
  }, [visible.length, pinnedOpen, setPinnedOpen])

  if (!visible.length) return null
  // keep clear of the campaign sidebar
  const left = window.location.hash.startsWith('#/c/') ? 'left-[84px] lg:left-[220px]' : 'left-3'
  const open = (autoShow || pinnedOpen) && !minimized

  if (!open) {
    if (!active.length) return null
    return (
      <button
        onClick={() => {
          setMinimized(false)
          setPinnedOpen(true)
        }}
        className={cx(left, "anim-pop safe-bottom fixed bottom-3 z-[58] flex items-center gap-2 rounded-full border border-accent/40 bg-surface/95 px-3.5 py-2 text-sm text-ink shadow-xl shadow-black/50 backdrop-blur hover:bg-surface-2")}
      >
        <Spinner className="size-4" />
        AI working{active.length > 1 ? ` (${active.length})` : ''}
      </button>
    )
  }

  return (
    <div className={cx(left, "anim-slide safe-bottom fixed bottom-3 z-[58] flex max-h-[min(72vh,700px)] w-[min(540px,calc(100vw-24px))] flex-col rounded-2xl border border-line-strong bg-surface/95 shadow-2xl shadow-black/70 backdrop-blur")}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Sparkles className="size-4 text-accent" />
        <span className="flex-1 font-display text-sm">AI at work{active.length ? ` (${active.length})` : ''}</span>
        <div className="scale-90">
          <Toggle checked={autoShow} onChange={(v) => update({ showAiActivity: v })} label={<span className="text-xs text-muted">Auto-show</span>} />
        </div>
        <button
          title="Minimize"
          onClick={() => {
            setMinimized(true)
            setPinnedOpen(false)
          }}
          className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-ink"
        >
          <Minimize2 className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {[...visible].reverse().map((s) => (
          <StreamCard key={s.id} s={s} now={now} />
        ))}
      </div>
    </div>
  )
}
