import { newId } from './id'
import type { BattleMap, Condition, MapState, PartyMember, StatBlock, Token } from '@/types'
import type { ApplyMode } from '@/state/battle'

export const SIZE_CELLS: Record<string, number> = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }

export function sizeCells(size?: string) {
  return SIZE_CELLS[(size ?? 'medium').toLowerCase().split(' ')[0]] ?? 1
}

export const cols = (m: BattleMap) => Math.max(1, Math.ceil((m.width - m.grid.offsetX) / m.grid.size))
export const rows = (m: BattleMap) => Math.max(1, Math.ceil((m.height - m.grid.offsetY) / m.grid.size))

/** Find a free cell near (cx, cy) in grid units. */
export function freeCellNear(state: MapState, cx: number, cy: number, size = 1, maxX = 999, maxY = 999): { x: number; y: number } {
  const occupied = (x: number, y: number) =>
    state.tokens.some((t) => x < t.x + t.size && x + size > t.x && y < t.y + t.size && y + size > t.y)
  const sx = Math.round(cx)
  const sy = Math.round(cy)
  for (let r = 0; r < 30; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = sx + dx
        const y = sy + dy
        if (x < 0 || y < 0 || x + size > maxX || y + size > maxY) continue
        if (!occupied(x, y)) return { x, y }
      }
    }
  }
  return { x: Math.max(0, sx), y: Math.max(0, sy) }
}

const MONSTER_COLOR = '#c0392b'
const NPC_COLOR = '#d9a441'

export function tokenFromStats(
  state: MapState,
  opts: { kind: Token['kind']; name: string; refId?: string; stats?: StatBlock; image?: string },
  at: { x: number; y: number },
  bounds: { maxX: number; maxY: number },
): Token {
  const size = sizeCells(opts.stats?.size)
  const same = state.tokens.filter((t) => t.refId === opts.refId && t.name.replace(/ \d+$/, '') === opts.name)
  const n = same.length + 1
  const pos = freeCellNear(state, at.x, at.y, size, bounds.maxX, bounds.maxY)
  return {
    id: newId('tok'),
    kind: opts.kind,
    name: n > 1 || same.length ? `${opts.name} ${n}` : opts.name,
    refId: opts.refId,
    x: pos.x,
    y: pos.y,
    size,
    hp: opts.stats?.hp,
    maxHp: opts.stats?.hp,
    ac: opts.stats?.ac,
    initBonus: opts.stats?.initiative ?? 0,
    conditions: [],
    color: opts.kind === 'npc' ? NPC_COLOR : MONSTER_COLOR,
    image: opts.image,
    label: initials(opts.name) + (n > 1 || same.length ? n : ''),
  }
}

export function tokenFromMember(state: MapState, m: PartyMember, at: { x: number; y: number }, bounds: { maxX: number; maxY: number }): Token {
  const pos = freeCellNear(state, at.x, at.y, 1, bounds.maxX, bounds.maxY)
  return {
    id: newId('tok'),
    kind: 'pc',
    name: m.name,
    refId: m.id,
    x: pos.x,
    y: pos.y,
    size: 1,
    hp: m.maxHp,
    maxHp: m.maxHp,
    ac: m.ac,
    initBonus: m.initBonus,
    conditions: [],
    color: m.color,
    image: m.image,
    label: initials(m.name),
  }
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2)
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function applyHp(t: Token, amount: number, mode: ApplyMode): Token {
  if (t.hp === undefined) return t
  if (mode === 'heal') return { ...t, hp: Math.min(t.maxHp ?? Infinity, t.hp + amount) }
  let dmg = mode === 'half' ? Math.floor(amount / 2) : amount
  let temp = t.tempHp ?? 0
  const absorbed = Math.min(temp, dmg)
  temp -= absorbed
  dmg -= absorbed
  return { ...t, tempHp: temp || undefined, hp: Math.max(0, t.hp - dmg) }
}

export const rollD20 = () => 1 + Math.floor(Math.random() * 20)

/** Initiative order (highest first; PCs win ties in PF2e is GM call — we sort by bonus as tiebreaker). */
export function initiativeOrder(state: MapState): Token[] {
  return state.tokens
    .filter((t) => t.initiative !== undefined && t.kind !== 'object')
    .sort((a, b) => b.initiative! - a.initiative! || (b.initBonus ?? 0) - (a.initBonus ?? 0) || a.name.localeCompare(b.name))
}

export function nextTurn(state: MapState, system: 'pf2e' | 'dnd5e'): MapState {
  const order = initiativeOrder(state)
  if (!order.length) return state
  const i = order.findIndex((t) => t.id === state.combat.turnId)
  let tokens = state.tokens
  // PF2e: frightened decreases at the end of the creature's turn
  if (system === 'pf2e' && i >= 0) {
    const ending = order[i].id
    tokens = tokens.map((t) => (t.id === ending ? { ...t, conditions: decrementCondition(t.conditions, 'frightened') } : t))
  }
  let next = 0
  let round = Math.max(1, state.combat.round)
  if (i >= 0) {
    next = i + 1
    if (next >= order.length) {
      next = 0
      round++
    }
  }
  return { ...state, tokens, combat: { ...state.combat, active: true, round, turnId: order[next].id } }
}

export function prevTurn(state: MapState): MapState {
  const order = initiativeOrder(state)
  if (!order.length) return state
  const i = order.findIndex((t) => t.id === state.combat.turnId)
  const prev = i <= 0 ? order.length - 1 : i - 1
  const round = i <= 0 ? Math.max(1, state.combat.round - 1) : state.combat.round
  return { ...state, combat: { ...state.combat, round, turnId: order[prev].id } }
}

function decrementCondition(conds: Condition[], name: string): Condition[] {
  return conds
    .map((c) => (c.name.toLowerCase() === name && c.value ? { ...c, value: c.value - 1 } : c))
    .filter((c) => !(c.name.toLowerCase() === name && c.value !== undefined && c.value <= 0))
}

export const VALUED_CONDITIONS_PF2E = ['clumsy', 'doomed', 'drained', 'dying', 'enfeebled', 'frightened', 'sickened', 'slowed', 'stunned', 'stupefied', 'wounded', 'persistent damage']
export const COMMON_CONDITIONS: Record<'pf2e' | 'dnd5e', string[]> = {
  pf2e: ['Off-Guard', 'Frightened', 'Prone', 'Grabbed', 'Restrained', 'Immobilized', 'Sickened', 'Slowed', 'Stunned', 'Clumsy', 'Enfeebled', 'Stupefied', 'Drained', 'Dying', 'Wounded', 'Doomed', 'Blinded', 'Dazzled', 'Deafened', 'Fatigued', 'Fleeing', 'Invisible', 'Hidden', 'Concealed', 'Confused', 'Controlled', 'Paralyzed', 'Petrified', 'Quickened', 'Unconscious', 'Persistent Damage'],
  dnd5e: ['Prone', 'Grappled', 'Restrained', 'Poisoned', 'Frightened', 'Charmed', 'Blinded', 'Deafened', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious', 'Exhaustion', 'Concentrating', 'Blessed', 'Hasted'],
}
