import type { GameSystem, StatBlock } from '@/types'

const PF2E_XP: Record<number, number> = { [-4]: 10, [-3]: 15, [-2]: 20, [-1]: 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 }
const PF2E_BUDGET = [
  { label: 'Trivial', base: 40, adj: 10 },
  { label: 'Low', base: 60, adj: 20 },
  { label: 'Moderate', base: 80, adj: 20 },
  { label: 'Severe', base: 120, adj: 30 },
  { label: 'Extreme', base: 160, adj: 40 },
]

const CR_XP: Record<string, number> = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900,
  '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000,
  '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000,
  '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000,
}
// XP budget per character (Low / Moderate / High)
const DND_BUDGET: [number, number, number][] = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400],
  [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100], [1900, 2900, 4100],
  [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800], [3800, 6100, 9800],
  [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000],
]

export interface Difficulty {
  xp: number
  label: string
  /** thresholds for display */
  scale: { label: string; xp: number }[]
}

export function creatureXp(system: GameSystem, stats: StatBlock | undefined, partyLevel: number): number {
  if (!stats) return 0
  if (system === 'pf2e') {
    const d = Math.max(-4, Math.min(4, (stats.level ?? partyLevel) - partyLevel))
    if ((stats.level ?? 0) - partyLevel < -4) return 0
    return PF2E_XP[d]
  }
  return CR_XP[stats.cr ?? '0'] ?? 0
}

export function encounterDifficulty(
  system: GameSystem,
  creatures: { stats?: StatBlock; count: number }[],
  partyLevel: number,
  partySize: number,
): Difficulty {
  const xp = creatures.reduce((s, c) => s + creatureXp(system, c.stats, partyLevel) * c.count, 0)
  if (system === 'pf2e') {
    const scale = PF2E_BUDGET.map((b) => ({ label: b.label, xp: b.base + (partySize - 4) * b.adj }))
    let label = 'Trivial'
    for (const s of scale) if (xp >= s.xp) label = s.label
    if (xp > scale[scale.length - 1].xp * 1.25) label = 'Beyond extreme'
    return { xp, label, scale }
  }
  const row = DND_BUDGET[Math.max(0, Math.min(19, partyLevel - 1))]
  const scale = [
    { label: 'Low', xp: row[0] * partySize },
    { label: 'Moderate', xp: row[1] * partySize },
    { label: 'High', xp: row[2] * partySize },
  ]
  let label = 'Trivial'
  for (const s of scale) if (xp >= s.xp) label = s.label
  if (xp > scale[2].xp * 1.5) label = 'Beyond high'
  return { xp, label, scale }
}
