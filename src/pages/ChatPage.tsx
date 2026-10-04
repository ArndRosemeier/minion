import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eraser,
  MessagesSquare,
  PanelLeft,
  Pencil,
  Plus,
  Send,
  Square,
  Trash2,
  Undo2,
  Users,
  Wrench,
} from 'lucide-react'
import { db } from '@/db/db'
import { undoBatch } from '@/db/repo'
import { newId } from '@/lib/id'
import { useCampaign } from '@/state/campaign'
import { useAgentRun } from '@/state/agentRun'
import { useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { toolLabel } from '@/ai/agent'
import { Markdown, LinkChip } from '@/components/Markdown'
import { ThinkingBlock } from '@/components/AiActivity'
import { useActivity } from '@/state/activity'
import { Button, ConfirmModal, IconButton, Modal, Spinner, Textarea, Toggle, cx } from '@/components/ui'
import type { ChatMessage, ChatThread } from '@/types'

const SUGGESTIONS = [
  'Invent a premise and outline a short adventure (3 chapters) for my party.',
  'Create the main villain with motives, secrets and a stat block.',
  'Review the campaign: find unresolved links, plot holes and missing stat blocks, and fix them.',
  'Write the next session: a social scene, an exploration scene and a combat encounter.',
]

const lsKey = (cid: string) => `minion.thread.${cid}`

export function ChatPage() {
  const { campaign } = useCampaign()
  const threads = useLiveQuery(() => db.threads.where('campaignId').equals(campaign.id).reverse().sortBy('updatedAt'), [campaign.id])
  const [threadId, setThreadId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(lsKey(campaign.id))
    } catch {
      return null
    }
  })
  const [showThreads, setShowThreads] = useState(false)
  const [delThread, setDelThread] = useState<ChatThread | null>(null)

  const newThread = async () => {
    const t: ChatThread = { id: newId('th'), campaignId: campaign.id, title: 'New chat', createdAt: Date.now(), updatedAt: Date.now() }
    await db.threads.add(t)
    setThreadId(t.id)
    setShowThreads(false)
  }

  const creating = useRef(false)
  useEffect(() => {
    if (!threads) return
    if (!threads.length) {
      if (!creating.current) {
        creating.current = true
        newThread().finally(() => (creating.current = false))
      }
      return
    }
    if (!threadId || !threads.some((t) => t.id === threadId)) setThreadId(threads[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads])

  useEffect(() => {
    try {
      if (threadId) localStorage.setItem(lsKey(campaign.id), threadId)
    } catch {
      /* ignore */
    }
  }, [threadId, campaign.id])

  return (
    <div className="flex h-full">
      <aside
        className={cx(
          'absolute inset-y-0 left-0 z-20 w-72 flex-col border-r border-line bg-surface md:static md:flex md:w-64',
          showThreads ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center gap-2 border-b border-line p-3">
          <Button className="flex-1" icon={<Plus className="size-4" />} onClick={newThread}>
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {threads?.map((t) => (
            <div
              key={t.id}
              className={cx('group flex items-center rounded-lg', t.id === threadId ? 'bg-surface-3 text-ink' : 'text-muted hover:bg-surface-2')}
            >
              <button
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
                onClick={() => {
                  setThreadId(t.id)
                  setShowThreads(false)
                }}
              >
                {t.title}
              </button>
              <IconButton size="sm" label="Delete chat" icon={<Trash2 />} className="opacity-0 group-hover:opacity-100" onClick={() => setDelThread(t)} />
            </div>
          ))}
        </div>
      </aside>
      {showThreads && <div className="absolute inset-0 z-10 bg-black/40 md:hidden" onClick={() => setShowThreads(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {threadId && <ThreadView key={threadId} threadId={threadId} onToggleThreads={() => setShowThreads(!showThreads)} />}
      </div>
      <ConfirmModal
        open={!!delThread}
        onClose={() => setDelThread(null)}
        title="Delete this chat?"
        text="Only the conversation is deleted. Campaign content stays."
        danger
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!delThread) return
          await db.messages.where('threadId').equals(delThread.id).delete()
          await db.threads.delete(delThread.id)
        }}
      />
    </div>
  )
}

function ThreadView({ threadId, onToggleThreads }: { threadId: string; onToggleThreads: () => void }) {
  const { campaign } = useCampaign()
  const messages = useLiveQuery(() => db.messages.where('threadId').equals(threadId).sortBy('createdAt'), [threadId])
  const run = useAgentRun((s) => s.runs[threadId])
  const send = useAgentRun((s) => s.send)
  const advise = useAgentRun((s) => s.advise)
  const stop = useAgentRun((s) => s.stop)
  const chatModel = useSettings((s) => s.settings.chatModel)
  const apiKey = useSettings((s) => s.settings.apiKey)
  const draft = useUI((s) => s.chatDraft)
  const setDraft = useUI((s) => s.setChatDraft)
  const [text, setText] = useState('')
  const [advOpen, setAdvOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const showThinking = useSettings((s) => s.settings.showAiActivity !== false)
  const setChatVisible = useActivity((s) => s.setChatVisible)
  useEffect(() => {
    setChatVisible(true)
    return () => setChatVisible(false)
  }, [setChatVisible])

  useEffect(() => {
    if (draft) {
      setText((t) => (t ? `${t}\n${draft}` : draft))
      setDraft('')
    }
  }, [draft, setDraft])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages, run?.stream, run?.progress, run?.reasoning])

  const submit = async () => {
    const t = text.trim()
    if (!t || run) return
    setText('')
    stick.current = true
    await send(campaign.id, threadId, t)
  }

  const cost = useMemo(() => (messages ?? []).reduce((s, m) => s + (m.cost ?? 0), 0), [messages])
  const turns = useMemo(() => groupTurns(messages ?? []), [messages])

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <IconButton label="Chats" icon={<PanelLeft />} onClick={onToggleThreads} className="md:hidden" />
        <MessagesSquare className="hidden size-5 text-accent md:block" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-sm">Campaign chat</div>
          <div className="truncate text-[11px] text-faint">
            {chatModel}
            {cost > 0 && ` · $${cost.toFixed(3)} this chat`}
          </div>
        </div>
        {!!messages?.length && <IconButton label="Clear chat" icon={<Eraser />} onClick={() => setConfirmClear(true)} disabled={!!run} />}
      </div>
      <ConfirmModal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear this chat?"
        text="All messages in this chat are removed and the AI starts fresh. Campaign content and its undo history stay."
        danger
        confirmLabel="Clear"
        onConfirm={() => db.messages.where('threadId').equals(threadId).delete()}
      />

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
          {messages && messages.length === 0 && (
            <div className="space-y-5 py-8 text-center">
              <div className="font-display text-2xl">What shall we create?</div>
              <p className="mx-auto max-w-lg text-sm text-muted">
                This chat can read and change everything in “{campaign.name}”. Ask for chapters, NPCs, encounters, maps or a review — every change can be undone.
              </p>
              {!apiKey && <p className="text-sm text-danger">Add your OpenRouter API key in Settings first.</p>}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => setText(s)} className="rounded-xl border border-line bg-surface p-3 text-left text-sm text-muted hover:border-accent/50 hover:text-ink">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t) => (
            <Turn key={t.key} turn={t} />
          ))}
          {run && (
            <div className="space-y-2">
              {showThinking && <ThinkingBlock text={run.reasoning} defaultOpen={!run.stream} live={!run.stream} />}
              {run.stream && <Markdown text={run.stream} />}
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner className="size-4" />
                {run.progress || (run.stream ? 'Writing…' : 'Thinking…')}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="safe-bottom shrink-0 border-t border-line bg-surface/70 p-3">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface-2 p-2 focus-within:border-accent/60">
            <Textarea
              minRows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="Ask, plan, create, change… (use [[Name]] to reference entries)"
              className="max-h-60 border-0 bg-transparent focus:ring-0"
            />
            <Button
              size="sm"
              icon={<Users className="size-4" />}
              onClick={() => setAdvOpen(true)}
              disabled={!!run}
              title="Ask the advisors to read along and comment"
              className="shrink-0 border-[#4a3d5c] bg-[#221d2a] text-[#cdb8f0] hover:bg-[#2c2536]"
            >
              Advisors
            </Button>
            {run ? (
              <IconButton label="Stop" variant="danger" icon={<Square />} onClick={() => stop(threadId)} />
            ) : (
              <IconButton label="Send" variant="primary" icon={<Send />} onClick={submit} disabled={!text.trim()} />
            )}
          </div>
        </div>
      </div>
      <AdvisorModal
        open={advOpen}
        onClose={() => setAdvOpen(false)}
        initial={text}
        onAsk={(q, advisors) => {
          setText('')
          stick.current = true
          advise(campaign.id, threadId, q, advisors)
        }}
      />
    </>
  )
}

interface TurnGroup {
  key: string
  user?: ChatMessage
  items: ChatMessage[]
  batch?: string
}

function groupTurns(messages: ChatMessage[]): TurnGroup[] {
  const out: TurnGroup[] = []
  let cur: TurnGroup | null = null
  for (const m of messages) {
    if (m.role === 'user') {
      cur = { key: m.id, user: m, items: [] }
      out.push(cur)
      continue
    }
    if (!cur) {
      cur = { key: m.id, items: [] }
      out.push(cur)
    }
    if (m.viaTool) continue
    cur.items.push(m)
    if (m.changeBatch) cur.batch = m.changeBatch
  }
  return out
}

function Turn({ turn }: { turn: TurnGroup }) {
  const toolResults = useMemo(() => {
    const map = new Map<string, ChatMessage>()
    turn.items.forEach((m) => m.role === 'tool' && m.toolCallId && map.set(m.toolCallId, m))
    return map
  }, [turn.items])
  return (
    <div className="space-y-3">
      {turn.user && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent/15 px-4 py-2.5 text-ink">
            <Markdown text={turn.user.content} className="text-[15px]" autoLink={false} />
          </div>
        </div>
      )}
      {turn.items.map((m) => {
        if (m.role === 'tool') return null
        if (m.role === 'advisor') return <AdvisorBubble key={m.id} m={m} />
        return (
          <div key={m.id} className="space-y-2">
            {m.error && (
              <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {m.error}
              </div>
            )}
            {m.content && <Markdown text={m.content} />}
            {m.toolCalls?.map((tc) => <ToolRow key={tc.id} name={tc.name} args={tc.arguments} result={toolResults.get(tc.id)?.content} />)}
          </div>
        )
      })}
      {turn.batch && <ChangesBar batchId={turn.batch} />}
    </div>
  )
}

