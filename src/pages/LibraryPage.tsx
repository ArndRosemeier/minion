import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Plus, Search } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI } from '@/state/ui'
import { useEditor } from '@/components/EntityEditor'
import { ENTITY_TYPE_ORDER, ENTITY_TYPES } from '@/lib/entityTypes'
import { normalizeName } from '@/compendium/compendium'
import { AssetImage } from '@/components/AssetImage'
import { Badge, Button, Empty, Input, cx } from '@/components/ui'
import type { Entity, EntityType } from '@/types'

export function LibraryPage() {
  const { entities } = useCampaign()
  const [params, setParams] = useSearchParams()
  const type = (params.get('type') as EntityType | null) ?? null
  const [q, setQ] = useState('')
  const openDetail = useUI((s) => s.openDetail)
  const openEditor = useEditor((s) => s.open)

  const counts = useMemo(() => {
    const c: Partial<Record<EntityType, number>> = {}
    entities.forEach((e) => (c[e.type] = (c[e.type] ?? 0) + 1))
    return c
  }, [entities])

  const list = useMemo(() => {
    const n = normalizeName(q)
    return entities
      .filter((e) => !type || e.type === type)
      .filter((e) => !n || normalizeName(`${e.name} ${e.aliases.join(' ')} ${e.summary} ${e.tags.join(' ')}`).includes(n))
      .sort((a, b) => {
        if (a.type !== b.type) return ENTITY_TYPE_ORDER.indexOf(a.type) - ENTITY_TYPE_ORDER.indexOf(b.type)
        if (a.order !== undefined || b.order !== undefined) return (a.order ?? 0) - (b.order ?? 0)
        return a.name.localeCompare(b.name)
      })
  }, [entities, type, q])

  const setType = (t: EntityType | null) => {
    if (t) setParams({ type: t })
    else setParams({})
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-56 shrink-0 space-y-0.5 overflow-y-auto border-r border-line p-3 md:block">
        <TypeButton active={!type} onClick={() => setType(null)} label="Everything" count={entities.length} />
        {ENTITY_TYPE_ORDER.map((t) => (
          <TypeButton key={t} active={type === t} onClick={() => setType(t)} label={ENTITY_TYPES[t].plural} count={counts[t] ?? 0} type={t} />
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input className="pl-9" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select
            className="h-10 rounded-lg border border-line bg-surface-2 px-2 text-sm md:hidden"
            value={type ?? ''}
            onChange={(e) => setType((e.target.value || null) as EntityType | null)}
          >
            <option value="">Everything</option>
            {ENTITY_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {ENTITY_TYPES[t].plural}
              </option>
            ))}
          </select>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openEditor({ draft: { type: type ?? 'npc' } })}>
            New {type ? ENTITY_TYPES[type].label : 'entry'}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {list.length === 0 ? (
            <Empty title={q ? 'Nothing matches' : 'Nothing here yet'}>
              {type ? ENTITY_TYPES[type].hint : 'Create entries by hand, or ask the campaign chat / builder to write them.'}
            </Empty>
          ) : (
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
              {list.map((e) => (
                <EntityCard key={e.id} e={e} onClick={() => openDetail({ kind: 'entity', id: e.id })} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TypeButton({ active, onClick, label, count, type }: { active: boolean; onClick: () => void; label: string; count: number; type?: EntityType }) {
  const meta = type ? ENTITY_TYPES[type] : null
  return (
    <button
      onClick={onClick}
      className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm', active ? 'bg-surface-3 text-ink' : 'text-muted hover:bg-surface-2')}
    >
      {meta && <meta.icon className="size-4" style={{ color: meta.color }} />}
      <span className="flex-1">{label}</span>
      {count > 0 && <Badge>{count}</Badge>}
    </button>
  )
}

export function EntityCard({ e, onClick }: { e: Entity; onClick: () => void }) {
  const meta = ENTITY_TYPES[e.type]
  return (
    <button onClick={onClick} className="flex gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-line-strong hover:bg-surface-2">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-surface-3">
        {e.images[0] ? (
          <AssetImage id={e.images[0]} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <meta.icon className="size-6 opacity-60" style={{ color: meta.color }} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase" style={{ color: meta.color }}>
          {meta.label}
          {e.stats && <span className="text-faint">· stats</span>}
        </div>
        <div className="truncate font-medium text-ink">{e.name}</div>
        <div className="line-clamp-2 text-xs text-muted">{e.summary}</div>
      </div>
    </button>
  )
}
