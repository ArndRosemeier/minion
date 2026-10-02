import { useEffect, useRef, useState } from 'react'
import { Delete, Dices, HeartPulse, Minus, Plus, Swords, X } from 'lucide-react'
import { useUI, type RollResult } from '@/state/ui'
import { useBattle } from '@/state/battle'
import { useSettings } from '@/state/settings'
import { formatFormula, parseFormula, rollLocal, signed, type ParsedFormula } from '@/lib/dice'
import { newId } from '@/lib/id'
import { Button, IconButton, cx } from './ui'

// ---------------------------------------------------------------------------
// dice-box singleton (BabylonJS + Ammo, loaded lazily)
// ---------------------------------------------------------------------------

let boxPromise: Promise<any> | null = null
let boxFailed = false

function getBox(color: string): Promise<any> {
  if (boxFailed) return Promise.reject(new Error('3D dice unavailable'))
  if (!boxPromise) {
    boxPromise = (async () => {
      const { default: DiceBox } = await import('@3d-dice/dice-box')
      const assetPath = new URL('assets/dice-box/', document.baseURI).pathname
      const box = new DiceBox({
        container: '#dice-box',
        assetPath,
        origin: location.origin,
        theme: 'default',
        themeColor: color,
        scale: 6,
        gravity: 2,
        throwForce: 6,
        spinForce: 5,
        lightIntensity: 1.1,
        enableShadows: true,
        shadowTransparency: 0.7,
      })
      await box.init()
      return box
    })().catch((e) => {
      console.warn('[dice] 3D dice failed, falling back to plain rolls', e)
      boxFailed = true
      boxPromise = null
      throw e
    })
  }
  return boxPromise
}

async function roll3d(p: ParsedFormula, color: string): Promise<{ dice: { sides: number; value: number }[]; total: number }> {
  const supported = p.groups.every((g) => [4, 6, 8, 10, 12, 20, 100].includes(g.sides))
  if (!supported || !p.groups.length) return rollLocal(p)
  try {
    const box = await getBox(color)
    box.updateConfig?.({ themeColor: color })
    // resolves to a flat list of individual dice in creation order (group by group)
    const results: { sides: number | string; value: number }[] = await box.roll(p.groups.map((g) => ({ qty: g.qty, sides: g.sides, themeColor: color })))
    const dice: { sides: number; value: number }[] = []
    let total = p.modifier
    let gi = 0
    let left = p.groups[0]?.qty ?? 0
    for (const r of results) {
      while (left <= 0 && gi < p.groups.length - 1) left = p.groups[++gi].qty
      const g = p.groups[gi]
      left--
      const v = Number(r.value) * g.sign
      dice.push({ sides: g.sides, value: v })
      total += v
    }
    if (!dice.length) return rollLocal(p)
    return { dice, total }
  } catch {
    return rollLocal(p)
  }
}

function clearBox() {
  boxPromise?.then((b) => b.clear?.()).catch(() => {})
}

// ---------------------------------------------------------------------------

