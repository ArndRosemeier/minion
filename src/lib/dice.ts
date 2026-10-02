export interface DiceGroup {
  qty: number
  sides: number
  /** -1 for subtracted dice groups */
  sign: 1 | -1
}

export interface ParsedFormula {
  groups: DiceGroup[]
  modifier: number
}

export const SUPPORTED_SIDES = [4, 6, 8, 10, 12, 20, 100]

/** Parse "2d6+1d4+3", "d20 + 5", "1d8+4 slashing plus 1d6 fire" (descriptive words are ignored). */
export function parseFormula(input: string): ParsedFormula {
  const s = input.toLowerCase().replace(/\bplus\b/g, '+').replace(/\s+/g, '')
  const groups: DiceGroup[] = []
  let modifier = 0
  const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)(?!\d*d)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m[3]) {
      const qty = m[2] ? parseInt(m[2], 10) : 1
      const sides = parseInt(m[3], 10)
      if (qty > 0 && qty <= 100 && sides > 1) groups.push({ qty, sides, sign: m[1] === '-' ? -1 : 1 })
    } else if (m[5]) {
      const n = parseInt(m[5], 10)
      modifier += m[4] === '-' ? -n : n
    }
  }
  return { groups, modifier }
}

export function formatFormula(p: ParsedFormula): string {
  const parts = p.groups.map((g, i) => `${g.sign < 0 ? '-' : i ? '+' : ''}${g.qty}d${g.sides}`)
  let s = parts.join('')
  if (p.modifier) s += `${p.modifier > 0 ? (s ? '+' : '') : '-'}${Math.abs(p.modifier)}`
  return s || '0'
}

/** Pull a rollable damage formula out of descriptive text: "2d6+4 slashing plus 1d6 fire" -> "2d6+4+1d6" */
export function damageFormula(text?: string): string | null {
  if (!text) return null
  const terms = text.match(/\d*d\d+(?:\s*[+-]\s*\d+(?!\s*d))?/gi)
  if (!terms?.length) {
    const flat = text.match(/^\s*(\d+)\s/)
    return flat ? flat[1] : null
  }
  return terms.map((t) => t.replace(/\s+/g, '')).join('+')
}

/** "+7", "+7 (agile)", "7" -> "1d20+7" */
export function attackFormula(attack?: string): string | null {
  if (!attack) return null
  const m = attack.match(/([+-]?\d+)/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return `1d20${n >= 0 ? '+' : ''}${n}`
}

export function rollLocal(p: ParsedFormula): { dice: { sides: number; value: number }[]; total: number } {
  const dice: { sides: number; value: number }[] = []
  let total = p.modifier
  for (const g of p.groups) {
    for (let i = 0; i < g.qty; i++) {
      const v = 1 + Math.floor(Math.random() * g.sides)
      dice.push({ sides: g.sides, value: v * g.sign })
      total += v * g.sign
    }
  }
  return { dice, total }
}

export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

export const abilityMod = (score: number) => Math.floor((score - 10) / 2)
