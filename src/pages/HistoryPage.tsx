import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bot, History, Undo2, User } from 'lucide-react'
import { db } from '@/db/db'
import { undoBatch, undoChange } from '@/db/repo'
import { useCampaign } from '@/state/campaign'
import { Button, Empty, IconButton, cx } from '@/components/ui'
import { LinkChip } from '@/components/Markdown'
import type { ChangeRecord } from '@/types'

export function HistoryPage() {
  const { campaign } = useCampaign()
  const changes = useLiveQuery(
    () => db.changes.where('campaignId').equals(campaign.id).reverse().sortBy('createdAt').then((c) => c.slice(0, 600)),
    [campaign.id],
  )
  const batches = useMemo(() => {
    const m = new Map<string, ChangeRecord[]>()
    for (const c of changes ?? []) {
      if (!m.has(c.batchId)) m.set(c.batchId, [])
      m.get(c.batchId)!.push(c)
    }
    return [...m.entries()]
  }, [changes])

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-4 p-5 lg:px-8">
        <div>
          <h1 className="font-display text-2xl">History</h1>
          <p className="text-sm text-muted">Every change to entries, maps and settings — by you or the AI — can be undone here.</p>
        </div>
        {batches.length === 0 && <Empty icon={<History />} title="No changes yet" />}
        <div className="columns-[30rem] gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {batches.map(([batchId, list]) => {
          const allUndone = list.every((c) => c.undone)
          const ai = list[0].source === 'ai'
          return (
            <div key={batchId} className="rounded-xl border border-line bg-surface">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                {ai ? <Bot className="size-4 text-accent" /> : <User className="size-4 text-muted" />}
                <span className="flex-1 text-sm text-muted">
                  {ai ? 'AI' : 'You'} · {new Date(list[0].createdAt).toLocaleString()} · {list.length} change{list.length > 1 ? 's' : ''}
                </span>
                {!allUndone && list.length > 1 && (
                  <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => undoBatch(batchId)}>
                    Undo all
                  </Button>
                )}
              </div>
              <div className="divide-y divide-line">
                {list.map((c) => (
                  <div key={c.id} className={cx('flex items-center gap-2 px-4 py-2 text-sm', c.undone && 'opacity-45')}>
                    <span className={cx('flex-1', c.undone && 'line-through')}>{c.label}</span>
                    {c.table === 'entities' && c.after !== undefined && !c.undone && <LinkChip target={`id:${c.recordId}`}>open</LinkChip>}
                    {!c.undone && <IconButton size="sm" label="Undo" icon={<Undo2 />} onClick={() => undoChange(c.id)} />}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}