function ToolRow({ name, args, result }: { name: string; args: string; result?: string }) {
  const [open, setOpen] = useState(false)
  const failed = result?.startsWith('{"error"')
  return (
    <div className="text-xs">
      <button onClick={() => setOpen(!open)} className={cx('flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-2', failed ? 'text-danger' : 'text-faint')}>
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Wrench className="size-3.5" />
        {toolLabel(name, args)}
        {!result && <Spinner className="size-3" />}
      </button>
      {open && (
        <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] whitespace-pre-wrap text-muted">
          {args}
          {result && `\n\n→ ${result.slice(0, 3000)}`}
        </pre>
      )}
    </div>
  )
}

/** advisor comment as it reaches the writer */
const forwardText = (advisor: string | undefined, text: string) => `[Advisor “${advisor}” comments — forwarded by the GM:]\n${text.trim()}`

function AdvisorBubble({ m }: { m: ChatMessage }) {
  const busy = useAgentRun((s) => !!s.runs[m.threadId])
  const send = useAgentRun((s) => s.send)
  const setDraft = useUI((s) => s.setChatDraft)
  const [editing, setEditing] = useState<string | null>(null)
  const canForward = !m.error && !!m.content && !m.viaTool

  const forward = async (text: string) => {
    await db.messages.update(m.id, { forwarded: true })
    setEditing(null)
    await send(m.campaignId, m.threadId, forwardText(m.advisor, text))
  }

  return (
    <div className="rounded-2xl border border-[#4a3d5c] bg-[#221d2a] px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-[#cdb8f0]">
        {m.advisor}
        <span className="text-[11px] font-normal text-faint">{m.model}</span>
        <div className="flex-1" />
        {m.forwarded && <span className="text-[11px] font-normal text-success">✓ sent to writer</span>}
      </div>
      {m.error ? (
        <div className="text-sm text-danger">{m.error}</div>
      ) : editing !== null ? (
        <div className="space-y-2">
          <Textarea minRows={4} value={editing} onChange={(e) => setEditing(e.target.value)} className="text-[15px]" autoFocus />
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} disabled={!editing.trim()} onClick={() => (setDraft(forwardText(m.advisor, editing)), setEditing(null))}>
              Add to my message
            </Button>
            <Button size="sm" variant="primary" icon={<Send className="size-4" />} disabled={!editing.trim() || busy} onClick={() => forward(editing)}>
              Send to writer
            </Button>
          </div>
        </div>
      ) : (
        <Markdown text={m.content} className="text-[15px]" />
      )}
      {canForward && editing === null && (
        <div className="mt-2 flex justify-end border-t border-[#4a3d5c] pt-2">
          <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(m.content)}>
            {m.forwarded ? 'Edit & send again' : 'Edit & send to writer'}
          </Button>
        </div>
      )}
    </div>
  )
}

