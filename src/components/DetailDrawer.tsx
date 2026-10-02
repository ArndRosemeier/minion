import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Copy,
  EyeOff,
  ImagePlus,
  MessageSquarePlus,
  MonitorPlay,
  Pencil,
  Plus,
  Swords,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI, toast } from '@/state/ui'
import { getRef, normalizeName } from '@/compendium/compendium'
import { ENTITY_TYPE_ORDER, ENTITY_TYPES, REF_TYPES, UNRESOLVED_META } from '@/lib/entityTypes'
import { Markdown, LinkChip } from './Markdown'
import { StatBlockView } from './StatBlockView'
import { AssetImage } from './AssetImage'
import { Button, ConfirmModal, cx, IconButton, Select, Textarea } from './ui'
import { createEntity, deleteEntity, userCtx } from '@/db/repo'
import { generateEntityData, illustrateEntity } from '@/ai/generate'
import { useEditor } from './EntityEditor'
import { useBattle } from '@/state/battle'
import type { Entity, EntityType, RefEntry } from '@/types'
import type { LinkTarget } from '@/lib/links'

export function DetailDrawer() {
  const drawer = useUI((s) => s.drawer)
  const pop = useUI((s) => s.popDetail)
  const close = useUI((s) => s.closeDetail)
  const top = drawer[drawer.length - 1]
  if (!top) return null
  return (
    <>
      <div className="anim-fade fixed inset-0 z-30 bg-black/40 lg:bg-black/20" onClick={close} />
      <aside
        key={JSON.stringify(top)}
        className="anim-slide safe-top fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-strong bg-surface shadow-2xl shadow-black/70 sm:w-[min(560px,92vw)] xl:w-[640px] 2xl:w-[720px]"
      >
        <div className="flex items-center gap-1 border-b border-line px-2 py-2">
          {drawer.length > 1 ? <IconButton label="Back" icon={<ArrowLeft />} onClick={pop} /> : <div className="w-2" />}
          <div className="flex-1 truncate text-xs text-faint">
            {drawer.length > 1 && `${drawer.length - 1} back`}
          </div>
          <IconButton label="Close" icon={<X />} onClick={close} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DetailContent target={top} />
        </div>
      </aside>
    </>
  )
}

export function DetailContent({ target }: { target: LinkTarget }) {
  const { index, campaign } = useCampaign()
  if (target.kind === 'entity') {
    const e = index.byId.get(target.id)
    if (!e) return <div className="p-6 text-muted">This entry was deleted.</div>
    return <EntityDetail entity={e} />
  }
  if (target.kind === 'ref') {
    const r = getRef(target.system, target.id)
    if (!r) return <div className="p-6 text-muted">Rules entry not found.</div>
    return <RefDetail entry={r} />
  }
  return <UnresolvedDetail name={target.name} hint={target.hint} key={target.name + campaign.id} />
}

function Header({ icon: Icon, color, label, title, sub }: { icon: any; color: string; label: string; title: string; sub?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase" style={{ color }}>
        <Icon className="size-3.5" />
        {label}
      </div>
      <h2 className="font-display text-2xl leading-tight text-ink">{title}</h2>
      {sub && <div className="text-sm text-muted">{sub}</div>}
    </div>
  )
}

