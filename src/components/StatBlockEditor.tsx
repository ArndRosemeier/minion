import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { ActionKind, GameSystem, StatAction, StatBlock } from '@/types'
import { Button, Field, IconButton, Input, Select, Textarea } from './ui'

export const blankStats = (system: GameSystem, level = 1): StatBlock => ({
  level: system === 'pf2e' ? level : undefined,
  cr: system === 'dnd5e' ? String(level) : undefined,
  size: 'Medium',
  traits: [],
  ac: system === 'pf2e' ? 15 + level : 13,
  hp: system === 'pf2e' ? 15 + level * 15 : 20,
  initiative: system === 'pf2e' ? 5 + level : 1,
  perception: system === 'pf2e' ? 5 + level : undefined,
  speed: system === 'pf2e' ? '25 feet' : '30 ft.',
  saves: system === 'pf2e' ? [{ name: 'Fort', value: 5 + level }, { name: 'Ref', value: 5 + level }, { name: 'Will', value: 5 + level }] : [],
  abilities: system === 'pf2e' ? { str: 2, dex: 2, con: 2, int: 0, wis: 1, cha: 0 } : { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
  actions: [],
})

const KINDS: ActionKind[] = ['action', 'reaction', 'free', 'bonus', 'legendary', 'passive', 'spell']

const num = (v: string) => (v === '' || isNaN(Number(v)) ? 0 : Number(v))

export function StatBlockEditor({ value, onChange, system }: { value: StatBlock; onChange: (s: StatBlock) => void; system: GameSystem }) {
  const set = (patch: Partial<StatBlock>) => onChange({ ...value, ...patch })
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const setAction = (i: number, patch: Partial<StatAction>) => set({ actions: value.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) })
  const moveAction = (i: number, d: number) => {
    const a = [...value.actions]
    const j = i + d
    if (j < 0 || j >= a.length) return
    ;[a[i], a[j]] = [a[j], a[i]]
    set({ actions: a })
  }
  const ab = value.abilities ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {system === 'pf2e' ? (
          <Field label="Level">
            <Input type="number" value={value.level ?? 0} onChange={(e) => set({ level: num(e.target.value) })} />
          </Field>
        ) : (
          <Field label="CR">
            <Input value={value.cr ?? ''} onChange={(e) => set({ cr: e.target.value })} />
          </Field>
        )}
        <Field label="AC">
          <Input type="number" value={value.ac} onChange={(e) => set({ ac: num(e.target.value) })} />
        </Field>
        <Field label="HP">
          <Input type="number" value={value.hp} onChange={(e) => set({ hp: num(e.target.value) })} />
        </Field>
        <Field label="Initiative bonus">
          <Input type="number" value={value.initiative} onChange={(e) => set({ initiative: num(e.target.value) })} />
        </Field>
        {system === 'pf2e' && (
          <Field label="Perception">
            <Input type="number" value={value.perception ?? 0} onChange={(e) => set({ perception: num(e.target.value), initiative: num(e.target.value) })} />
          </Field>
        )}
        <Field label="Size">
          <Input value={value.size ?? ''} onChange={(e) => set({ size: e.target.value })} />
        </Field>
        <Field label="Speed" className="col-span-2">
          <Input value={value.speed ?? ''} onChange={(e) => set({ speed: e.target.value })} />
        </Field>
      </div>
      <Field label={system === 'pf2e' ? 'Traits (comma separated)' : 'Type / tags (comma separated)'}>
        <Input
          value={(value.traits ?? []).join(', ')}
          onChange={(e) => set({ traits: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="Saves (e.g. Fort +8, Ref +6, Will +4)">
        <Input
          defaultValue={(value.saves ?? []).map((s) => `${s.name} ${s.value >= 0 ? '+' : ''}${s.value}`).join(', ')}
          onBlur={(e) =>
            set({
              saves: e.target.value
                .split(',')
                .map((p) => p.trim().match(/^(.+?)\s*([+-]?\d+)$/))
                .filter(Boolean)
                .map((m) => ({ name: m![1], value: Number(m![2]) })),
            })
          }
        />
      </Field>
      <div>
        <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
          Abilities {system === 'pf2e' ? '(modifiers)' : '(scores)'}
        </div>
        <div className="grid grid-cols-6 gap-2">
          {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => (
            <label key={k} className="text-center">
              <span className="text-xs font-semibold text-faint uppercase">{k}</span>
              <Input type="number" className="px-1 text-center" value={ab[k]} onChange={(e) => set({ abilities: { ...ab, [k]: num(e.target.value) } })} />
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ['skills', 'Skills'],
            ['senses', 'Senses'],
            ['languages', 'Languages'],
            ['immunities', 'Immunities'],
            ['resistances', 'Resistances'],
            ['weaknesses', 'Weaknesses'],
            ['other', 'Other'],
            ['spellcasting', 'Spellcasting line'],
          ] as const
        ).map(([k, label]) => (
          <Field key={k} label={label}>
            <Input value={(value[k] as string) ?? ''} onChange={(e) => set({ [k]: e.target.value })} />
          </Field>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold tracking-wide text-muted uppercase">Actions, abilities & spells</div>
          <Button
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => {
              set({ actions: [...value.actions, { name: 'New action', kind: 'action', cost: 1 }] })
              setOpenIdx(value.actions.length)
            }}
          >
            Add
          </Button>
        </div>
        {value.actions.map((a, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-2">
            <div className="flex items-center gap-2 px-3 py-2">
              <button className="min-w-0 flex-1 truncate text-left text-sm" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
                <span className="mr-2 rounded bg-surface-3 px-1.5 py-0.5 text-[11px] text-muted uppercase">{a.kind}</span>
                {a.name}
                {a.attack && <span className="ml-2 text-accent">{a.attack}</span>}
              </button>
              <IconButton size="sm" label="Up" icon={<ArrowUp />} onClick={() => moveAction(i, -1)} />
              <IconButton size="sm" label="Down" icon={<ArrowDown />} onClick={() => moveAction(i, 1)} />
              <IconButton size="sm" label="Remove" icon={<Trash2 />} onClick={() => set({ actions: value.actions.filter((_, j) => j !== i) })} />
            </div>
            {openIdx === i && (
              <div className="grid gap-3 border-t border-line p-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={a.name} onChange={(e) => setAction(i, { name: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Kind">
                    <Select value={a.kind} onChange={(e) => setAction(i, { kind: e.target.value as ActionKind })}>
                      {KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </Select>
                  </Field>
                  {a.kind === 'spell' ? (
                    <Field label="Rank / level">
                      <Input type="number" value={a.spellLevel ?? ''} onChange={(e) => setAction(i, { spellLevel: num(e.target.value) })} />
                    </Field>
                  ) : (
                    <Field label="Cost">
                      <Input type="number" value={a.cost ?? ''} onChange={(e) => setAction(i, { cost: num(e.target.value) || undefined })} />
                    </Field>
                  )}
                </div>
                {a.kind === 'spell' ? (
                  <Field label="Frequency" className="sm:col-span-2">
                    <Input placeholder="at will, 3/day, cantrip…" value={a.frequency ?? ''} onChange={(e) => setAction(i, { frequency: e.target.value })} />
                  </Field>
                ) : (
                  <>
                    <Field label="Attack bonus">
                      <Input placeholder="+9" value={a.attack ?? ''} onChange={(e) => setAction(i, { attack: e.target.value || undefined })} />
                    </Field>
                    <Field label="Damage">
                      <Input placeholder="2d6+4 slashing" value={a.damage ?? ''} onChange={(e) => setAction(i, { damage: e.target.value || undefined })} />
                    </Field>
                    <Field label="Save">
                      <Input placeholder="DC 18 basic Reflex" value={a.save ?? ''} onChange={(e) => setAction(i, { save: e.target.value || undefined })} />
                    </Field>
                    <Field label="Traits">
                      <Input
                        value={(a.traits ?? []).join(', ')}
                        onChange={(e) => setAction(i, { traits: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                      />
                    </Field>
                  </>
                )}
                <Field label="Text" className="sm:col-span-2">
                  <Textarea minRows={2} value={a.text ?? ''} onChange={(e) => setAction(i, { text: e.target.value })} />
                </Field>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