function ChangesBar({ batchId }: { batchId: string }) {
  const changes = useLiveQuery(() => db.changes.where('batchId').equals(batchId).sortBy('createdAt'), [batchId])
  const [open, setOpen] = useState(false)
  if (!changes?.length) return null
  const undone = changes.every((c) => c.undone)
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <button className="flex flex-1 items-center gap-1.5 text-left text-muted" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {changes.length} change{changes.length > 1 ? 's' : ''}
          {undone && <span className="text-faint"> · undone</span>}
        </button>
        {!undone && (
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => undoBatch(batchId)}>
            Undo all
          </Button>
        )}
      </div>
      {open && (
        <div className="space-y-1 border-t border-line px-3 py-2 text-sm">
          {changes.map((c) => (
            <div key={c.id} className={cx('flex items-center gap-2', c.undone && 'line-through opacity-50')}>
              <span className="flex-1 text-muted">{c.label}</span>
              {c.table === 'entities' && c.after !== undefined && !c.undone ? <LinkChip target={`id:${c.recordId}`}>open</LinkChip> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AdvisorModal({
  open,
  onClose,
  initial,
  onAsk,
}: {
  open: boolean
  onClose: () => void
  initial: string
  onAsk: (q: string, advisors: ReturnType<typeof useSettings.getState>['settings']['advisors']) => void
}) {
  const advisors = useSettings((s) => s.settings.advisors)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  useEffect(() => {
    if (open) {
      setQ(initial)
      setSel(Object.fromEntries(advisors.map((a) => [a.id, a.enabled])))
    }
  }, [open, initial, advisors])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ask the advisors"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Users className="size-4" />}
            onClick={() => {
              onAsk(
                q,
                advisors.map((a) => ({ ...a, enabled: !!sel[a.id] })),
              )
              onClose()
            }}
          >
            Ask
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea minRows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Optional question — leave empty for an opinion on the current plan." />
        <div className="space-y-2">
          {advisors.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="text-sm">
                {a.emoji} {a.name}
              </span>
              <Toggle checked={!!sel[a.id]} onChange={(v) => setSel({ ...sel, [a.id]: v })} />
            </div>
          ))}
        </div>
        <p className="text-xs text-faint">
          Advisors read the campaign and this conversation and comment — they never change anything. Their comments appear in the chat; the writer only sees what you edit and send on.{' '}
          <Link to="/settings" className="text-accent underline">
            Add or edit advisors
          </Link>
        </p>
      </div>
    </Modal>
  )
}