function EntityDetail({ entity: e }: { entity: Entity }) {
  const { campaign, entities } = useCampaign()
  const show = useUI((s) => s.show)
  const closeDetail = useUI((s) => s.closeDetail)
  const openEditor = useEditor((s) => s.open)
  const spawn = useBattle((s) => s.requestSpawn)
  const activeMap = useBattle((s) => s.activeMapId)
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState(0)
  const [showSecrets, setShowSecrets] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const meta = ENTITY_TYPES[e.type]

  const children = useMemo(() => entities.filter((x) => x.parentId === e.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [entities, e.id])
  const parent = e.parentId ? entities.find((x) => x.id === e.parentId) : undefined
  const backlinks = useMemo(() => {
    const names = [e.name, ...e.aliases].filter((n) => n.length >= 3).map((n) => normalizeName(n))
    return entities.filter((x) => {
      if (x.id === e.id) return false
      const text = normalizeName(`${x.body} ${x.secrets ?? ''}`)
      return names.some((n) => text.includes(n))
    })
  }, [entities, e])

  const illustrate = async () => {
    setBusy(true)
    try {
      await illustrateEntity(campaign, e, undefined, userCtx())
      setImg(0)
      toast('Illustration created', 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 p-5">
      <Header icon={meta.icon} color={meta.color} label={meta.label} title={e.name} sub={e.summary} />
      {e.aliases.length > 0 && <div className="-mt-3 text-xs text-faint">Also: {e.aliases.join(', ')}</div>}

      {e.images.length > 0 && (
        <div className="space-y-2">
          <button className="block w-full overflow-hidden rounded-xl border border-line" onClick={() => show({ image: e.images[img], title: e.name })}>
            <AssetImage id={e.images[img] ?? e.images[0]} className="max-h-[50vh] w-full object-cover" />
          </button>
          {e.images.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto">
              {e.images.map((id, i) => (
                <button key={id} onClick={() => setImg(i)} className={cx('size-14 shrink-0 overflow-hidden rounded-md border-2', i === img ? 'border-accent' : 'border-transparent')}>
                  <AssetImage id={id} className="size-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => openEditor({ id: e.id })}>
          Edit
        </Button>
        <Button
          size="sm"
          icon={<MonitorPlay className="size-4" />}
          onClick={() => show({ image: e.images[img] ?? e.images[0], title: e.name, text: e.images.length ? undefined : e.summary })}
        >
          Show players
        </Button>
        <Button size="sm" icon={<ImagePlus className="size-4" />} loading={busy} onClick={illustrate}>
          Illustrate
        </Button>
        {e.stats && activeMap && (
          <Button
            size="sm"
            variant="primary"
            icon={<Swords className="size-4" />}
            onClick={() => {
              spawn({ kind: e.type === 'npc' ? 'npc' : 'monster', name: e.name, refId: e.id, stats: e.stats!, image: e.images[0] })
              closeDetail()
            }}
          >
            Spawn on map
          </Button>
        )}
        <ChatAboutButton text={`About [[id:${e.id}|${e.name}]]: `} />
        <IconButton label="Delete" size="sm" icon={<Trash2 />} onClick={() => setConfirmDel(true)} />
      </div>

      {parent && (
        <div className="text-sm text-muted">
          Part of <LinkChip target={`id:${parent.id}`}>{parent.name}</LinkChip>
        </div>
      )}

      {e.body && <Markdown text={e.body} selfName={e.name} />}

      {e.encounter && <EncounterBlock entity={e} />}

      {e.stats && <StatBlockView stats={e.stats} system={campaign.system} name={e.name} />}

      {e.secrets && (
        <div className="rounded-xl border border-danger/30 bg-danger/5">
          <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold text-danger" onClick={() => setShowSecrets(!showSecrets)}>
            <EyeOff className="size-4" /> GM secrets {showSecrets ? '' : '(tap to reveal)'}
          </button>
          {showSecrets && <Markdown text={e.secrets} selfName={e.name} className="px-4 pb-4 text-sm" />}
        </div>
      )}

      {children.length > 0 && (
        <Section title={e.type === 'chapter' ? 'Scenes' : 'Contains'}>
          <div className="flex flex-wrap gap-1.5">
            {children.map((c) => (
              <LinkChip key={c.id} target={`id:${c.id}`}>
                {c.name}
              </LinkChip>
            ))}
          </div>
        </Section>
      )}

      {backlinks.length > 0 && (
        <Section title="Mentioned in">
          <div className="flex flex-wrap gap-1.5">
            {backlinks.slice(0, 30).map((c) => (
              <LinkChip key={c.id} target={`id:${c.id}`}>
                {c.name}
              </LinkChip>
            ))}
          </div>
        </Section>
      )}

      {e.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {e.tags.map((t) => (
            <span key={t} className="rounded bg-surface-3 px-2 py-0.5 text-xs text-muted">
              #{t}
            </span>
          ))}
        </div>
      )}
      <ConfirmModal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title={`Delete “${e.name}”?`}
        text="You can undo this from the History page."
        danger
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteEntity(e.id, userCtx())
          useUI.getState().popDetail()
        }}
      />
    </div>
  )
}

function ChatAboutButton({ text }: { text: string }) {
  const setDraft = useUI((s) => s.setChatDraft)
  return (
    <IconButton
      label="Ask the campaign chat about this"
      size="sm"
      icon={<MessageSquarePlus />}
      onClick={() => {
        setDraft(text)
        toast('Added to chat input — open the Chat tab', 'info')
      }}
    />
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-wider text-faint uppercase">{title}</div>
      {children}
    </div>
  )
}

function EncounterBlock({ entity: e }: { entity: Entity }) {
  const { maps, index, campaign } = useCampaign()
  const map = e.encounter?.mapId ? maps.find((m) => m.id === e.encounter!.mapId) : undefined
  const openMap = useBattle((s) => s.openMap)
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-wider text-faint uppercase">Encounter</div>
        {e.encounter?.difficulty && <span className="rounded bg-danger/15 px-2 py-0.5 text-xs font-semibold text-danger">{e.encounter.difficulty}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {e.encounter?.creatures.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            {c.count > 1 && <b className="text-sm text-accent">{c.count}×</b>}
            <LinkChip target={index.byId.has(c.refId) ? `id:${c.refId}` : getRef(campaign.system, c.refId) ? `ref:${c.refId}` : `creature:${c.name}`}>
              {c.name}
            </LinkChip>
          </span>
        ))}
      </div>
      {e.encounter?.tactics && <Markdown text={`**Tactics:** ${e.encounter.tactics}`} className="text-sm" />}
      {map && (
        <Button size="sm" variant="primary" icon={<Swords className="size-4" />} onClick={() => openMap(map.id)}>
          Open battle map “{map.name}”
        </Button>
      )}
    </div>
  )
}

function RefDetail({ entry: r }: { entry: RefEntry }) {
  const { campaign } = useCampaign()
  const openEditor = useEditor((s) => s.open)
  const spawn = useBattle((s) => s.requestSpawn)
  const activeMap = useBattle((s) => s.activeMapId)
  const closeDetail = useUI((s) => s.closeDetail)
  const meta = REF_TYPES[r.category]
  const homebrewType: EntityType = r.category === 'creature' ? 'creature' : r.category === 'spell' ? 'spell' : r.category === 'item' ? 'item' : 'rule'
  return (
    <div className="space-y-4 p-5">
      <Header
        icon={meta.icon}
        color={meta.color}
        label={`${meta.label}${r.level !== undefined ? ` · ${r.category === 'spell' ? (campaign.system === 'pf2e' ? 'Rank' : 'Level') : 'Level'} ${r.level}` : ''}${r.cr ? ` · CR ${r.cr}` : ''}`}
        title={r.name}
        sub={r.summary}
      />
      {r.traits && r.traits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.traits.map((t) => (
            <LinkChip key={t} target={`trait:${t}`} className="text-xs uppercase">
              {t}
            </LinkChip>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {r.stats && activeMap && (
          <Button
            size="sm"
            variant="primary"
            icon={<Swords className="size-4" />}
            onClick={() => {
              spawn({ kind: 'monster', name: r.name, refId: r.id, stats: r.stats!, image: undefined })
              closeDetail()
            }}
          >
            Spawn on map
          </Button>
        )}
        <Button
          size="sm"
          icon={<Copy className="size-4" />}
          onClick={() =>
            openEditor({
              draft: {
                type: homebrewType,
                name: r.name,
                summary: r.summary ?? '',
                body: [r.meta && Object.entries(r.meta).map(([k, v]) => `**${k}** ${v}`).join('  \n'), r.text].filter(Boolean).join('\n\n'),
                stats: r.stats ? structuredClone(r.stats) : undefined,
                tags: ['homebrew'],
              },
            })
          }
        >
          Copy as homebrew
        </Button>
      </div>
      {r.meta && Object.keys(r.meta).length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-surface-2 p-3 text-sm">
          {Object.entries(r.meta).map(([k, v]) => (
            <div key={k} className="contents">
              <div className="font-semibold text-ink">{k}</div>
              <div className="text-muted">
                <Markdown text={v} className="text-sm !leading-snug" autoLink={false} />
              </div>
            </div>
          ))}
        </div>
      )}
      {r.text && <Markdown text={r.text} autoLink={false} />}
      {r.stats && <StatBlockView stats={r.stats} system={r.system} name={r.name} />}
      {r.source && <div className="text-xs text-faint">Source: {r.source}</div>}
    </div>
  )
}

function UnresolvedDetail({ name, hint }: { name: string; hint?: string }) {
  const { campaign, entities } = useCampaign()
  const openEditor = useEditor((s) => s.open)
  const openDetail = useUI((s) => s.openDetail)
  const popDetail = useUI((s) => s.popDetail)
  const guess: EntityType = (hint && (ENTITY_TYPES as Record<string, unknown>)[hint] ? hint : hint === 'monster' ? 'creature' : hint === 'condition' || hint === 'action' || hint === 'trait' ? 'rule' : 'npc') as EntityType
  const [type, setType] = useState<EntityType>(guess)
  const [instructions, setInstructions] = useState('')
  const [busy, setBusy] = useState(false)

  const generate = async () => {
    setBusy(true)
    try {
      const data = await generateEntityData(campaign, entities, { type, name, instructions, withStats: type === 'creature' })
      const ent = await createEntity(campaign.id, type, { ...data, name: data.name || name, aliases: data.name && data.name !== name ? [name, ...(data.aliases || [])] : data.aliases }, userCtx())
      popDetail()
      openDetail({ kind: 'entity', id: ent.id })
      toast(`Created ${ENTITY_TYPES[type].label} “${ent.name}”`, 'success')
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 p-5">
      <Header icon={UNRESOLVED_META.icon} color="var(--color-muted)" label="Not found" title={name} />
      <p className="text-sm text-muted">
        “{name}” is neither in this campaign nor in the bundled rules reference. Create it — by hand, or let the AI write it (homebrew).
      </p>
      <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
        <Select value={type} onChange={(e) => setType(e.target.value as EntityType)}>
          {ENTITY_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {ENTITY_TYPES[t].label}
            </option>
          ))}
        </Select>
        <Textarea minRows={2} placeholder="Optional instructions for the AI…" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Wand2 className="size-4" />} loading={busy} onClick={generate}>
            Generate with AI
          </Button>
          <Button icon={<Plus className="size-4" />} onClick={() => openEditor({ draft: { type, name } })}>
            Create manually
          </Button>
        </div>
      </div>
    </div>
  )
}
