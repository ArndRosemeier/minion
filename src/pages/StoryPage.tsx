import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BookOpen, ChevronLeft, ChevronRight, ListTree, MonitorPlay, NotebookPen, Pencil, Plus, Send, UserPlus } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI } from '@/state/ui'
import { useEditor } from '@/components/EntityEditor'
import { createEntity, updateEntity, userCtx } from '@/db/repo'
import { Markdown, LinkChip } from '@/components/Markdown'
import { AssetImage } from '@/components/AssetImage'
import { QuickNpcModal } from '@/components/QuickNpc'
import { ENTITY_TYPES } from '@/lib/entityTypes'
import { extractLinks, resolveLink } from '@/lib/links'
import { Button, Empty, IconButton, Input, cx } from '@/components/ui'
import type { Entity, RefEntry } from '@/types'

const byOrder = (a: Entity, b: Entity) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt

export function StoryPage() {
  const { entities, campaign } = useCampaign()
  const { entityId } = useParams()
  const nav = useNavigate()
  const [tocOpen, setTocOpen] = useState(false)
  const [npcOpen, setNpcOpen] = useState(false)

  const chapters = useMemo(() => entities.filter((e) => e.type === 'chapter').sort(byOrder), [entities])
  const scenesOf = useMemo(() => {
    const m = new Map<string, Entity[]>()
    entities
      .filter((e) => e.type === 'scene')
      .sort(byOrder)
      .forEach((s) => {
        const k = s.parentId ?? ''
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(s)
      })
    return m
  }, [entities])

  // reading order: chapter, its scenes, next chapter…
  const flow = useMemo(() => {
    const f: Entity[] = []
    for (const c of chapters) {
      f.push(c)
      f.push(...(scenesOf.get(c.id) ?? []))
    }
    f.push(...(scenesOf.get('') ?? []))
    return f
  }, [chapters, scenesOf])

  const current = (entityId && entities.find((e) => e.id === entityId)) || flow[0]
  const idx = current ? flow.findIndex((e) => e.id === current.id) : -1
  const go = (e?: Entity) => {
    if (!e) return
    nav(`/c/${campaign.id}/play/${e.id}`)
    setTocOpen(false)
    document.getElementById('story-scroll')?.scrollTo({ top: 0 })
  }

  if (!flow.length && !current) {
    return (
      <Empty icon={<BookOpen />} title="No story yet">
        Chapters and scenes appear here in reading order. Create them in the Builder or ask the campaign chat.
      </Empty>
    )
  }

  return (
    <div className="flex h-full">
      <aside className={cx('absolute inset-y-0 left-0 z-20 w-72 flex-col overflow-y-auto border-r border-line bg-surface p-3 lg:static lg:flex', tocOpen ? 'flex' : 'hidden')}>
        <div className="mb-2 px-2 text-[10px] font-bold tracking-widest text-faint uppercase">Story</div>
        {chapters.map((c, i) => (
          <div key={c.id} className="mb-1">
            <TocItem e={c} active={current?.id === c.id} onClick={() => go(c)} label={`${i + 1}. ${c.name}`} strong />
            {(scenesOf.get(c.id) ?? []).map((s) => (
              <TocItem key={s.id} e={s} active={current?.id === s.id} onClick={() => go(s)} label={s.name} indent />
            ))}
          </div>
        ))}
        {(scenesOf.get('') ?? []).length > 0 && (
          <>
            <div className="mt-3 mb-1 px-2 text-[10px] font-bold tracking-widest text-faint uppercase">Loose scenes</div>
            {(scenesOf.get('') ?? []).map((s) => (
              <TocItem key={s.id} e={s} active={current?.id === s.id} onClick={() => go(s)} label={s.name} />
            ))}
          </>
        )}
      </aside>
      {tocOpen && <div className="absolute inset-0 z-10 bg-black/40 lg:hidden" onClick={() => setTocOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <IconButton label="Contents" icon={<ListTree />} onClick={() => setTocOpen(!tocOpen)} className="lg:hidden" />
          <IconButton label="Previous" icon={<ChevronLeft />} onClick={() => go(flow[idx - 1])} disabled={idx <= 0} />
          <IconButton label="Next" icon={<ChevronRight />} onClick={() => go(flow[idx + 1])} disabled={idx < 0 || idx >= flow.length - 1} />
          <div className="min-w-0 flex-1 truncate text-sm text-muted">{current?.name}</div>
          <Button size="sm" variant="ghost" icon={<UserPlus className="size-4" />} onClick={() => setNpcOpen(true)}>
            <span className="hidden sm:inline">NPC</span>
          </Button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div id="story-scroll" className="min-w-0 flex-1 overflow-y-auto">
            {current && <Reader e={current} scenes={current.type === 'chapter' ? (scenesOf.get(current.id) ?? []) : []} onOpen={go} />}
            <div className="mx-auto flex max-w-4xl justify-between gap-2 px-6 pb-16 2xl:max-w-6xl">
              {flow[idx - 1] ? (
                <Button variant="ghost" icon={<ChevronLeft className="size-4" />} onClick={() => go(flow[idx - 1])}>
                  {flow[idx - 1].name}
                </Button>
              ) : (
                <span />
              )}
              {flow[idx + 1] && (
                <Button variant="ghost" onClick={() => go(flow[idx + 1])}>
                  {flow[idx + 1].name} <ChevronRight className="size-4" />
                </Button>
              )}
            </div>
          </div>
          {current && <SidePanel e={current} />}
        </div>
      </div>
      <QuickNpcModal open={npcOpen} onClose={() => setNpcOpen(false)} />
    </div>
  )
}

function TocItem({ e, active, onClick, label, indent, strong }: { e: Entity; active: boolean; onClick: () => void; label: string; indent?: boolean; strong?: boolean }) {
  const meta = ENTITY_TYPES[e.type]
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
        indent && 'pl-7',
        strong && 'font-medium',
        active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface-2 hover:text-ink',
      )}
    >
      {!strong && <meta.icon className="size-3.5 shrink-0" style={{ color: meta.color }} />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function Reader({ e, scenes, onOpen }: { e: Entity; scenes: Entity[]; onOpen: (e: Entity) => void }) {
  const show = useUI((s) => s.show)
  const openEditor = useEditor((s) => s.open)
  const meta = ENTITY_TYPES[e.type]
  return (
    <article className="mx-auto max-w-4xl space-y-6 px-6 py-8 2xl:max-w-6xl">
      {e.images[0] && (
        <button onClick={() => show({ image: e.images[0], title: e.name })} className="group relative block w-full overflow-hidden rounded-2xl border border-line">
          <AssetImage id={e.images[0]} className="max-h-[42vh] w-full object-cover" />
          <span className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white opacity-80 backdrop-blur group-hover:opacity-100">
            <MonitorPlay className="size-3.5" /> Show players
          </span>
        </button>
      )}
      <header className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase" style={{ color: meta.color }}>
          <meta.icon className="size-3.5" /> {meta.label}
        </div>
        <div className="flex items-start gap-2">
          <h1 className="flex-1 font-display text-3xl leading-tight">{e.name}</h1>
          <IconButton label="Edit" icon={<Pencil />} onClick={() => openEditor({ id: e.id })} />
        </div>
        {e.summary && <p className="text-muted">{e.summary}</p>}
      </header>
      <Markdown text={e.body} selfName={e.name} className="text-[17px] 2xl:text-[19px]" onReadAloud={(text) => show({ text })} />
      {e.secrets && (
        <details className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-danger">GM secrets</summary>
          <Markdown text={e.secrets} selfName={e.name} className="mt-2 text-sm" />
        </details>
      )}
      {scenes.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold tracking-wider text-faint uppercase">Scenes</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {scenes.map((s) => (
              <button key={s.id} onClick={() => onOpen(s)} className="rounded-xl border border-line bg-surface p-3 text-left hover:border-line-strong">
                <div className="font-medium text-ink">{s.name}</div>
                <div className="line-clamp-2 text-xs text-muted">{s.summary}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

/** Quick access to everything referenced in the current text + session notes. */
function SidePanel({ e }: { e: Entity }) {
  const { index, campaign, entities, compendiumVersion } = useCampaign()
  const { refs, rules } = useMemo(() => {
    const out = new Map<string, Entity>()
    const rules = new Map<string, RefEntry>()
    const text = `${e.body}\n${e.secrets ?? ''}`
    for (const t of extractLinks(text)) {
      const r = resolveLink(t, index, campaign.system)
      if (r.kind === 'entity' && r.entity.id !== e.id) out.set(r.entity.id, r.entity)
      if (r.kind === 'ref') rules.set(r.ref.id, r.ref)
    }
    // plain-text mentions
    const lower = text.toLowerCase()
    for (const x of entities) {
      if (x.id === e.id || x.type === 'note' || out.has(x.id)) continue
      if ([x.name, ...x.aliases].some((n) => n.length >= 3 && lower.includes(n.toLowerCase()))) out.set(x.id, x)
    }
    return { refs: [...out.values()], rules: [...rules.values()] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, index, campaign.system, entities, compendiumVersion])

  const groups = ['npc', 'location', 'encounter', 'creature', 'item', 'handout', 'faction', 'scene', 'chapter', 'spell', 'rule'] as const
  return (
    <aside className="hidden w-72 shrink-0 space-y-5 overflow-y-auto border-l border-line p-4 xl:block 2xl:w-96">
      {groups.map((g) => {
        const list = refs.filter((r) => r.type === g)
        if (!list.length) return null
        return (
          <div key={g} className="space-y-1.5">
            <div className="text-[10px] font-bold tracking-widest text-faint uppercase">{ENTITY_TYPES[g].plural}</div>
            <div className="flex flex-wrap gap-1.5">
              {list.map((x) => (
                <LinkChip key={x.id} target={`id:${x.id}`}>
                  {x.name}
                </LinkChip>
              ))}
            </div>
          </div>
        )
      })}
      {rules.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold tracking-widest text-faint uppercase">Rules</div>
          <div className="flex flex-wrap gap-1.5">
            {rules.map((r) => (
              <LinkChip key={r.id} target={`ref:${r.id}`}>
                {r.name}
              </LinkChip>
            ))}
          </div>
        </div>
      )}
      <SessionNotes />
    </aside>
  )
}

export function SessionNotes() {
  const { campaign, entities } = useCampaign()
  const [text, setText] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const name = `Session ${today}`
  const note = entities.find((e) => e.type === 'note' && e.name === name)
  const add = async () => {
    const t = text.trim()
    if (!t) return
    const line = `- ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${t}`
    if (note) await updateEntity(note.id, { body: `${note.body}\n${line}` }, userCtx())
    else await createEntity(campaign.id, 'note', { name, summary: 'Session log', body: line, tags: ['session'] }, userCtx())
    setText('')
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-faint uppercase">
        <NotebookPen className="size-3" /> Session notes
      </div>
      {note && <Markdown text={note.body} className="max-h-60 overflow-y-auto text-xs" />}
      <div className="flex gap-1.5">
        <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="What happened…" className="h-9 text-sm" />
        <IconButton label="Add note" icon={note ? <Send /> : <Plus />} onClick={add} />
      </div>
    </div>
  )
}
