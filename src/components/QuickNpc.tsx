import { useState } from 'react'
import { Dices, Shield, Sparkles, UserPlus } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI, toast } from '@/state/ui'
import { createEntity, userCtx } from '@/db/repo'
import { generateEntityData } from '@/ai/generate'
import { ANCESTRIES, npcToMarkdown, randomNpc, type RandomNpc } from '@/lib/randomNpc'
import { CreaturePicker } from './CreaturePicker'
import { Markdown } from './Markdown'
import { Button, Field, Input, Modal, Segmented, Select, Textarea, Toggle } from './ui'
import type { StatBlock } from '@/types'

export function QuickNpcModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { campaign, entities } = useCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const [mode, setMode] = useState<'random' | 'ai'>('random')
  const [ancestry, setAncestry] = useState('')
  const [npc, setNpc] = useState<RandomNpc>(() => randomNpc())
  const [stats, setStats] = useState<{ name: string; stats: StatBlock } | null>(null)
  const [picking, setPicking] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [withStats, setWithStats] = useState(false)
  const [busy, setBusy] = useState(false)

  const finish = (id: string) => {
    onClose()
    if (onCreated) onCreated(id)
    else openDetail({ kind: 'entity', id })
  }

  const saveRandom = async () => {
    const e = await createEntity(
      campaign.id,
      'npc',
      {
        name: npc.name,
        summary: `${npc.ancestry} ${npc.occupation}, ${npc.personality}`,
        body: npcToMarkdown(npc) + (stats ? `\n\nUses the stat block of [[${stats.name}]].` : ''),
        secrets: npc.secret[0].toUpperCase() + npc.secret.slice(1) + '.',
        tags: ['improvised'],
        stats: stats ? structuredClone(stats.stats) : undefined,
      },
      userCtx(),
    )
    finish(e.id)
  }

  const saveAi = async () => {
    setBusy(true)
    try {
      const data = await generateEntityData(campaign, entities, { type: 'npc', instructions: instructions || 'An interesting NPC the party meets right now.', withStats, fast: true })
      const e = await createEntity(campaign.id, 'npc', { ...data, tags: [...(data.tags ?? []), 'improvised'] }, userCtx())
      finish(e.id)
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="NPC on the fly"
      footer={
        mode === 'random' ? (
          <>
            <Button icon={<Dices className="size-4" />} onClick={() => setNpc(randomNpc(ancestry || undefined))}>
              Reroll
            </Button>
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={saveRandom}>
              Save NPC
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<Sparkles className="size-4" />} loading={busy} onClick={saveAi}>
            Generate NPC
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={setMode}
          size="sm"
          options={[
            { value: 'random', label: 'Random (offline)' },
            { value: 'ai', label: 'AI' },
          ]}
        />
        {mode === 'random' ? (
          <div className="space-y-3">
            <Select
              value={ancestry}
              onChange={(e) => {
                setAncestry(e.target.value)
                setNpc(randomNpc(e.target.value || undefined))
              }}
            >
              <option value="">Any ancestry</option>
              {ANCESTRIES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </Select>
            <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
              <Input value={npc.name} onChange={(e) => setNpc({ ...npc, name: e.target.value })} className="font-display text-lg" />
              <Markdown text={npcToMarkdown(npc)} autoLink={false} className="text-sm" />
              <div className="text-sm text-danger/90">
                <b>Secret:</b> {npc.secret}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Shield className="size-4" />} onClick={() => setPicking(true)}>
                {stats ? `Stats: ${stats.name}` : 'Add stat block…'}
              </Button>
              {stats && (
                <Button size="sm" variant="ghost" onClick={() => setStats(null)}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="What do you need?">
              <Textarea minRows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="The captain of the city watch, bribable, knows about the smugglers…" />
            </Field>
            <Toggle checked={withStats} onChange={setWithStats} label="Include a stat block" />
          </div>
        )}
      </div>
      <Modal open={picking} onClose={() => setPicking(false)} title="Stat block template">
        <CreaturePicker
          autoFocus
          className="h-[60vh]"
          onPick={(c) => {
            if (c.stats) setStats({ name: c.name, stats: c.stats })
            setPicking(false)
          }}
        />
      </Modal>
    </Modal>
  )
}
