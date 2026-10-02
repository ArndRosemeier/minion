import { useState } from 'react'
import { ChevronLeft, ChevronRight, Dices, Flag, Play, Square } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { initiativeOrder, nextTurn, prevTurn, rollD20 } from '@/lib/mapOps'
import { signed } from '@/lib/dice'
import { Button, IconButton, Input, Modal, cx } from '@/components/ui'
import type { MapState, Token } from '@/types'

export function InitiativePanel({
  state,
  commit,
  selection,
  onPick,
}: {
  state: MapState
  commit: (fn: (s: MapState) => MapState) => void
  selection: string[]
  onPick: (t: Token) => void
}) {
  const { campaign } = useCampaign()
  const [starting, setStarting] = useState(false)
  const order = initiativeOrder(state)
  const waiting = state.tokens.filter((t) => t.initiative === undefined && t.kind !== 'object')

  const setInit = (id: string, v: number | undefined) => commit((s) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, initiative: v } : t)) }))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {state.combat.active ? (
          <>
            <div className="flex-1">
              <div className="text-xs text-faint uppercase">Round</div>
              <div className="font-display text-2xl leading-none text-accent">{state.combat.round}</div>
            </div>
            <IconButton label="Previous turn" icon={<ChevronLeft />} onClick={() => commit((s) => prevTurn(s))} />
            <Button variant="primary" icon={<ChevronRight className="size-4" />} onClick={() => commit((s) => nextTurn(s, campaign.system))}>
              Next
            </Button>
            <IconButton
              label="End combat"
              icon={<Square />}
              onClick={() => commit((s) => ({ ...s, combat: { active: false, round: 0 }, tokens: s.tokens.map((t) => ({ ...t, initiative: undefined })) }))}
            />
          </>
        ) : (
          <Button variant="primary" className="w-full" icon={<Play className="size-4" />} onClick={() => setStarting(true)} disabled={!state.tokens.length}>
            Start combat
          </Button>
        )}
      </div>

      <div className="space-y-1">
        {order.map((t) => (
          <InitRow
            key={t.id}
            t={t}
            active={state.combat.active && state.combat.turnId === t.id}
            selected={selection.includes(t.id)}
            onClick={() => onPick(t)}
            onInit={(v) => setInit(t.id, v)}
          />
        ))}
      </div>
      {waiting.length > 0 && state.combat.active && (
        <div className="space-y-1">
          <div className="text-[10px] font-bold tracking-widest text-faint uppercase">Not in initiative</div>
          {waiting.map((t) => (
            <InitRow key={t.id} t={t} active={false} selected={selection.includes(t.id)} onClick={() => onPick(t)} onInit={(v) => setInit(t.id, v)} />
          ))}
          <Button
            size="sm"
            variant="ghost"
            icon={<Dices className="size-4" />}
            onClick={() =>
              commit((s) => ({
                ...s,
                tokens: s.tokens.map((t) => (t.initiative === undefined && t.kind !== 'pc' && t.kind !== 'object' ? { ...t, initiative: rollD20() + (t.initBonus ?? 0) } : t)),
              }))
            }
          >
            Roll for creatures
          </Button>
        </div>
      )}
      {!state.tokens.length && <p className="text-sm text-faint">Add the party and creatures to the map first.</p>}
      <StartCombatModal open={starting} onClose={() => setStarting(false)} state={state} commit={commit} />
    </div>
  )
}

function InitRow({ t, active, selected, onClick, onInit }: { t: Token; active: boolean; selected: boolean; onClick: () => void; onInit: (v: number | undefined) => void }) {
  const dead = t.hp !== undefined && t.hp <= 0
  return (
    <div
      onClick={onClick}
      className={cx(
        'flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5',
        active ? 'border-accent bg-accent/15' : selected ? 'border-info/60 bg-info/10' : 'border-transparent hover:bg-surface-2',
        dead && 'opacity-50',
      )}
    >
      {active && <Flag className="size-3.5 shrink-0 text-accent" />}
      <span className="size-3 shrink-0 rounded-full" style={{ background: t.color }} />
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-sm', t.hidden && 'italic text-muted')}>{t.name}</div>
        {t.conditions.length > 0 && <div className="truncate text-[11px] text-[#f08fb0]">{t.conditions.map((c) => `${c.name}${c.value ? ' ' + c.value : ''}`).join(', ')}</div>}
      </div>
      {t.hp !== undefined && (
        <span className={cx('text-xs tabular-nums', dead ? 'text-danger' : 'text-muted')}>
          {t.hp}
          {t.maxHp ? `/${t.maxHp}` : ''}
        </span>
      )}
      <input
        type="number"
        value={t.initiative ?? ''}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onInit(e.target.value === '' ? undefined : Number(e.target.value))}
        className="h-8 w-12 rounded-md border border-line bg-surface px-1 text-center text-sm font-semibold text-ink"
      />
    </div>
  )
}

function StartCombatModal({ open, onClose, state, commit }: { open: boolean; onClose: () => void; state: MapState; commit: (fn: (s: MapState) => MapState) => void }) {
  const { campaign } = useCampaign()
  const pcs = state.tokens.filter((t) => t.kind === 'pc')
  const [rolls, setRolls] = useState<Record<string, string>>({})
  const start = () => {
    commit((s) => {
      const tokens = s.tokens.map((t) => {
        if (t.kind === 'object') return t
        if (t.kind === 'pc') {
          const v = rolls[t.id]
          return { ...t, initiative: v !== undefined && v !== '' ? Number(v) : t.initiative ?? rollD20() + (t.initBonus ?? 0) }
        }
        return { ...t, initiative: rollD20() + (t.initBonus ?? 0) }
      })
      const next = { ...s, tokens, combat: { active: true, round: 1, turnId: undefined } }
      return nextTurn(next, campaign.system)
    })
    setRolls({})
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Roll initiative"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Play className="size-4" />} onClick={start}>
            Fight!
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">Enter the players’ initiative results (leave empty to roll for them). All creatures roll automatically with their bonus.</p>
        {pcs.map((t) => (
          <div key={t.id} className="flex items-center gap-3">
            <span className="size-3 rounded-full" style={{ background: t.color }} />
            <span className="flex-1 text-sm">{t.name}</span>
            <span className="text-xs text-faint">{signed(t.initBonus ?? 0)}</span>
            <Input
              type="number"
              inputMode="numeric"
              className="w-20 text-center"
              placeholder="roll"
              value={rolls[t.id] ?? ''}
              onChange={(e) => setRolls({ ...rolls, [t.id]: e.target.value })}
            />
          </div>
        ))}
        {!pcs.length && <p className="text-sm text-faint">No player characters on the map.</p>}
      </div>
    </Modal>
  )
}
