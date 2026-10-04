import type { CompendiumManifest, GameSystem, RefCategory, RefEntry } from '@/types'

interface Loaded {
  manifest: CompendiumManifest | null
  entries: RefEntry[]
  byId: Map<string, RefEntry>
  byName: Map<string, RefEntry[]>
}

const cache = new Map<GameSystem, Promise<Loaded>>()
const ready = new Map<GameSystem, Loaded>()
const listeners = new Set<() => void>()

const base = () => import.meta.env.BASE_URL || './'

export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

async function load(system: GameSystem): Promise<Loaded> {
  const out: Loaded = { manifest: null, entries: [], byId: new Map(), byName: new Map() }
  try {
    const res = await fetch(`${base()}compendium/${system}/manifest.json`)
    if (!res.ok) throw new Error(`manifest ${res.status}`)
    const manifest = (await res.json()) as CompendiumManifest
    out.manifest = manifest
    const parts = await Promise.all(
      manifest.categories.map(async (c) => {
        const r = await fetch(`${base()}compendium/${system}/${c.file}`)
        return r.ok ? ((await r.json()) as RefEntry[]) : []
      }),
    )
    out.entries = parts.flat()
  } catch (e) {
    console.warn(`[compendium] ${system} not available`, e)
  }
  for (const e of out.entries) {
    out.byId.set(e.id, e)
    const k = normalizeName(e.name)
    const list = out.byName.get(k)
    if (list) list.push(e)
    else out.byName.set(k, [e])
  }
  ready.set(system, out)
  listeners.forEach((l) => l())
  return out
}

export function loadCompendium(system: GameSystem): Promise<Loaded> {
  let p = cache.get(system)
  if (!p) {
    p = load(system)
    cache.set(system, p)
  }
  return p
}

/** Synchronous access (null until loaded). */
export const compendium = (system: GameSystem) => ready.get(system) ?? null

export function onCompendiumLoaded(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const CATEGORY_PRIORITY: RefCategory[] = ['condition', 'spell', 'action', 'trait', 'item', 'creature', 'rule']

export function findRef(system: GameSystem, name: string, category?: RefCategory): RefEntry | null {
  const c = ready.get(system)
  if (!c) return null
  const key = normalizeName(name)
  let list = c.byName.get(key)
  if (!list) {
    // tolerate plurals and trailing values ("Frightened 2", "Goblins")
    const stripped = key.replace(/\s+\d+$/, '')
    list = c.byName.get(stripped) || c.byName.get(stripped.replace(/s$/, '')) || c.byName.get(stripped.replace(/es$/, ''))
  }
  if (!list && category === 'trait') {
    // "deadly d10", "range increment 60 feet", "versatile p" -> drop trailing words
    const words = key.split(' ')
    for (let n = words.length - 1; n > 0 && !list; n--) list = c.byName.get(words.slice(0, n).join(' '))
  }
  if (!list?.length) return null
  if (category) return list.find((e) => e.category === category) ?? null
  return [...list].sort((a, b) => CATEGORY_PRIORITY.indexOf(a.category) - CATEGORY_PRIORITY.indexOf(b.category))[0]
}

export function getRef(system: GameSystem, id: string): RefEntry | null {
  return ready.get(system)?.byId.get(id) ?? null
}

// normalized description text, built on first full-text search
const normText = new WeakMap<RefEntry, string>()
const textOf = (e: RefEntry) => {
  let t = normText.get(e)
  if (t === undefined) normText.set(e, (t = normalizeName(`${e.summary ?? ''} ${e.text} ${Object.values(e.meta ?? {}).join(' ')}`)))
  return t
}

export function searchRefs(
  system: GameSystem,
  query: string,
  opts: { category?: RefCategory; limit?: number; maxLevel?: number; inText?: boolean } = {},
): RefEntry[] {
  const c = ready.get(system)
  if (!c) return []
  const q = normalizeName(query)
  const limit = opts.limit ?? 50
  const scored: { e: RefEntry; s: number }[] = []
  for (const e of c.entries) {
    if (opts.category && e.category !== opts.category) continue
    if (opts.maxLevel !== undefined && (e.level ?? 0) > opts.maxLevel) continue
    const n = normalizeName(e.name)
    let s = -1
    if (!q) s = 1
    else if (n === q) s = 100
    else if (n.startsWith(q)) s = 60
    else if (n.includes(q)) s = 40
    else if (e.traits?.some((t) => t === q)) s = 20
    else if (q.length > 3 && e.summary && normalizeName(e.summary).includes(q)) s = 10
    else if (opts.inText && q.length > 2 && textOf(e).includes(q)) s = 5
    if (s > 0) scored.push({ e, s })
  }
  scored.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name))
  return scored.slice(0, limit).map((x) => x.e)
}
