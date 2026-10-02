import { useMemo, useState } from 'react'
import { BookOpen, Search, User } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { levelLabel, searchCreatures, type CreatureInfo } from '@/lib/creatures'
import { Input, cx } from './ui'

export function CreaturePicker({ onPick, autoFocus, className }: { onPick: (c: CreatureInfo) => void; autoFocus?: boolean; className?: string }) {
  const { entities, campaign, compendiumVersion } = useCampaign()
  const [q, setQ] = useState('')
  const results = useMemo(
    () => searchCreatures(q, entities, campaign.system, 60),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, entities, campaign.system, compendiumVersion],
  )
  return (
    <div className={cx('flex min-h-0 flex-col gap-2', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <Input autoFocus={autoFocus} className="pl-9" placeholder="Search creatures & NPCs…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {results.map((c) => (
          <button
            key={c.source + c.refId}
            onClick={() => onPick(c)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-3"
          >
            {c.source === 'campaign' ? <User className="size-4 text-t-npc" /> : <BookOpen className="size-4 text-faint" />}
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            {!c.stats && <span className="text-xs text-faint">no stats</span>}
            <span className="text-xs font-semibold text-accent">{levelLabel(campaign.system, c.stats)}</span>
            {c.stats && <span className="w-14 text-right text-xs text-muted">{c.stats.hp} HP</span>}
          </button>
        ))}
        {!results.length && <div className="p-4 text-center text-sm text-faint">Nothing found.</div>}
      </div>
    </div>
  )
}
