import { useMemo, useState } from 'react'
import { BookMarked, Search } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI } from '@/state/ui'
import { compendium, searchRefs } from '@/compendium/compendium'
import { REF_TYPES } from '@/lib/entityTypes'
import { Empty, Input, Segmented, Spinner } from '@/components/ui'
import type { RefCategory, RefEntry } from '@/types'

const LIMIT = 1000

// 5e items have no level — rarity is their equivalent (mundane gear has none and sorts first)
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']
const rarityOf = (e: RefEntry) => (e.category === 'item' && e.system === 'dnd5e' ? (e.meta?.Rarity ?? '') : undefined)
function rarityRank(r: string) {
  const first = r.toLowerCase().split(/[,(]/)[0].trim()
  const i = RARITIES.indexOf(first)
  return i >= 0 ? i + 1 : r ? 3.5 : 0 // "Rarity Varies" sits in the middle
}

/** level for sorting: level/rank, 5e CR ("1/4" → 0.25) or 5e item rarity; undefined when the entry has none */
function sortLevel(e: RefEntry): number | undefined {
  if (e.level !== undefined) return e.level
  const rarity = rarityOf(e)
  if (rarity !== undefined) return rarityRank(rarity)
  if (!e.cr) return undefined
  const [a, b] = e.cr.split('/').map(Number)
  const v = b ? a / b : a
  return Number.isFinite(v) ? v : undefined
}

const levelLabel = (e: RefEntry) => (e.level !== undefined ? `Lv ${e.level}` : e.cr ? `CR ${e.cr}` : (rarityOf(e)?.split(/[,(]/)[0].trim() ?? ''))

export function RulesPage() {
  const { campaign, compendiumVersion } = useCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<RefCategory | 'all'>('condition')
  // null = default for the category: by level where entries have levels (spells, items, creatures…)
  const [sortPick, setSortPick] = useState<'name' | 'level' | null>(null)
  const c = compendium(campaign.system)
  const cats = useMemo(() => {
    const set = new Set(c?.entries.map((e) => e.category))
    return (Object.keys(REF_TYPES) as RefCategory[]).filter((k) => set.has(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, compendiumVersion])
  const hasLevels = useMemo(
    () => cat !== 'all' && !!c?.entries.some((e) => e.category === cat && sortLevel(e) !== undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, cat, compendiumVersion],
  )
  const sortBy = hasLevels ? (sortPick ?? 'level') : 'name'
  const results = useMemo(
    () => {
      const found = searchRefs(campaign.system, q, { category: cat === 'all' ? undefined : cat, limit: sortBy === 'level' ? Infinity : LIMIT })
      if (sortBy !== 'level') return found
      // level order, entries without a level last; search relevance only breaks ties
      const rank = new Map(found.map((e, i) => [e.id, i]))
      return [...found]
        .sort((a, b) => (sortLevel(a) ?? Infinity) - (sortLevel(b) ?? Infinity) || (q ? rank.get(a.id)! - rank.get(b.id)! : a.name.localeCompare(b.name)))
        .slice(0, LIMIT)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, cat, sortBy, campaign.system, compendiumVersion],
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
            onChange={(v) => (setCat(v), setSortPick(null))}
            options={[{ value: 'all' as const, label: 'All' }, ...cats.map((k) => ({ value: k, label: REF_TYPES[k].plural }))]}
          />
        </div>
        {hasLevels && (
          <div className="flex items-center gap-2 text-xs text-faint">
            Sort by
            <Segmented
              size="sm"
              value={sortBy}
              onChange={setSortPick}
              options={[
                { value: 'level' as const, label: cat === 'item' && campaign.system === 'dnd5e' ? 'Rarity' : 'Level' },
                { value: 'name' as const, label: q ? 'Best match' : 'Name' },
              ]}
            />
          </div>
        )}
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
                {levelLabel(r) && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted tabular-nums">{levelLabel(r)}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
