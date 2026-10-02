import { useMemo, useState } from 'react'
import { BookMarked, Search } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI } from '@/state/ui'
import { compendium, searchRefs } from '@/compendium/compendium'
import { REF_TYPES } from '@/lib/entityTypes'
import { Empty, Input, Segmented, Spinner } from '@/components/ui'
import type { RefCategory } from '@/types'

export function RulesPage() {
  const { campaign, compendiumVersion } = useCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<RefCategory | 'all'>('condition')
  const c = compendium(campaign.system)
  const cats = useMemo(() => {
    const set = new Set(c?.entries.map((e) => e.category))
    return (Object.keys(REF_TYPES) as RefCategory[]).filter((k) => set.has(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, compendiumVersion])
  const results = useMemo(
    () => searchRefs(campaign.system, q, { category: cat === 'all' ? undefined : cat, limit: 300 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, cat, campaign.system, compendiumVersion],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 border-b border-line p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input className="pl-9" placeholder="Search the rules reference…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <Segmented
            size="sm"
            value={cat}
            onChange={setCat}
            options={[{ value: 'all' as const, label: 'All' }, ...cats.map((k) => ({ value: k, label: REF_TYPES[k].plural }))]}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!c && (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        )}
        {c && !c.entries.length && <Empty icon={<BookMarked />} title="No rules data bundled" />}
        <div className="grid gap-1 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          {results.map((r) => {
            const meta = REF_TYPES[r.category]
            return (
              <button
                key={r.id}
                onClick={() => openDetail({ kind: 'ref', id: r.id, system: campaign.system })}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2"
              >
                <meta.icon className="size-4 shrink-0" style={{ color: meta.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{r.name}</div>
                  {r.summary && <div className="truncate text-xs text-faint">{r.summary}</div>}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
