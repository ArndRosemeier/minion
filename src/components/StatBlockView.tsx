import { useState } from 'react'
import { Dices } from 'lucide-react'
import type { GameSystem, StatAction, StatBlock } from '@/types'
import { abilityMod, attackFormula, damageFormula, signed } from '@/lib/dice'
import { useUI } from '@/state/ui'
import { LinkChip, Markdown } from './Markdown'
import { cx } from './ui'

export function ActionGlyph({ action, system }: { action: StatAction; system: GameSystem }) {
  if (system !== 'pf2e') return null
  const cls = 'inline-flex items-center text-accent font-bold text-[0.8em] leading-none'
  if (action.kind === 'reaction') return <span className={cls} title="Reaction">⟲</span>
  if (action.kind === 'free') return <span className={cls} title="Free action">◇</span>
  if (action.kind === 'action' || action.kind === 'legendary') {
    const n = Math.max(1, Math.min(3, action.cost ?? 1))
    return (
      <span className={cls} title={`${n} action${n > 1 ? 's' : ''}`}>
        {'◆'.repeat(n)}
      </span>
    )
  }
  return null
}

const KIND_LABEL: Record<string, string> = {
  action: 'Actions',
  bonus: 'Bonus Actions',
  reaction: 'Reactions',
  free: 'Free Actions',
  legendary: 'Legendary Actions',
  passive: 'Abilities',
  spell: 'Spells',
}

function RollButton({ formula, label }: { formula: string | null; label: string }) {
  const openDice = useUI((s) => s.openDice)
  if (!formula) return null
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        openDice({ formula, label })
      }}
      className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent hover:bg-accent/20"
    >
      <Dices className="size-3.5" />
      {formula}
    </button>
  )
}

export function ActionDetail({ action, system, owner }: { action: StatAction; system: GameSystem; owner?: string }) {
  const atk = attackFormula(action.attack)
  const dmg = damageFormula(action.damage)
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-ink">{action.name}</span>
        <ActionGlyph action={action} system={system} />
        {action.frequency && <span className="text-xs text-muted">({action.frequency})</span>}
        {action.traits?.map((t) => (
          <LinkChip key={t} target={`trait:${t}`} className="text-[11px]">
            {t}
          </LinkChip>
        ))}
      </div>
      {(action.attack || action.damage || action.save) && (
        <div className="flex flex-wrap items-center gap-2 text-muted">
          {action.attack && (
            <span>
              Attack <b className="text-ink">{action.attack}</b>
            </span>
          )}
          {atk && <RollButton formula={atk} label={`${owner ? owner + ': ' : ''}${action.name} attack`} />}
          {action.damage && (
            <span>
              Damage <b className="text-ink">{action.damage}</b>
            </span>
          )}
          {dmg && <RollButton formula={dmg} label={`${owner ? owner + ': ' : ''}${action.name} damage`} />}
          {action.save && <span className="text-ink">{action.save}</span>}
        </div>
      )}
      {action.text && <Markdown text={action.text} className="text-sm" autoLink={false} />}
    </div>
  )
}

/** Actions/spells as tappable chips; tapping expands details inline. */
export function ActionChips({ stats, system, owner }: { stats: StatBlock; system: GameSystem; owner?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const actions = stats.actions || []
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a, i) =>
          a.kind === 'spell' ? (
            <LinkChip key={i} target={`spell:${a.name}`} className="text-sm leading-7">
              {a.name}
              {a.frequency ? ` (${a.frequency})` : ''}
            </LinkChip>
          ) : (
            <button
              key={i}
              onClick={() => setOpen(open === i ? null : i)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors',
                open === i ? 'border-accent bg-accent/15 text-ink' : 'border-line-strong bg-surface-2 text-ink hover:bg-surface-3',
                a.kind === 'passive' && 'border-dashed',
              )}
            >
              <ActionGlyph action={a} system={system} />
              {a.kind === 'reaction' && system !== 'pf2e' && <span className="text-xs text-accent">R</span>}
              {a.name}
              {a.attack && <span className="text-xs font-semibold text-accent">{a.attack.split(' ')[0]}</span>}
            </button>
          ),
        )}
      </div>
      {open !== null && actions[open] && (
        <div className="anim-fade rounded-lg border border-line bg-surface-2 p-3">
          <ActionDetail action={actions[open]} system={system} owner={owner} />
        </div>
      )}
    </div>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === undefined || children === null || children === '') return null
  return (
    <div>
      <b className="text-ink">{label}</b> <span className="text-muted">{children}</span>
    </div>
  )
}

