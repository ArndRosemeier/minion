import { useState } from 'react'
import { BookOpen, Copy, Eye, EyeOff, HeartPulse, Minus, Plus, Shield, Swords, Trash2, X } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { useUI } from '@/state/ui'
import { resolveCreature } from '@/lib/creatures'
import { applyHp, COMMON_CONDITIONS, VALUED_CONDITIONS_PF2E } from '@/lib/mapOps'
import { newId } from '@/lib/id'
import { ActionChips } from '@/components/StatBlockView'
import { LinkChip } from '@/components/Markdown'
import { Button, IconButton, Input, Modal, cx } from '@/components/ui'
import type { MapState, Token } from '@/types'

export function TokenPanel({
  tokens,
  commit,
  onDeselect,
}: {
  tokens: Token[]
  commit: (fn: (s: MapState) => MapState) => void
  onDeselect: () => void
}) {
  const { campaign, index, compendiumVersion } = useCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const [amount, setAmount] = useState('')
  const [condOpen, setCondOpen] = useState(false)
  void compendiumVersion
  if (!tokens.length) return <p className="text-sm text-faint">Tap a token to select it. Use “multi” to select several.</p>

  const ids = new Set(tokens.map((t) => t.id))
  const patchAll = (fn: (t: Token) => Token) => commit((s) => ({ ...s, tokens: s.tokens.map((t) => (ids.has(t.id) ? fn(t) : t)) }))
  const n = Number(amount) || 0
  const t = tokens[0]
  const single = tokens.length === 1
  const creature = single && t.kind !== 'pc' && t.refId ? resolveCreature(t.refId, t.name.replace(/ \d+$/, ''), index, campaign.system) : null

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {single ? (
            <Input value={t.name} onChange={(e) => patchAll((x) => ({ ...x, name: e.target.value }))} className="font-medium" />
          ) : (
            <div className="font-medium">{tokens.length} tokens selected</div>
          )}
        </div>
        <IconButton label="Deselect" icon={<X />} onClick={onDeselect} />
      </div>

      {single && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="HP" value={t.hp !== undefined ? `${t.hp}${t.maxHp ? '/' + t.maxHp : ''}` : '—'} tone={t.hp !== undefined && t.hp <= 0 ? 'danger' : undefined} />
          <Stat label="Temp" value={t.tempHp ?? 0} />
          <Stat label="AC" value={t.ac ?? '—'} />
          <Stat label="Init" value={t.initiative ?? '—'} />
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex gap-2">
          <Input type="number" inputMode="numeric" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-center text-lg font-semibold" />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button size="sm" variant="danger" icon={<Swords className="size-4" />} disabled={!n} onClick={() => (patchAll((x) => applyHp(x, n, 'damage')), setAmount(''))}>
            Damage
          </Button>
          <Button size="sm" variant="danger" disabled={!n} onClick={() => (patchAll((x) => applyHp(x, n, 'half')), setAmount(''))}>
            ½
          </Button>
          <Button size="sm" className="border-success/30 bg-success/15 text-success hover:bg-success/25" icon={<HeartPulse className="size-4" />} disabled={!n} onClick={() => (patchAll((x) => applyHp(x, n, 'heal')), setAmount(''))}>
            Heal
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" icon={<Shield className="size-4" />} disabled={!n} onClick={() => (patchAll((x) => ({ ...x, tempHp: n })), setAmount(''))}>
            Set temp HP
          </Button>
          {single && (
            <Button size="sm" variant="ghost" disabled={!n} onClick={() => (patchAll((x) => ({ ...x, maxHp: n, hp: x.hp === undefined ? n : x.hp })), setAmount(''))}>
              Set max HP
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold tracking-widest text-faint uppercase">Conditions</div>
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setCondOpen(true)}>
            Add
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {single &&
            t.conditions.map((c) => (
              <span key={c.name} className="inline-flex items-center gap-1 rounded-lg border border-[#f08fb0]/40 bg-[#f08fb0]/10 py-0.5 pr-1 pl-1">
                <LinkChip target={`condition:${c.name}`} className="!border-0 !bg-transparent">
                  {c.name}
                </LinkChip>
                {c.value !== undefined && (
                  <>
                    <button className="rounded px-1 text-muted hover:text-ink" onClick={() => patchAll((x) => ({ ...x, conditions: x.conditions.map((y) => (y.name === c.name ? { ...y, value: Math.max(1, (y.value ?? 1) - 1) } : y)) }))}>
                      <Minus className="size-3" />
                    </button>
                    <b className="text-sm">{c.value}</b>
                    <button className="rounded px-1 text-muted hover:text-ink" onClick={() => patchAll((x) => ({ ...x, conditions: x.conditions.map((y) => (y.name === c.name ? { ...y, value: (y.value ?? 0) + 1 } : y)) }))}>
                      <Plus className="size-3" />
                    </button>
                  </>
                )}
                <button className="rounded px-0.5 text-muted hover:text-danger" onClick={() => patchAll((x) => ({ ...x, conditions: x.conditions.filter((y) => y.name !== c.name) }))}>
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          {single && !t.conditions.length && <span className="text-sm text-faint">None</span>}
        </div>
      </div>

      {creature?.stats && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold tracking-widest text-faint uppercase">Actions & spells</div>
            <Button
              size="sm"
              variant="ghost"
              icon={<BookOpen className="size-4" />}
              onClick={() => openDetail(creature.source === 'campaign' ? { kind: 'entity', id: creature.refId } : { kind: 'ref', id: creature.refId, system: campaign.system })}
            >
              Stat block
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-3 text-xs text-muted">
            <span>
              Speed <b className="text-ink">{creature.stats.speed}</b>
            </span>
            {creature.stats.saves?.map((s) => (
              <span key={s.name}>
                {s.name} <b className="text-ink">{s.value >= 0 ? '+' : ''}{s.value}</b>
              </span>
            ))}
            {creature.stats.perception !== undefined && (
              <span>
                Perc <b className="text-ink">+{creature.stats.perception}</b>
              </span>
            )}
          </div>
          {(creature.stats.resistances || creature.stats.weaknesses || creature.stats.immunities) && (
            <div className="text-xs text-muted">
              {creature.stats.immunities && <div>Imm: {creature.stats.immunities}</div>}
              {creature.stats.resistances && <div>Res: {creature.stats.resistances}</div>}
              {creature.stats.weaknesses && <div>Weak: {creature.stats.weaknesses}</div>}
            </div>
          )}
          <ActionChips stats={creature.stats} system={campaign.system} owner={t.name} />
        </div>
      )}
      {single && t.kind === 'pc' && (
        <p className="text-xs text-faint">Player character — the player tracks the rest on their sheet.</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button size="sm" variant="ghost" icon={t.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} onClick={() => patchAll((x) => ({ ...x, hidden: !t.hidden }))}>
          {t.hidden ? 'Reveal' : 'Hide'}
        </Button>
        {single && (
          <>
            <Button size="sm" variant="ghost" onClick={() => patchAll((x) => ({ ...x, size: x.size >= 4 ? 1 : x.size + 1 }))}>
              Size {t.size}×{t.size}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-4" />}
              onClick={() => commit((s) => ({ ...s, tokens: [...s.tokens, { ...t, id: newId('tok'), x: t.x + 1, name: `${t.name.replace(/ \d+$/, '')} ${s.tokens.filter((x) => x.refId === t.refId).length + 1}`, initiative: undefined }] }))}
            >
              Duplicate
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 className="size-4" />}
          onClick={() => {
            commit((s) => ({ ...s, tokens: s.tokens.filter((x) => !ids.has(x.id)) }))
            onDeselect()
          }}
        >
          Remove
        </Button>
      </div>
      <ConditionPicker
        open={condOpen}
        onClose={() => setCondOpen(false)}
        onPick={(name) =>
          patchAll((x) => ({
            ...x,
            conditions: x.conditions.some((c) => c.name === name)
              ? x.conditions
              : [...x.conditions, { name, value: campaign.system === 'pf2e' && VALUED_CONDITIONS_PF2E.includes(name.toLowerCase()) ? 1 : undefined }],
          }))
        }
      />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'danger' }) {
  return (
    <div className="rounded-lg bg-surface-2 py-1.5">
      <div className="text-[10px] text-faint uppercase">{label}</div>
      <div className={cx('text-lg font-semibold tabular-nums', tone === 'danger' && 'text-danger')}>{value}</div>
    </div>
  )
}

function ConditionPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (name: string) => void }) {
  const { campaign } = useCampaign()
  const [custom, setCustom] = useState('')
  return (
    <Modal open={open} onClose={onClose} title="Add condition">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {COMMON_CONDITIONS[campaign.system].map((c) => (
            <button
              key={c}
              onClick={() => {
                onPick(c)
                onClose()
              }}
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm hover:border-[#f08fb0]/60 hover:bg-[#f08fb0]/10"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="Custom (e.g. Bless, Hunted Prey)" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button
            disabled={!custom.trim()}
            onClick={() => {
              onPick(custom.trim())
              setCustom('')
              onClose()
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </Modal>
  )
}
