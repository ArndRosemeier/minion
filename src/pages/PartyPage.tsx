import { Plus, Trash2, Upload, Users } from 'lucide-react'
import { useRef } from 'react'
import { useCampaign } from '@/state/campaign'
import { saveAsset, updateCampaign } from '@/db/repo'
import { newId } from '@/lib/id'
import { AssetImage } from '@/components/AssetImage'
import { Button, Empty, Field, IconButton, LiveInput } from '@/components/ui'
import type { PartyMember } from '@/types'

const COLORS = ['#4f9dde', '#58b368', '#d9a441', '#b06ad9', '#de6a5a', '#4fc2c2', '#d96aa8', '#8c9bab']

export function PartyPage() {
  const { campaign } = useCampaign()
  const party = campaign.party
  const save = (p: PartyMember[]) => updateCampaign(campaign.id, { party: p, partySize: p.length || campaign.partySize })
  const set = (id: string, patch: Partial<PartyMember>) => save(party.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const add = () => save([...party, { id: newId('pc'), name: `Hero ${party.length + 1}`, initBonus: 0, color: COLORS[party.length % COLORS.length] }])

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5 p-5 lg:px-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Party</h1>
            <p className="text-sm text-muted">Players keep their own sheets. Minion only needs initiative bonus, and optionally HP and AC, for the battle tracker.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={add}>
            Add character
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-4">
          <Field label="Party level" className="w-32">
            <LiveInput type="number" min={1} max={20} value={campaign.partyLevel} onCommit={(v) => updateCampaign(campaign.id, { partyLevel: Number(v) || 1 })} />
          </Field>
          <Field label="Party size" className="w-32">
            <LiveInput type="number" min={1} max={10} value={campaign.partySize} onCommit={(v) => updateCampaign(campaign.id, { partySize: Number(v) || 1 })} />
          </Field>
        </div>
        {party.length === 0 && (
          <Empty icon={<Users />} title="No characters yet">
            Add the player characters so they can be placed on battle maps with one tap.
          </Empty>
        )}
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]">
          {party.map((m) => (
            <MemberCard key={m.id} m={m} onChange={(p) => set(m.id, p)} onRemove={() => save(party.filter((x) => x.id !== m.id))} />
          ))}
        </div>
      </div>
    </div>
  )
}

function MemberCard({ m, onChange, onRemove }: { m: PartyMember; onChange: (p: Partial<PartyMember>) => void; onRemove: () => void }) {
  const { campaign } = useCampaign()
  const file = useRef<HTMLInputElement>(null)
  const num = (v: string) => (v === '' ? undefined : Number(v))
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <button onClick={() => file.current?.click()} className="relative size-14 shrink-0 overflow-hidden rounded-full border-2" style={{ borderColor: m.color }} title="Token image">
          {m.image ? (
            <AssetImage id={m.image} className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-lg font-bold" style={{ background: m.color + '33', color: m.color }}>
              {m.name.slice(0, 2)}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 flex justify-center bg-black/50 py-0.5">
            <Upload className="size-3" />
          </span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) onChange({ image: (await saveAsset(f, campaign.id)).id })
          }}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <LiveInput value={m.name} onCommit={(v) => onChange({ name: v })} className="font-medium" />
          <LiveInput value={m.description ?? ''} placeholder="Ancestry Class Level" onCommit={(v) => onChange({ description: v })} className="h-8 text-sm" />
        </div>
        <IconButton label="Remove" icon={<Trash2 />} onClick={onRemove} />
      </div>
      <div className="grid grid-cols-5 gap-2">
        <Field label="Init" className="col-span-1">
          <LiveInput type="number" value={m.initBonus} onCommit={(v) => onChange({ initBonus: Number(v) || 0 })} className="px-2 text-center" />
        </Field>
        <Field label="HP" className="col-span-1">
          <LiveInput type="number" value={m.maxHp ?? ''} onCommit={(v) => onChange({ maxHp: num(v) })} className="px-2 text-center" />
        </Field>
        <Field label="AC" className="col-span-1">
          <LiveInput type="number" value={m.ac ?? ''} onCommit={(v) => onChange({ ac: num(v) })} className="px-2 text-center" />
        </Field>
        <Field label="Player" className="col-span-2">
          <LiveInput value={m.player ?? ''} onCommit={(v) => onChange({ player: v })} />
        </Field>
      </div>
      <div className="flex gap-1.5">
        {COLORS.map((c) => (
          <button key={c} onClick={() => onChange({ color: c })} className="size-6 rounded-full border-2" style={{ background: c, borderColor: c === m.color ? '#fff' : 'transparent' }} />
        ))}
      </div>
    </div>
  )
}
