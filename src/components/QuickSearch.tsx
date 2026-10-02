import { useMemo, useState } from 'react'
import { create } from 'zustand'
import { Plus, Search } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI } from '@/state/ui'
import { normalizeName, searchRefs } from '@/compendium/compendium'
import { ENTITY_TYPES, REF_TYPES } from '@/lib/entityTypes'
import { Modal, cx } from './ui'

export const useQuickSearch = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export function QuickSearch() {
  const open = useQuickSearch((s) => s.open)
  const setOpen = useQuickSearch((s) => s.setOpen)
  if (!open) return null
  return <QuickSearchInner onClose={() => setOpen(false)} />
}

function QuickSearchInner({ onClose }: { onClose: () => void }) {
  const { entities, campaign, compendiumVersion } = useCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)

  const results = useMemo(() => {
    const n = normalizeName(q)
    if (!n) return []
    const own = entities
      .map((e) => {
        const name = normalizeName(e.name)
        const s = name === n ? 100 : name.startsWith(n) ? 70 : name.includes(n) ? 50 : e.aliases.some((a) => normalizeName(a).includes(n)) ? 40 : normalizeName(e.summary).includes(n) ? 15 : 0
        return { e, s }
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((x) => ({ kind: 'entity' as const, id: x.e.id, name: x.e.name, sub: x.e.summary, meta: ENTITY_TYPES[x.e.type] }))
    const refs = searchRefs(campaign.system, q, { limit: 25 }).map((r) => ({
      kind: 'ref' as const,
      id: r.id,
      name: r.name,
      sub: r.summary ?? '',
      meta: REF_TYPES[r.category],
    }))
    return [...own, ...refs]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, entities, campaign.system, compendiumVersion])

  const pick = (i: number) => {
    const r = results[i]
    if (r) openDetail(r.kind === 'entity' ? { kind: 'entity', id: r.id } : { kind: 'ref', id: r.id, system: campaign.system })
    else if (q.trim()) openDetail({ kind: 'unresolved', name: q.trim() })
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="-mx-5 -my-4 flex h-[70vh] flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 text-faint" />
          <input
            autoFocus
            className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-faint"
            placeholder="Search campaign & rules…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, results.length - 1))
              if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
              if (e.key === 'Enter') pick(sel)
            }}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {results.map((r, i) => (
            <button
              key={r.kind + r.id}
              onClick={() => pick(i)}
              className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', i === sel ? 'bg-surface-3' : 'hover:bg-surface-2')}
            >
              <r.meta.icon className="size-4 shrink-0" style={{ color: r.meta.color }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{r.name}</div>
                {r.sub && <div className="truncate text-xs text-faint">{r.sub}</div>}
              </div>
              <span className="text-[11px] text-faint">{r.kind === 'ref' ? 'Rules' : r.meta.label}</span>
            </button>
          ))}
          {q.trim() && (
            <button onClick={() => pick(-1)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-accent hover:bg-surface-2">
              <Plus className="size-4" /> Create “{q.trim()}”…
            </button>
          )}
          {!q && <div className="p-6 text-center text-sm text-faint">Type to search NPCs, places, spells, conditions, monsters…</div>}
        </div>
      </div>
    </Modal>
  )
}