export function StatBlockView({ stats, system, name }: { stats: StatBlock; system: GameSystem; name?: string }) {
  const ab = stats.abilities
  const groups = new Map<string, StatAction[]>()
  for (const a of stats.actions || []) {
    const k = a.kind === 'free' ? 'action' : a.kind
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(a)
  }
  const order = ['passive', 'action', 'bonus', 'reaction', 'legendary', 'spell']
  return (
    <div className="space-y-3 rounded-xl border border-[#5a4630] bg-gradient-to-b from-[#221c16] to-[#1c1814] p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#5a4630] pb-2">
        <div className="font-display text-lg text-accent-strong">{name}</div>
        <div className="font-display text-sm text-accent">
          {system === 'pf2e' ? `Creature ${stats.level ?? '?'}` : `CR ${stats.cr ?? '?'}`}
        </div>
      </div>
      {(stats.traits?.length || stats.size) && (
        <div className="flex flex-wrap gap-1">
          {stats.alignment && <span className="rounded bg-[#5a2a1e] px-1.5 text-xs font-semibold text-white uppercase">{stats.alignment}</span>}
          {stats.size && <span className="rounded bg-[#3d5a2e] px-1.5 text-xs font-semibold text-white uppercase">{stats.size}</span>}
          {stats.traits?.map((t) =>
            system === 'pf2e' ? (
              <LinkChip key={t} target={`trait:${t}`} className="text-xs uppercase">
                {t}
              </LinkChip>
            ) : (
              <span key={t} className="rounded bg-surface-3 px-1.5 text-xs text-muted">
                {t}
              </span>
            ),
          )}
        </div>
      )}
      <div className="space-y-0.5">
        <Line label={system === 'pf2e' ? 'Perception' : 'Initiative'}>
          {system === 'pf2e' ? signed(stats.perception ?? stats.initiative) : signed(stats.initiative)}
          {stats.senses ? `; ${stats.senses}` : ''}
        </Line>
        {system !== 'pf2e' && <Line label="Senses">{stats.senses}</Line>}
        <Line label="Languages">{stats.languages}</Line>
        <Line label="Skills">{stats.skills}</Line>
        {ab && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => (
              <span key={k}>
                <b className="text-ink uppercase">{k}</b>{' '}
                <span className="text-muted">{system === 'pf2e' ? signed(ab[k]) : `${ab[k]} (${signed(abilityMod(ab[k]))})`}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-0.5 border-t border-[#5a4630] pt-2">
        <div className="flex flex-wrap gap-x-3">
          <span>
            <b className="text-ink">AC</b> <span className="text-muted">{stats.ac}{stats.acNote ? ` (${stats.acNote})` : ''}</span>
          </span>
          {stats.saves?.map((s) => (
            <span key={s.name}>
              <b className="text-ink">{s.name}</b> <span className="text-muted">{signed(s.value)}</span>
            </span>
          ))}
        </div>
        <Line label="HP">
          {stats.hp}
          {stats.hpNote ? `; ${stats.hpNote}` : ''}
        </Line>
        <Line label="Immunities">{stats.immunities}</Line>
        <Line label="Resistances">{stats.resistances}</Line>
        <Line label="Weaknesses">{stats.weaknesses}</Line>
        <Line label="Other">{stats.other}</Line>
        <Line label="Speed">{stats.speed}</Line>
      </div>
      {order
        .filter((k) => groups.get(k)?.length)
        .map((k) => (
          <div key={k} className="space-y-2 border-t border-[#5a4630] pt-2">
            <div className="text-xs font-bold tracking-wider text-accent uppercase">{KIND_LABEL[k]}</div>
            {k === 'spell' ? (
              <div className="space-y-1.5">
                {stats.spellcasting && <div className="text-muted">{stats.spellcasting}</div>}
                <div className="flex flex-wrap gap-1">
                  {groups.get(k)!.map((a, i) => (
                    <LinkChip key={i} target={`spell:${a.name}`}>
                      {a.name}
                      {a.spellLevel !== undefined ? ` (${a.spellLevel})` : ''}
                      {a.frequency ? ` · ${a.frequency}` : ''}
                    </LinkChip>
                  ))}
                </div>
              </div>
            ) : (
              groups.get(k)!.map((a, i) => <ActionDetail key={i} action={a} system={system} owner={name} />)
            )}
          </div>
        ))}
    </div>
  )
}