export function DicePanel() {
  const open = useUI((s) => s.diceOpen)
  const req = useUI((s) => s.diceRequest)
  const close = useUI((s) => s.closeDice)
  const rolls = useUI((s) => s.rolls)
  const addRoll = useUI((s) => s.addRoll)
  const color = useSettings((s) => s.settings.diceColor)
  const selection = useBattle((s) => s.selection)
  const applyHandler = useBattle((s) => s.applyHandler)

  const [formula, setFormula] = useState('1d20')
  const [label, setLabel] = useState<string | undefined>()
  const [adv, setAdv] = useState<'none' | 'adv' | 'dis'>('none')
  const [rolling, setRolling] = useState(false)
  const [last, setLast] = useState<RollResult | null>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const autoRolled = useRef<unknown>(null)

  useEffect(() => {
    if (!open) {
      clearBox()
      return
    }
    if (req && autoRolled.current !== req) {
      autoRolled.current = req
      setFormula(req.formula)
      setLabel(req.label)
      setAdv('none')
      doRoll(req.formula, req.label, 'none')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, req])

  const doRoll = async (f = formula, l = label, mode = adv) => {
    const p = parseFormula(f)
    if (!p.groups.length && !p.modifier) return
    setRolling(true)
    try {
      let result: { dice: { sides: number; value: number }[]; total: number }
      const d20 = p.groups.length === 1 && p.groups[0].sides === 20 && p.groups[0].qty === 1
      if (mode !== 'none' && d20) {
        const r = await roll3d({ groups: [{ qty: 2, sides: 20, sign: 1 }], modifier: 0 }, color)
        const vals = r.dice.map((d) => d.value)
        const pick = mode === 'adv' ? Math.max(...vals) : Math.min(...vals)
        result = { dice: r.dice, total: pick + p.modifier }
      } else {
        result = await roll3d(p, color)
      }
      const rr: RollResult = {
        id: newId(),
        formula: formatFormula(p) + (mode !== 'none' && d20 ? (mode === 'adv' ? ' (adv)' : ' (dis)') : ''),
        label: l,
        total: result.total,
        dice: result.dice,
        modifier: p.modifier,
        at: Date.now(),
      }
      setLast(rr)
      setAmount(Math.max(0, rr.total))
      addRoll(rr)
    } finally {
      setRolling(false)
    }
  }

  const addDie = (sides: number) => {
    const p = parseFormula(formula)
    const g = p.groups.find((x) => x.sides === sides && x.sign === 1)
    if (g) g.qty++
    else p.groups.push({ qty: 1, sides, sign: 1 })
    setFormula(formatFormula(p))
    setLabel(undefined)
  }
  const bumpMod = (d: number) => {
    const p = parseFormula(formula)
    p.modifier += d
    setFormula(formatFormula(p))
  }

  const canApply = !!applyHandler && selection.length > 0 && amount !== null

  return (
    <>
      <div id="dice-box" className={cx('pointer-events-none fixed inset-0 z-[55]', !open && 'hidden')} />
      {open && (
        <div className="anim-slide safe-bottom fixed right-3 bottom-3 z-[60] w-[min(380px,calc(100vw-24px))] rounded-2xl border border-line-strong bg-surface/95 shadow-2xl shadow-black/70 backdrop-blur">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <Dices className="size-4 text-accent" />
            <span className="flex-1 font-display text-sm">Dice</span>
            <IconButton size="sm" label="Close" icon={<X />} onClick={close} />
          </div>
          <div className="space-y-3 p-4">
            {last && (
              <div className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-center">
                {last.label && <div className="truncate text-xs text-muted">{last.label}</div>}
                <div className={cx('font-display text-5xl font-bold text-accent-strong', rolling && 'opacity-40')}>{last.total}</div>
                <div className="mt-1 flex flex-wrap justify-center gap-1 text-xs text-muted">
                  {last.dice.map((d, i) => (
                    <span key={i} className={cx('rounded bg-surface-3 px-1.5', d.sides === 20 && Math.abs(d.value) === 20 && 'bg-success/30 text-success', d.sides === 20 && Math.abs(d.value) === 1 && 'bg-danger/30 text-danger')}>
                      d{d.sides}:{d.value}
                    </span>
                  ))}
                  {last.modifier !== 0 && <span className="rounded bg-surface-3 px-1.5">{signed(last.modifier)}</span>}
                </div>
              </div>
            )}

            {canApply && (
              <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-2 text-xs text-muted">
                  Apply to {selection.length} selected token{selection.length > 1 ? 's' : ''}:
                  <input
                    type="number"
                    value={amount ?? 0}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    className="h-8 w-16 rounded-md border border-line bg-surface px-2 text-center text-sm text-ink"
                  />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button size="sm" variant="danger" icon={<Swords className="size-4" />} onClick={() => applyHandler!(amount!, 'damage')}>
                    Damage
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => applyHandler!(amount!, 'half')}>
                    ½ Dmg
                  </Button>
                  <Button size="sm" className="border-success/30 bg-success/15 text-success hover:bg-success/25" icon={<HeartPulse className="size-4" />} onClick={() => applyHandler!(amount!, 'heal')}>
                    Heal
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={formula}
                onChange={(e) => {
                  setFormula(e.target.value)
                  setLabel(undefined)
                }}
                onKeyDown={(e) => e.key === 'Enter' && doRoll()}
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 font-mono text-lg text-ink outline-none focus:border-accent"
              />
              <IconButton label="Clear" icon={<Delete />} onClick={() => setFormula('')} />
            </div>
            <div className="grid grid-cols-7 gap-1">
              {[4, 6, 8, 10, 12, 20, 100].map((s) => (
                <button key={s} onClick={() => addDie(s)} className="h-10 rounded-lg border border-line bg-surface-2 text-xs font-bold text-ink hover:bg-surface-3 active:bg-accent/20">
                  d{s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <IconButton size="sm" variant="secondary" label="-1" icon={<Minus />} onClick={() => bumpMod(-1)} />
              <IconButton size="sm" variant="secondary" label="+1" icon={<Plus />} onClick={() => bumpMod(1)} />
              <div className="flex-1" />
              {(['none', 'adv', 'dis'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setAdv(m)}
                  className={cx('h-8 rounded-md px-2.5 text-xs font-medium', adv === m ? 'bg-accent/20 text-accent' : 'text-muted hover:bg-surface-3')}
                >
                  {m === 'none' ? 'Normal' : m === 'adv' ? 'Adv' : 'Dis'}
                </button>
              ))}
            </div>
            <Button variant="primary" size="lg" className="w-full" loading={rolling} icon={<Dices className="size-5" />} onClick={() => doRoll()}>
              Roll {formula}
            </Button>
            {rolls.length > 1 && (
              <div className="max-h-28 space-y-0.5 overflow-y-auto border-t border-line pt-2 text-xs">
                {rolls.slice(1, 12).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setFormula(r.formula.replace(/ \(.*\)$/, ''))
                      setLabel(r.label)
                    }}
                    className="flex w-full justify-between gap-2 rounded px-1 py-0.5 text-left text-muted hover:bg-surface-3"
                  >
                    <span className="truncate">{r.label ?? r.formula}</span>
                    <b className="text-ink">{r.total}</b>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
