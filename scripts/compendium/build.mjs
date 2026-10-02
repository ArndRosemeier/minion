#!/usr/bin/env node
// Builds the offline rules compendium for Minion.
//
//   node scripts/compendium/build.mjs [--no-update] [--only=pf2e|dnd5e]
//
// Sources (cloned/updated into the OS temp dir, outside the project):
//   PF2e : github.com/foundryvtt/pf2e  (packs/pf2e + static/lang, sparse clone)
//          only entries with system.publication.license ORC/OGL from the remaster core books
//   5e   : github.com/5e-bits/5e-database (SRD 5.2 "2024" data, CC-BY-4.0;
//          rules sections from the SRD 5.1 "2014" data, CC-BY-4.0)
//
// Output: public/compendium/<system>/manifest.json + <category>.json (RefEntry[])
// No npm dependencies. Re-runnable: clones are reused and fast-forwarded.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, 'public', 'compendium')
const CACHE = process.env.MINION_COMPENDIUM_CACHE || path.join(os.tmpdir(), 'minion-compendium')
const ARGS = process.argv.slice(2)
const NO_UPDATE = ARGS.includes('--no-update')
const ONLY = (ARGS.find((a) => a.startsWith('--only=')) || '').split('=')[1]
const MAX_FILE_BYTES = 8 * 1024 * 1024

// ---------------------------------------------------------------------------
// generic helpers
// ---------------------------------------------------------------------------

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString().trim()
}

function ensureRepo(name, url, sparse) {
  const dir = path.join(CACHE, name)
  fs.mkdirSync(CACHE, { recursive: true })
  if (!fs.existsSync(path.join(dir, '.git'))) {
    console.log(`[git] cloning ${url} -> ${dir}`)
    if (sparse) {
      git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', url, dir])
      git(['sparse-checkout', 'set', ...sparse], dir)
    } else {
      git(['clone', '--depth', '1', url, dir])
    }
  } else if (!NO_UPDATE) {
    console.log(`[git] updating ${dir}`)
    try {
      if (sparse) git(['sparse-checkout', 'set', ...sparse], dir)
      git(['fetch', '--depth', '1', 'origin', 'HEAD'], dir)
      git(['reset', '--hard', 'FETCH_HEAD'], dir)
    } catch (e) {
      console.warn(`[git] update failed, using existing checkout: ${e.message.split('\n')[0]}`)
    }
  }
  const rev = git(['log', '-1', '--format=%H %cs'], dir)
  return { dir, rev }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

function walk(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(p)
  }
  return out
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const normName = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const titleCase = (s) =>
  String(s)
    .replace(/[-_]+/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`)
const ft = (s) => String(s).replace(/\bfeet\b/g, 'ft').replace(/\bfoot\b/g, 'ft')

function firstSentence(md, max = 140) {
  const plain = md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/^-+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  const m = plain.match(/^(.+?[.!?])(\s|$)/)
  let s = m ? m[1] : plain
  if (s.length > max) s = s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
  return s
}

/** Remove undefined / empty values to keep JSON small. */
function compact(o) {
  if (Array.isArray(o)) return o.map(compact)
  if (o && typeof o === 'object') {
    const r = {}
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined || v === null || (v === '' && k !== 'text')) continue
      if (Array.isArray(v) && v.length === 0 && k !== 'actions') continue
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
      r[k] = compact(v)
    }
    return r
  }
  return o
}

class IdMaker {
  constructor() {
    this.used = new Set()
  }
  make(system, category, name) {
    const base = `${system}-${category}-${slugify(name) || 'entry'}`
    let id = base
    for (let i = 2; this.used.has(id); i++) id = `${base}-${i}`
    this.used.add(id)
    return id
  }
}

function writeSystem(system, byCategory, license, attribution) {
  const dir = path.join(OUT, system)
  fs.mkdirSync(dir, { recursive: true })
  const categories = []
  const sizes = []
  for (const [category, entries] of Object.entries(byCategory)) {
    if (!entries.length) continue
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    const file = `${category}.json`
    const json = JSON.stringify(entries.map(compact))
    fs.writeFileSync(path.join(dir, file), json)
    if (json.length > MAX_FILE_BYTES) console.warn(`[warn] ${system}/${file} is ${(json.length / 1e6).toFixed(1)} MB (> 8 MB)`)
    categories.push({ category, file, count: entries.length })
    sizes.push([category, entries.length, Buffer.byteLength(json)])
  }
  // remove stale category files from earlier runs
  for (const f of fs.readdirSync(dir)) {
    if (f !== 'manifest.json' && f.endsWith('.json') && !categories.some((c) => c.file === f)) fs.unlinkSync(path.join(dir, f))
  }
  const manifest = { system, generatedAt: new Date().toISOString(), license, attribution, categories }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\n== ${system} ==`)
  for (const [c, n, b] of sizes) console.log(`  ${c.padEnd(10)} ${String(n).padStart(5)} entries  ${(b / 1024).toFixed(0).padStart(6)} KB`)
}

// ---------------------------------------------------------------------------
// PF2e: Foundry HTML + enrichers -> Markdown
// ---------------------------------------------------------------------------

const LINK_OPEN = '\u0001'
const LINK_CLOSE = '\u0002'
const linkToken = (target, label) => `${LINK_OPEN}${target}|${label}${LINK_CLOSE}`

/** find index of matching close bracket starting at i (s[i] === open) */
function matchBracket(s, i, open = '[', close = ']') {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++
    else if (s[j] === close) {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

/** split on a separator at bracket depth 0 */
function splitTop(s, sep) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === ']' || ch === ')' || ch === '}') depth--
    if (ch === sep && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function evalMath(expr, vars) {
  let s = expr
  for (const [k, v] of Object.entries(vars)) if (v !== undefined && v !== null) s = s.split(k).join(String(v))
  if (/@/.test(s)) return null
  const fn = { floor: Math.floor, ceil: Math.ceil, max: Math.max, min: Math.min, abs: Math.abs, round: Math.round }
  // evaluate innermost numeric (dice-free) sub-expressions
  for (let guard = 0; guard < 50; guard++) {
    const m = s.match(/(floor|ceil|max|min|abs|round)?\(\s*([-+*/\d\s.,]+?)\s*\)/)
    if (!m) break
    let val
    try {
      const args = m[2].split(',').map((a) => Function(`"use strict";return (${a})`)())
      val = m[1] ? fn[m[1]](...args) : args[0]
    } catch {
      return null
    }
    s = s.slice(0, m.index) + String(val) + s.slice(m.index + m[0].length)
  }
  // remaining pure arithmetic without dice
  if (/^[-+*/\d\s.]+$/.test(s) && /[-+*/]/.test(s.trim().slice(1))) {
    try {
      s = String(Function(`"use strict";return (${s})`)())
    } catch {
      /* keep */
    }
  }
  return s.replace(/\s+/g, '')
}

/** Readable fallback for level-dependent formulas whose actor/item is unknown. */
function describeScaling(formula) {
  let s = formula.replace(/\s+/g, '')
  // ternary(gte(@actor.level,19),6,ternary(...,1))dX  ->  "1dX (2dX at level 5, ...)"
  const t = /^\((ternary\(.*\))\)(d\d+)$/.exec(s) || /^(ternary\(.*\))(d\d+)$/.exec(s)
  if (t) {
    const steps = []
    let rest = t[1]
    let m
    while ((m = /^ternary\(gte\(@(?:actor|item)\.(?:level|rank),(\d+)\),(\d+),(.*)\)$/.exec(rest))) {
      steps.push([Number(m[1]), m[2]])
      rest = m[3]
    }
    if (/^\d+$/.test(rest) && steps.length) {
      steps.reverse()
      return `${rest}${t[2]} (${steps.map(([lvl, n]) => `${n}${t[2]} at level ${lvl}`).join(', ')})`
    }
  }
  s = s.replace(/@(?:actor|item)\.(?:level|rank)/g, 'level')
  if (/@/.test(s)) return null
  return s
}

const DAMAGE_CATEGORIES =new Set(['persistent', 'splash', 'precision'])

/** "(1d10+7)[bludgeoning]" / "2d6[persistent,fire]" -> "1d10+7 bludgeoning" */
function formatDamageInstance(inst, vars) {
  inst = inst.trim()
  let types = ''
  let formula = inst
  if (inst.endsWith(']')) {
    // find the '[' that matches the final ']'
    let depth = 0
    for (let j = inst.length - 1; j >= 0; j--) {
      if (inst[j] === ']') depth++
      else if (inst[j] === '[') {
        depth--
        if (depth === 0) {
          types = inst.slice(j + 1, -1)
          formula = inst.slice(0, j)
          break
        }
      }
    }
  }
  // nested instances inside the formula, e.g. (1[splash])
  formula = formula.replace(/\{([^}]*)\}/g, '$1')
  if (/\[/.test(formula)) {
    formula = formula.replace(/([\dd+\-*/()@a-z.]+)\[([a-z,\s-]+)\]/gi, (_m, f, t) => `${f} ${t.split(',').join(' ')}`)
  }
  let f = evalMath(formula, vars)
  if (f === null) f = describeScaling(formula)
  if (f === null) return null
  // strip wrapping parens
  while (f.startsWith('(') && matchBracket(f, 0, '(', ')') === f.length - 1) f = f.slice(1, -1)
  f = f.replace(/\+-/g, '-')
  const t = types
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !x.includes('@'))
  if (t.length === 1 && t[0] === 'healing') return f
  if (t.includes('healing')) return f
  const cats = t.filter((x) => DAMAGE_CATEGORIES.has(x))
  const rest = t.filter((x) => !DAMAGE_CATEGORIES.has(x))
  return [f, ...cats, ...rest].join(' ').replace(/\s+/g, ' ').trim()
}

function formatDamage(inner, vars) {
  const [rolls] = splitTop(inner, '|')
  const parts = splitTop(rolls, ',').map((r) => formatDamageInstance(r, vars))
  if (parts.some((p) => p === null)) {
    if (process.env.DEBUG_DMG) console.log("[dmg-fail]", inner)
    return null
  }
  return parts.join(' plus ')
}

const STAT_LABEL = {
  fortitude: 'Fortitude',
  reflex: 'Reflex',
  will: 'Will',
  perception: 'Perception',
  flat: 'flat check',
}

function parseParams(inner) {
  const parts = splitTop(inner, '|')
  const params = { _: [] }
  for (const p of parts) {
    const i = p.indexOf(':')
    if (i > 0 && !/\s/.test(p.slice(0, i))) params[p.slice(0, i).trim()] = p.slice(i + 1).trim()
    else params._.push(p.trim())
  }
  return params
}

function formatCheck(inner) {
  const p = parseParams(inner)
  const type = p.type || p._[0] || ''
  const basic = p._.includes('basic') || p.basic === 'true'
  const name = STAT_LABEL[type] || titleCase(type)
  const dc = /^\d+$/.test(p.dc || '') ? p.dc : null
  const vs = p.against || p.defense
  if (type === 'flat') return dc ? `DC ${dc} flat` : 'flat'
  let s = `${basic ? 'basic ' : ''}${name}`
  if (dc) s = `DC ${dc} ${s}`
  if (vs) s += ` (vs. ${STAT_LABEL[vs] || titleCase(vs)} DC)`
  return s
}

function formatTemplate(inner) {
  const p = parseParams(inner)
  const type = p.type || p._[0] || ''
  const dist = p.distance
  if (!dist) return type
  if (type === 'line' && p.width) return `${dist}-foot line`
  return `${dist}-foot ${type}`
}

const ACTION_GLYPHS = { 1: '◆', a: '◆', 2: '◆◆', d: '◆◆', 3: '◆◆◆', t: '◆◆◆', r: '↺', f: '◇' }
function glyph(s) {
  const k = String(s).trim().toLowerCase()
  if (ACTION_GLYPHS[k]) return ACTION_GLYPHS[k]
  // e.g. "1 to 3", "2 or 3", "a/d"
  return k
    .split(/\s*(?:to|or|\/)\s*/)
    .map((x) => ACTION_GLYPHS[x] || x)
    .join(k.includes('to') ? ' to ' : ' or ')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', times: '×', minus: '−', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' }
const decodeEntities = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITIES[e.toLowerCase()] ?? m
  })

const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

function htmlTableToMd(tableHtml) {
  const rows = []
  for (const tr of tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) || []).map((c) => inlineMd(c.replace(/^<t[hd][^>]*>|<\/t[hd]>$/gi, '')).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim())
    if (cells.length) rows.push(cells)
  }
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const norm = rows.map((r) => [...r, ...Array(width - r.length).fill('')])
  const line = (r) => `| ${r.join(' | ')} |`
  const caption = (tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i) || [])[1]
  return `\n\n${caption ? `**${stripTags(caption)}**\n\n` : ''}${line(norm[0])}\n|${' --- |'.repeat(width)}\n${norm.slice(1).map(line).join('\n')}\n\n`
}

/** inline formatting only (bold/italic/br), strips other tags */
function inlineMd(s) {
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<(strong|b)(\s[^>]*)?>(\s*)([\s\S]*?)(\s*)<\/\1>/gi, (_m, _t, _a, a, x, b) => (x.trim() ? `${a}**${x}**${b}` : `${a}${b}`))
      .replace(/<(em|i)(\s[^>]*)?>(\s*)([\s\S]*?)(\s*)<\/\1>/gi, (_m, _t, _a, a, x, b) => (x.trim() ? `${a}*${x}*${b}` : `${a}${b}`))
      .replace(/<[^>]+>/g, ''),
  )
}

function htmlToMarkdown(html) {
  let s = html.replace(/\r/g, '')
  s = s.replace(/<span[^>]*class="[^"]*action-glyph[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, (_m, g) => glyph(stripTags(g)))
  s = s.replace(/<table[\s\S]*?<\/table>/gi, (t) => htmlTableToMd(t))
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n\n${'#'.repeat(Math.min(6, Number(n) + 1))} ${stripTags(t)}\n\n`)
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
  s = s.replace(/<br\s*\/?>/gi, '  \n')
  // lists
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner) => {
    let i = 0
    return '\n\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, li) => `${++i}. ${inlineMd(li.replace(/<\/?p[^>]*>/gi, ' ')).trim()}\n`) + '\n'
  })
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, li) => `\n- ${inlineMd(li.replace(/<\/?p[^>]*>/gi, ' ').replace(/<\/?[uo]l[^>]*>/gi, ' ')).trim()}\n`)
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n\n')
  s = s.replace(/<\/?(p|div|section|blockquote|aside|figure)[^>]*>/gi, '\n\n')
  s = inlineMd(s)
  // tidy
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/^ (?=\S)/, '').replace(/\s+$/, (m) => (m.startsWith('  ') && false ? m : '')))
    .join('\n')
  s = s.replace(/\n(- |\d+\. )([^\n]*)\n\n(?=- |\d+\. )/g, '\n$1$2\n')
  s = s.replace(/\*\*\*\*/g, '').replace(/\*\* \*\*/g, ' ')
  s = s.replace(/\n{3,}/g, '\n\n').trim()
  // drop leading/trailing/duplicate rules
  s = s.replace(/^(---\n\n)+/, '').replace(/(\n\n---)+$/, '').replace(/(\n\n---){2,}/g, '\n\n---')
  return s
}

// ---------------------------------------------------------------------------
// PF2e build
// ---------------------------------------------------------------------------

const PF2E_CORE_BOOKS = {
  spell: ['Pathfinder Player Core', 'Pathfinder Player Core 2', 'Pathfinder GM Core'],
  action: ['Pathfinder Player Core', 'Pathfinder Player Core 2', 'Pathfinder GM Core'],
  item: ['Pathfinder Player Core', 'Pathfinder Player Core 2', 'Pathfinder GM Core'],
  condition: ['Pathfinder Player Core', 'Pathfinder Player Core 2', 'Pathfinder GM Core'],
}
const PF2E_BESTIARY_PACKS = ['pathfinder-monster-core', 'pathfinder-monster-core-2']
const PF2E_LICENSES = new Set(['ORC', 'OGL'])
const SIZE = { tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan' }

async function buildPf2e() {
  const { dir, rev } = ensureRepo('pf2e', 'https://github.com/foundryvtt/pf2e.git', ['packs/pf2e', 'static/lang'])
  const PACKS = path.join(dir, 'packs', 'pf2e')
  console.log(`[pf2e] foundryvtt/pf2e @ ${rev}`)

  // ---- localization -------------------------------------------------------
  const lang = {}
  for (const f of ['en.json', 're-en.json', 'action-en.json']) {
    const p = path.join(dir, 'static', 'lang', f)
    if (fs.existsSync(p)) mergeDeep(lang, readJson(p))
  }
  const localize = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), lang)
  const traitLabelMap = {}
  for (const [k, v] of Object.entries(lang.PF2E || {})) if (/^Trait[A-Z0-9]/.test(k) && !k.startsWith('TraitDescription') && typeof v === 'string') traitLabelMap[k.slice(5)] = v
  const traitLabel = (slug) => {
    const camel = String(slug)
      .split('-')
      .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
      .join('')
    const lbl = traitLabelMap[camel]
    if (lbl) return lbl.toLowerCase()
    return String(slug)
      .replace(/-(d\d+)$/, ' $1')
      .replace(/-(\d+)$/, ' $1')
      .replace(/-/g, ' ')
      .toLowerCase()
  }

  // ---- id -> name index for @UUID resolution --------------------------------
  console.log('[pf2e] indexing pack ids…')
  const idIndex = new Map()
  for (const pack of fs.readdirSync(PACKS)) {
    if (/bestiary/.test(pack) && !PF2E_BESTIARY_PACKS.includes(pack)) continue
    for (const f of walk(path.join(PACKS, pack))) {
      const txt = fs.readFileSync(f, 'utf8')
      if (pack === 'journals') {
        try {
          const j = JSON.parse(txt)
          idIndex.set(j._id, j.name)
          for (const p of j.pages || []) idIndex.set(p._id, p.name)
        } catch {
          /* ignore */
        }
        continue
      }
      const id = txt.match(/^ {4}"_id": "([^"]+)"/m)
      const nm = txt.match(/^ {4}"name": ("(?:[^"\\]|\\.)*")/m)
      if (id && nm) idIndex.set(id[1], JSON.parse(nm[1]))
    }
  }

  // ---- enricher conversion -------------------------------------------------
  function resolveUuid(uuid) {
    const parts = uuid.split('.')
    const last = parts[parts.length - 1]
    const pack = parts[2] || ''
    const name = /^[A-Za-z0-9]{16}$/.test(last) ? idIndex.get(last) : last
    return { name, pack }
  }

  function enrich(html, vars = {}, depth = 0) {
    if (!html) return ''
    let s = html
    let out = ''
    let i = 0
    while (i < s.length) {
      // @Enricher[...]{label}
      if (s[i] === '@') {
        const m = /^@([A-Za-z]+)\[/.exec(s.slice(i, i + 40))
        if (m) {
          const open = i + m[0].length - 1
          const close = matchBracket(s, open)
          if (close > 0) {
            const inner = s.slice(open + 1, close)
            let end = close + 1
            let label = null
            if (s[end] === '{') {
              const lc = matchBracket(s, end, '{', '}')
              if (lc > 0) {
                label = s.slice(end + 1, lc)
                end = lc + 1
              }
            }
            out += renderEnricher(m[1], inner, label, vars, depth)
            i = end
            continue
          }
        }
      }
      // [[/r ...]]{label}
      if (s.startsWith('[[/', i)) {
        const close = matchBracket(s, i)
        if (close > 0) {
          const inner = s.slice(i + 3, close - 1)
          let end = close + 1
          let label = null
          if (s[end] === '{') {
            const lc = matchBracket(s, end, '{', '}')
            if (lc > 0) {
              label = s.slice(end + 1, lc)
              end = lc + 1
            }
          }
          out += renderInlineCommand(inner, label, vars)
          i = end
          continue
        }
      }
      out += s[i]
      i++
    }
    return out
  }

  function renderEnricher(kind, inner, label, vars, depth) {
    switch (kind) {
      case 'UUID':
      case 'Compendium': {
        const { name, pack } = resolveUuid(inner)
        const text = label ?? name ?? ''
        if (!name) return text
        if (/effect|macros|rollable|criticaldeck/i.test(pack) || /^Effect:/.test(name)) return text
        return linkToken(name, text)
      }
      case 'Embed': {
        const { name } = resolveUuid(inner.split(/\s+/)[0])
        return name ? linkToken(name, label ?? name) : label ?? ''
      }
      case 'Damage': {
        if (label) return enrich(label, vars, depth)
        return formatDamage(inner, vars) ?? ''
      }
      case 'Check':
        return label ? enrich(label, vars, depth) : formatCheck(inner)
      case 'Template':
        return label ?? formatTemplate(inner)
      case 'Localize': {
        const v = localize(inner)
        if (typeof v !== 'string' || depth > 3) return ''
        return enrich(v, vars, depth + 1)
      }
      default:
        return label ?? ''
    }
  }

  function renderInlineCommand(inner, label, vars) {
    const m = /^(\w+)\s*([\s\S]*)$/.exec(inner)
    if (!m) return label ?? ''
    const [, cmd, rest] = m
    if (cmd === 'act') {
      if (label) return label
      const slug = rest.split(/\s+/)[0]
      return titleCase(slug)
    }
    if (label) return label
    let formula = rest.replace(/#.*$/, '').trim()
    formula = formula.replace(/^\{([\s\S]*)\}(\[[^\]]*\])?$/, (_m, f, t) => `(${f})${t || ''}`)
    return formatDamage(formula, vars) ?? formula
  }

  const md = (html, vars) => htmlToMarkdown(enrich(html || '', vars))

  // ---- category builders -------------------------------------------------
  const ids = new IdMaker()
  const entries = { spell: [], condition: [], creature: [], action: [], item: [], trait: [] }
  const licensesSeen = new Set()
  const books = new Set()
  const okLicense = (pub) => pub && PF2E_LICENSES.has(pub.license)
  const bookName = (t) => (t || '').replace(/^Pathfinder\s+/, '')
  const commonTraits = (t) => [...(t?.rarity && t.rarity !== 'common' ? [t.rarity] : []), ...(t?.value || []).map((x) => traitLabel(x))]
  const use = (pub) => {
    licensesSeen.add(pub.license)
    books.add(pub.title)
  }

  // Spells
  const timeLabel = (t) => {
    const v = String(t || '').trim()
    if (!v) return ''
    if (/^[123]$/.test(v)) return `${v} action${v === '1' ? '' : 's'}`
    if (/^\d+ (to|or) \d+$/.test(v)) return `${v} actions`
    return v
  }
  for (const f of walk(path.join(PACKS, 'spells'))) {
    const j = readJson(f)
    const s = j.system
    if (j.type !== 'spell' || !okLicense(s.publication) || !PF2E_CORE_BOOKS.spell.includes(s.publication.title)) continue
    use(s.publication)
    const rank = s.level?.value ?? 1
    const traitsArr = s.traits?.value || []
    const isCantrip = traitsArr.includes('cantrip')
    const isFocus = traitsArr.includes('focus')
    const isRitual = !!s.ritual
    let text = md(s.description?.value, { '@item.rank': rank, '@item.level': rank })
    // heightened entries
    const meta = {}
    if (s.traits?.traditions?.length) meta.Traditions = s.traits.traditions.join(', ')
    const cast = timeLabel(s.time?.value)
    if (cast) meta.Cast = cast
    if (s.cost?.value) meta.Cost = s.cost.value
    if (s.requirements) meta.Requirements = s.requirements
    if (s.range?.value) meta.Range = s.range.value
    const area = s.area ? s.area.details || `${s.area.value}-foot ${s.area.type}` : ''
    if (area) meta.Area = area
    if (s.target?.value) meta.Targets = s.target.value
    const duration = s.duration?.value ? (s.duration.sustained ? `sustained up to ${s.duration.value}` : s.duration.value) : s.duration?.sustained ? 'sustained' : ''
    if (duration) meta.Duration = duration
    let defense = ''
    if (s.defense?.save) defense = `${s.defense.save.basic ? 'basic ' : ''}${STAT_LABEL[s.defense.save.statistic] || titleCase(s.defense.save.statistic)}`
    else if (s.defense?.passive) defense = s.defense.passive.statistic === 'ac' ? 'AC' : titleCase(s.defense.passive.statistic) + ' DC'
    if (defense) meta.Defense = defense
    if (isRitual) {
      if (s.ritual.primary?.check) meta['Primary Check'] = s.ritual.primary.check
      if (s.ritual.secondary?.checks) meta['Secondary Checks'] = s.ritual.secondary.checks
      if (s.ritual.secondary?.casters) meta['Secondary Casters'] = String(s.ritual.secondary.casters)
    }
    const hIdx = text.search(/(^|\n)\*\*Heightened\b/)
    if (hIdx >= 0) {
      const hText = text.slice(hIdx).trim()
      if (hText.length <= 140 && !/\n\n(?!\*\*Heightened)/.test(hText)) {
        meta.Heightened = hText
          .replace(/\*\*Heightened\s*/g, '')
          .replace(/\*\*/g, '')
          .replace(/\n+/g, '; ')
        text = text
          .slice(0, hIdx)
          .replace(/\n*---\s*$/, '')
          .trim()
      }
    }
    const kind = isRitual ? 'Ritual' : isFocus ? 'Focus' : isCantrip ? 'Cantrip' : 'Rank'
    const summary = [`${kind} ${rank}`, cast, meta.Range && ft(meta.Range), area && ft(area), defense].filter(Boolean).join(' · ')
    entries.spell.push({
      id: ids.make('pf2e', 'spell', j.name),
      system: 'pf2e',
      category: 'spell',
      name: j.name,
      level: rank,
      traits: commonTraits(s.traits),
      summary,
      meta,
      text,
      source: bookName(s.publication.title),
    })
  }

  // Conditions
  for (const f of walk(path.join(PACKS, 'conditions'))) {
    const j = readJson(f)
    const s = j.system
    if (!okLicense(s.publication)) continue
    use(s.publication)
    const text = md(s.description?.value)
    entries.condition.push({
      id: ids.make('pf2e', 'condition', j.name),
      system: 'pf2e',
      category: 'condition',
      name: j.name,
      summary: (s.value?.isValued ? 'Valued · ' : '') + firstSentence(text),
      text,
      source: bookName(s.publication.title),
    })
  }

  // Actions
  const actionCostLabel = (s) => {
    const t = s.actionType?.value
    if (t === 'reaction') return 'reaction'
    if (t === 'free') return 'free action'
    if (t === 'passive') return 'passive'
    const n = s.actions?.value
    return n ? `${n} action${n > 1 ? 's' : ''}` : 'activity'
  }
  for (const f of walk(path.join(PACKS, 'actions'))) {
    const j = readJson(f)
    const s = j.system
    if (j.type !== 'action' || !okLicense(s.publication) || !PF2E_CORE_BOOKS.action.includes(s.publication.title)) continue
    use(s.publication)
    const folder = path.relative(path.join(PACKS, 'actions'), path.dirname(f)).split(path.sep)[0] || ''
    const cost = actionCostLabel(s)
    const meta = { Actions: cost }
    if (s.frequency?.max) meta.Frequency = `${s.frequency.max}/${s.frequency.per}`
    entries.action.push({
      id: ids.make('pf2e', 'action', j.name),
      system: 'pf2e',
      category: 'action',
      name: j.name,
      traits: commonTraits(s.traits),
      summary: [cost, folder ? `${titleCase(folder)} action` : ''].filter(Boolean).join(' · '),
      meta,
      text: md(s.description?.value),
      source: bookName(s.publication.title),
    })
  }

  // Items
  const priceLabel = (p) => {
    if (!p?.value) return ''
    const parts = ['pp', 'gp', 'sp', 'cp'].filter((c) => p.value[c]).map((c) => `${p.value[c].toLocaleString('en-US')} ${c}`)
    if (!parts.length) return ''
    return parts.join(', ') + (p.per && p.per > 1 ? ` (per ${p.per})` : '')
  }
  const bulkLabel = (b) => (b == null ? '' : b === 0 ? '—' : b < 1 ? 'L' : String(b))
  const usageLabel = (u) => {
    if (!u) return ''
    const m = {
      'held-in-one-hand': 'held in 1 hand',
      'held-in-two-hands': 'held in 2 hands',
      'held-in-one-plus-hands': 'held in 1+ hands',
      'held-in-one-or-two-hands': 'held in 1 or 2 hands',
      worn: 'worn',
      wornarmor: 'worn armor',
      'affixed-to-armor': 'affixed to armor',
      'affixed-to-weapon': 'affixed to weapon',
      etched: 'etched onto armor or weapon',
    }
    if (m[u]) return m[u]
    if (u.startsWith('worn')) return `worn ${u.slice(4)}`
    return u.replace(/-/g, ' ')
  }
  const ITEM_TYPES = new Set(['weapon', 'armor', 'shield', 'consumable', 'equipment', 'ammo', 'backpack'])
  for (const f of walk(path.join(PACKS, 'equipment'))) {
    const j = readJson(f)
    const s = j.system
    if (!ITEM_TYPES.has(j.type) || !okLicense(s.publication) || !PF2E_CORE_BOOKS.item.includes(s.publication.title)) continue
    use(s.publication)
    const level = s.level?.value ?? 0
    const meta = {}
    const price = priceLabel(s.price)
    if (price) meta.Price = price
    const bulk = bulkLabel(s.bulk?.value)
    if (bulk) meta.Bulk = bulk
    const usage = usageLabel(s.usage?.value)
    if (usage) meta.Usage = usage
    const hands = /held in (\S+)/.exec(usage)
    if (hands) meta.Hands = hands[1]
    if (j.type === 'weapon') {
      if (s.damage?.die) meta.Damage = `${s.damage.dice || 1}${s.damage.die} ${s.damage.damageType}`
      if (s.category) meta.Category = s.category
      if (s.group) meta.Group = s.group
      if (s.range) meta.Range = `${s.range} ft`
      if (s.reload?.value) meta.Reload = s.reload.value
    } else if (j.type === 'armor') {
      meta['AC Bonus'] = signed(s.acBonus ?? 0)
      if (s.dexCap != null && s.category !== 'unarmored') meta['Dex Cap'] = signed(s.dexCap)
      if (s.strength) meta.Strength = signed(s.strength)
      if (s.checkPenalty) meta['Check Penalty'] = String(s.checkPenalty)
      if (s.speedPenalty) meta['Speed Penalty'] = `${s.speedPenalty} ft`
      if (s.category) meta.Category = s.category
      if (s.group) meta.Group = s.group
    } else if (j.type === 'shield') {
      meta['AC Bonus'] = signed(s.acBonus ?? 0)
      if (s.hardness) meta.Hardness = String(s.hardness)
      if (s.hp?.max) meta.HP = `${s.hp.max} (BT ${Math.floor(s.hp.max / 2)})`
    } else if (j.type === 'consumable' && s.category) {
      meta.Category = s.category
    }
    const summary = [`Level ${level}`, price, j.type === 'weapon' && meta.Damage, j.type === 'armor' && `AC ${meta['AC Bonus']}`].filter(Boolean).join(' · ')
    entries.item.push({
      id: ids.make('pf2e', 'item', j.name),
      system: 'pf2e',
      category: 'item',
      name: j.name,
      level,
      traits: commonTraits(s.traits),
      summary,
      meta,
      text: md(s.description?.value, { '@item.level': level, '@item.rank': Math.ceil(level / 2) }),
      source: bookName(s.publication.title),
    })
  }

  // Creatures
  for (const pack of PF2E_BESTIARY_PACKS) {
    for (const f of walk(path.join(PACKS, pack))) {
      const j = readJson(f)
      if (j.type !== 'npc') continue
      const pub = j.system.details?.publication
      if (!okLicense(pub)) continue
      use(pub)
      entries.creature.push(convertCreature(j))
    }
  }

  function iwr(list, kind) {
    return (list || [])
      .map((x) => {
        let s = traitLabel(x.type)
        if (kind !== 'immunity' && x.value != null) s += ` ${x.value}`
        const ex = (x.exceptions || []).map((e) => (typeof e === 'string' ? traitLabel(e) : e.label || '')).filter(Boolean)
        const dbl = (x.doubleVs || []).map((e) => (typeof e === 'string' ? traitLabel(e) : e.label || '')).filter(Boolean)
        const notes = []
        if (ex.length) notes.push(`except ${ex.join(', ')}`)
        if (dbl.length) notes.push(`double resistance vs. ${dbl.join(', ')}`)
        if (x.definition) notes.push(x.definition)
        return notes.length ? `${s} (${notes.join('; ')})` : s
      })
      .join(', ')
  }

  function convertCreature(j) {
    const s = j.system
    const a = s.attributes
    const level = s.details.level?.value ?? 0
    const vars = { '@actor.level': level, '@item.level': level }
    const size = SIZE[s.traits?.size?.value] || s.traits?.size?.value
    const traits = commonTraits(s.traits)
    const items = j.items || []
    const speedParts = []
    if (a.speed?.value) speedParts.push(`${a.speed.value} feet`)
    for (const o of a.speed?.otherSpeeds || []) speedParts.push(`${o.type} ${o.value} feet`)
    if (a.speed?.details) speedParts.push(a.speed.details)
    const senses = [
      ...(s.perception?.senses || []).map((x) => [traitLabel(x.type), x.acuity && x.acuity !== 'precise' ? `(${x.acuity})` : x.acuity === 'precise' && /scent|tremorsense|lifesense|echolocation/.test(x.type) ? '(precise)' : '', x.range ? `${x.range} feet` : ''].filter(Boolean).join(' ')),
      ...(s.perception?.details ? [s.perception.details] : []),
    ].join(', ')
    const skills = [
      ...Object.entries(s.skills || {}).map(([k, v]) => {
        let t = `${titleCase(k)} ${signed(v.base ?? v.value ?? 0)}`
        for (const sp of v.special || []) t += ` (${signed(sp.base)} ${sp.label})`
        return t
      }),
      ...items.filter((i) => i.type === 'lore').map((i) => `${i.name} ${signed(i.system.mod?.value ?? 0)}`),
    ]
      .sort()
      .join(', ')
    const langs = [...(s.details.languages?.value || []).map((l) => titleCase(l)), ...(s.details.languages?.details ? [s.details.languages.details] : [])].join(', ')
    const otherNotes = []
    if (a.allSaves?.value) otherNotes.push(`Saves: ${a.allSaves.value}`)
    for (const [k, v] of Object.entries(s.saves || {})) if (v.saveDetail) otherNotes.push(`${titleCase(k)}: ${v.saveDetail}`)

    // ---- actions
    const interaction = []
    const defensive = []
    const strikes = []
    const spells = []
    const offensive = []
    for (const it of items) {
      const is = it.system
      if (it.type === 'melee') {
        const rolls = Object.values(is.damageRolls || {}).map((d) => [d.damage, d.category, d.damageType].filter(Boolean).join(' '))
        const effects = [...(is.attackEffects?.value || []).map((e) => {
          const hit = items.find((x) => x.system?.slug === e)
          return hit ? hit.name : titleCase(e)
        }), ...(is.attackEffects?.custom ? [is.attackEffects.custom] : [])]
        const ranged = !!is.range
        const tr = (is.traits?.value || []).map((t) => traitLabel(t))
        if (is.range?.increment) tr.push(`range increment ${is.range.increment} feet`)
        else if (is.range?.max) tr.push(`range ${is.range.max} feet`)
        strikes.push({
          name: it.name,
          kind: 'action',
          cost: 1,
          traits: tr,
          attack: signed(is.bonus?.value ?? 0),
          damage: [...rolls, ...effects].join(' plus ') || undefined,
          text: ranged ? 'Ranged Strike' : 'Melee Strike',
        })
      } else if (it.type === 'action') {
        const t = is.actionType?.value
        const kind = t === 'action' ? 'action' : t === 'reaction' ? 'reaction' : t === 'free' ? 'free' : 'passive'
        const text = md(is.description?.value, vars)
        const save = /DC \d+ (?:basic )?(?:Fortitude|Reflex|Will)/.exec(text)?.[0]
        const act = {
          name: it.name,
          kind,
          cost: kind === 'action' ? is.actions?.value || undefined : undefined,
          traits: (is.traits?.value || []).map((x) => traitLabel(x)),
          save,
          text,
        }
        if (is.frequency?.max && !/Frequency/.test(text)) act.frequency = `${is.frequency.max}/${is.frequency.per}`
        if (is.category === 'interaction') interaction.push(act)
        else if (is.category === 'defensive') defensive.push(act)
        else offensive.push(act)
      }
    }

    // spellcasting
    const entriesSc = items.filter((i) => i.type === 'spellcastingEntry')
    const spellcastingLines = []
    for (const e of entriesSc) {
      const es = e.system
      const prep = es.prepared?.value
      const dc = es.spelldc?.dc
      const atk = es.spelldc?.value
      spellcastingLines.push([e.name, dc ? `DC ${dc}` : '', atk ? `attack ${signed(atk)}` : ''].filter(Boolean).join(' ').replace(/ DC/, ' DC').replace(/(DC \d+) attack/, '$1, attack'))
      const mine = items.filter((i) => i.type === 'spell' && i.system.location?.value === e._id)
      const cantripRank = es.autoHeightenLevel?.value || Math.max(1, Math.ceil(level / 2))
      const note = entriesSc.length > 1 ? e.name : undefined
      const pushSpell = (sp, rank, freq) => {
        const m = /^(.*?)\s*\(([^)]*)\)(?:\s*\(([^)]*)\))?\s*$/.exec(sp.name)
        const baseName = m ? m[1] : sp.name
        const paren = m ? [m[2], m[3]].filter(Boolean).join(', ') : ''
        let frequency = freq
        if (/at will/i.test(paren)) frequency = 'at will'
        else if (/constant/i.test(paren)) frequency = 'constant'
        const rest = paren
          .split(/,\s*/)
          .filter((x) => x && !/^(at will|constant)$/i.test(x))
          .join(', ')
        spells.push({
          name: baseName,
          kind: 'spell',
          spellLevel: rank,
          frequency,
          text: [note, rest].filter(Boolean).join(' · ') || undefined,
        })
      }
      if (prep === 'prepared' && es.slots) {
        const done = new Set()
        for (const [slotKey, slot] of Object.entries(es.slots)) {
          const rank = Number(slotKey.replace('slot', ''))
          const counts = new Map()
          for (const p of slot.prepared || []) if (p?.id) counts.set(p.id, (counts.get(p.id) || 0) + 1)
          for (const [id, n] of counts) {
            const sp = mine.find((x) => x._id === id)
            if (!sp) continue
            done.add(id)
            const cantrip = (sp.system.traits?.value || []).includes('cantrip')
            pushSpell(sp, rank === 0 || cantrip ? cantripRank : rank, cantrip ? 'cantrip' : n > 1 ? `x${n}` : undefined)
          }
        }
        for (const sp of mine) if (!done.has(sp._id)) pushSpell(sp, sp.system.location?.heightenedLevel ?? sp.system.level?.value, undefined)
      } else {
        for (const sp of mine) {
          const tr = sp.system.traits?.value || []
          const cantrip = tr.includes('cantrip')
          const rank = sp.system.location?.heightenedLevel ?? (cantrip || prep === 'focus' ? cantripRank : sp.system.level?.value)
          let freq = cantrip ? 'cantrip' : prep === 'focus' ? 'focus' : undefined
          const uses = sp.system.location?.uses?.max
          if (!cantrip && uses > 1) freq = `x${uses}`
          pushSpell(sp, rank, freq)
        }
      }
    }
    spells.sort((x, y) => (y.spellLevel ?? 0) - (x.spellLevel ?? 0))

    const stats = {
      level,
      size,
      traits,
      ac: a.ac?.value ?? 10,
      acNote: a.ac?.details || undefined,
      hp: a.hp?.max ?? a.hp?.value ?? 1,
      hpNote: a.hp?.details || undefined,
      initiative: s.perception?.mod ?? 0,
      perception: s.perception?.mod ?? 0,
      speed: speedParts.join(', '),
      saves: [
        { name: 'Fort', value: s.saves?.fortitude?.value ?? 0 },
        { name: 'Ref', value: s.saves?.reflex?.value ?? 0 },
        { name: 'Will', value: s.saves?.will?.value ?? 0 },
      ],
      abilities: Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => [k, s.abilities?.[k]?.mod ?? 0])),
      skills,
      senses,
      languages: langs,
      immunities: iwr(a.immunities, 'immunity'),
      resistances: iwr(a.resistances, 'resistance'),
      weaknesses: iwr(a.weaknesses, 'weakness'),
      other: otherNotes.join('; '),
      spellcasting: spellcastingLines.join('; '),
      actions: [...interaction, ...defensive, ...strikes, ...spells, ...offensive],
    }
    const text = [s.details.blurb, md(s.details.publicNotes, vars)].filter(Boolean).join('\n\n')
    return {
      id: ids.make('pf2e', 'creature', j.name),
      system: 'pf2e',
      category: 'creature',
      name: j.name,
      level,
      traits,
      summary: `Level ${level} ${size} ${traits.filter((t) => !['uncommon', 'rare', 'unique'].includes(t)).join(' ')}`.trim(),
      text,
      stats,
      source: bookName(s.details.publication?.title),
    }
  }

  // Traits (from Foundry localization)
  const traitNames = new Set()
  for (const [k, v] of Object.entries(lang.PF2E || {})) {
    if (!k.startsWith('TraitDescription') || typeof v !== 'string' || !v.trim()) continue
    const key = k.slice('TraitDescription'.length)
    const name = traitLabelMap[key] || titleCase(key.replace(/([a-z])([A-Z0-9])/g, '$1 $2'))
    const nk = normName(name)
    if (traitNames.has(nk)) continue
    traitNames.add(nk)
    const text = md(v)
    entries.trait.push({ id: ids.make('pf2e', 'trait', name), system: 'pf2e', category: 'trait', name, summary: firstSentence(text), text })
  }

  // ---- resolve link tokens against everything we emit ------------------------
  const known = new Map()
  for (const list of Object.values(entries)) for (const e of list) if (!known.has(normName(e.name))) known.set(normName(e.name), e.name)
  const fix = (str) =>
    typeof str === 'string'
      ? str.replace(new RegExp(`${LINK_OPEN}([^${LINK_CLOSE}]*)${LINK_CLOSE}`, 'g'), (_m, body) => {
          const i = body.indexOf('|')
          const target = body.slice(0, i)
          const label = body.slice(i + 1).replace(/[[\]|]/g, '')
          const hit = known.get(normName(target))
          if (!hit) return label
          return normName(hit) === normName(label) ? `[[${label}]]` : `[[${hit}|${label}]]`
        })
      : str
  const deepFix = (o) => {
    if (typeof o === 'string') return fix(o)
    if (Array.isArray(o)) return o.map(deepFix)
    if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepFix(v)]))
    return o
  }
  for (const k of Object.keys(entries)) entries[k] = entries[k].map(deepFix)

  const bookList = [...books].filter(Boolean).map(bookName).sort()
  const license = 'ORC License (Paizo remaster content); Open Game License v1.0a for any OGL-flagged content'
  const attribution = [
    'This product is licensed under the ORC License held in the Library of Congress at TX 9-307-067 and available online at various locations including www.paizo.com/orclicense, www.azoralaw.com/orclicense, www.gamingorc.org, and others. All warranties are disclaimed as set forth therein.',
    `Attribution: This product is based on the following Licensed Material: ${bookList.map((b) => `Pathfinder ${b}`).join(', ')}, © Paizo Inc., Authors: Paizo Inc. Trait descriptions are taken from the localization files of the Foundry VTT Pathfinder 2e system and are likewise Paizo Licensed Material.`,
    'Data was extracted from the Foundry VTT Pathfinder Second Edition system (https://github.com/foundryvtt/pf2e). Only entries whose publication license is ORC or OGL are included.',
    licensesSeen.has('OGL') ? 'Open Game License v1.0a Copyright 2000, Wizards of the Coast, Inc. applies to OGL-flagged content.' : '',
    'Pathfinder and Paizo are trademarks of Paizo Inc. Minion is not published, endorsed, or specifically approved by Paizo.',
  ]
    .filter(Boolean)
    .join('\n\n')
  writeSystem('pf2e', entries, license, attribution)
  console.log(`  source: foundryvtt/pf2e @ ${rev}; licenses: ${[...licensesSeen].join(', ')}; books: ${bookList.join(', ')}`)
}

function mergeDeep(a, b) {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!a[k] || typeof a[k] !== 'object') a[k] = {}
      mergeDeep(a[k], v)
    } else if (!(k in a)) a[k] = v
  }
  return a
}

// ---------------------------------------------------------------------------
// D&D 5e build (5e-bits/5e-database)
// ---------------------------------------------------------------------------

const ABILITY_FULL = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' }
const mod = (score) => Math.floor((score - 10) / 2)
const crLabel = (cr) => (cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr))

/** 5e-database text: single newlines separate paragraphs; keep table rows together. */
function dbText(s) {
  if (Array.isArray(s)) s = s.join('\n')
  if (!s) return ''
  const lines = String(s)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l || (arr[i - 1] && arr[i - 1].trim()))
  let out = ''
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l) continue
    const prev = out ? out.split('\n').pop() : ''
    const tight = (l.startsWith('|') && prev.startsWith('|')) || (/^([-*]|\d+\.) /.test(l) && /^([-*]|\d+\.) /.test(prev))
    out += out ? (tight ? '\n' : '\n\n') + l : l
  }
  return out
}

function usageLabel5e(u) {
  if (!u) return ''
  switch (u.type) {
    case 'per day':
      return `${u.times}/Day${u.times_in_lair ? `, or ${u.times_in_lair}/Day in Lair` : ''}`
    case 'recharge on roll':
      return `Recharge ${u.min_value === 6 ? '6' : `${u.min_value}–6`}`
    case 'recharge after rest':
      return `Recharges after a ${(u.rest_types || []).map(titleCase).join(' or ')} Rest`
    case 'at will':
      return 'At Will'
    default:
      return u.type ? titleCase(u.type) : ''
  }
}

async function build5e() {
  const { dir, rev } = ensureRepo('5e-database', 'https://github.com/5e-bits/5e-database.git')
  console.log(`[dnd5e] 5e-bits/5e-database @ ${rev}`)
  const D24 = path.join(dir, 'src', '2024', 'en')
  const D14 = path.join(dir, 'src', '2014', 'en')
  const L24 = (n) => readJson(path.join(D24, `5e-SRD-${n}.json`))
  const L14 = (n) => readJson(path.join(D14, `5e-SRD-${n}.json`))
  const ids = new IdMaker()
  const entries = { spell: [], condition: [], creature: [], action: [], item: [], rule: [], trait: [] }
  const SRD52 = 'SRD 5.2'
  const SRD51 = 'SRD 5.1'

  // Spells (SRD 5.2)
  for (const sp of L24('Spells')) {
    const school = sp.school?.name || ''
    const comps = (sp.components || []).join(', ') + (sp.material ? ` (${sp.material.replace(/\.$/, '')})` : '')
    const duration = sp.concentration && !/^concentration/i.test(sp.duration) ? `Concentration, ${sp.duration}` : sp.duration
    const meta = {
      Level: sp.level === 0 ? 'Cantrip' : String(sp.level),
      School: school,
      'Casting Time': sp.casting_time + (sp.ritual ? ' or Ritual' : ''),
      Range: sp.range,
      Components: comps,
      Duration: duration,
      Classes: (sp.classes || []).map((c) => c.name).join(', '),
    }
    let text = dbText(sp.description || sp.desc)
    const hl = Array.isArray(sp.higher_level) ? sp.higher_level.join('\n') : sp.higher_level
    if (hl) text += `\n\n**Using a Higher-Level Spell Slot.** ${hl.replace(/^Using a Higher-Level Spell Slot\.\s*/i, '')}`
    text = text.replace(/(^|\n\n)Cantrip Upgrade\.\s*/g, '$1**Cantrip Upgrade.** ')
    const traits = [school.toLowerCase(), sp.ritual && 'ritual', sp.concentration && 'concentration'].filter(Boolean)
    entries.spell.push({
      id: ids.make('dnd5e', 'spell', sp.name),
      system: 'dnd5e',
      category: 'spell',
      name: sp.name,
      level: sp.level,
      traits,
      summary: [sp.level === 0 ? `${school} cantrip` : `Level ${sp.level} ${school}`, sp.casting_time, sp.range, sp.concentration ? 'Concentration' : ''].filter(Boolean).join(' · '),
      meta,
      text,
      source: SRD52,
    })
  }

  // Conditions (SRD 5.2)
  for (const c of L24('Conditions')) {
    const text = dbText(c.description || c.desc)
    entries.condition.push({ id: ids.make('dnd5e', 'condition', c.name), system: 'dnd5e', category: 'condition', name: c.name, summary: firstSentence(text), text, source: SRD52 })
  }

  // Monsters (SRD 5.2)
  for (const m of L24('Monsters')) entries.creature.push(convertMonster(m))

  function damageStr(arr) {
    const parts = []
    for (const d of arr || []) {
      if (d.damage_dice) parts.push(`${d.damage_dice} ${(d.damage_type?.name || '').toLowerCase()}`.trim())
      else if (d.from?.options) parts.push(d.from.options.map((o) => `${o.damage_dice} ${(o.damage_type?.name || '').toLowerCase()}`.trim()).join(' or '))
    }
    return parts.join(' plus ')
  }

  function convertMonster(m) {
    const abilities = { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma }
    const profs = m.proficiencies || []
    const saves = profs
      .filter((p) => /^Saving Throw:/.test(p.proficiency.name))
      .map((p) => ({ name: titleCase(p.proficiency.name.replace('Saving Throw: ', '').toLowerCase()), value: p.value }))
    const skills = profs
      .filter((p) => /^Skill:/.test(p.proficiency.name))
      .map((p) => `${p.proficiency.name.replace('Skill: ', '')} ${signed(p.value)}`)
      .join(', ')
    const speed = Object.entries(m.speed || {})
      .filter(([k]) => k !== 'hover')
      .map(([k, v]) => (k === 'walk' ? v : `${k} ${v}${k === 'fly' && m.speed.hover ? ' (hover)' : ''}`))
      .join(', ')
    const senses = Object.entries(m.senses || {})
      .map(([k, v]) => (k === 'passive_perception' ? `passive Perception ${v}` : `${k.replace(/_/g, ' ')} ${v}`))
      .join(', ')
    const acObj = (m.armor_class || [])[0] || { value: 10 }
    const acNote = [acObj.type && acObj.type !== 'natural' ? acObj.type : acObj.type, ...(acObj.armor || []).map((a) => a.name), acObj.desc].filter(Boolean).join(', ')
    const other = []
    if (m.damage_vulnerabilities?.length) other.push(`Vulnerabilities: ${m.damage_vulnerabilities.join(', ')}`)
    if (m.condition_immunities?.length) other.push(`Condition Immunities: ${m.condition_immunities.map((c) => c.name || c).join(', ')}`)
    if (m.gear) other.push(`Gear: ${m.gear}`)

    const actions = []
    const spellcasting = []
    const conv = (a, kind) => {
      const usage = usageLabel5e(a.usage)
      let name = a.name
      if (usage && !name.includes('(')) name += ` (${usage})`
      let cost
      if (kind === 'legendary') {
        const cm = /Costs? (\d+) Actions?/i.exec(a.name)
        cost = cm ? Number(cm[1]) : 1
      }
      const dc = a.dc ? `DC ${a.dc.dc_value} ${ABILITY_FULL[a.dc.dc_type?.name] || a.dc.dc_type?.name}${a.dc.success_type === 'half' ? ' (half on success)' : ''}` : undefined
      actions.push({
        name,
        kind,
        cost,
        attack: a.attack_bonus != null ? signed(a.attack_bonus) : undefined,
        damage: damageStr(a.damage) || undefined,
        save: dc,
        text: dbText(a.desc),
      })
      const sc = a.spellcasting
      if (sc && (/spellcasting/i.test(a.name) || (sc.spells || []).some((x) => x.usage))) {
        const ab = ABILITY_FULL[sc.ability?.name] || sc.ability?.name
        spellcasting.push(`${a.name.replace(/\s*\(.*\)$/, '')} (${[ab, sc.dc ? `spell save DC ${sc.dc}` : '', sc.modifier != null ? `${signed(sc.modifier)} to hit with spell attacks` : ''].filter(Boolean).join(', ')})`)
        for (const sp of sc.spells || []) {
          let frequency
          if (sp.usage?.type === 'at will') frequency = 'at will'
          else if (sp.usage?.type === 'per day') frequency = `${sp.usage.times}/day`
          else if (sp.level === 0) frequency = 'cantrip'
          else if (sc.slots?.[sp.level]) frequency = `${sc.slots[sp.level]} slots`
          actions.push({ name: sp.name, kind: 'spell', spellLevel: sp.level, frequency })
        }
      }
    }
    for (const a of m.special_abilities || []) conv(a, 'passive')
    for (const a of m.actions || []) conv(a, 'action')
    for (const a of m.bonus_actions || []) conv(a, 'bonus')
    for (const a of m.reactions || []) conv(a, 'reaction')
    for (const a of m.legendary_actions || []) conv(a, 'legendary')

    const cr = crLabel(m.challenge_rating)
    const traits = [m.type, m.subtype].filter(Boolean).map((t) => t.toLowerCase())
    const stats = {
      cr,
      size: m.size,
      traits,
      alignment: m.alignment,
      ac: acObj.value,
      acNote: acNote || undefined,
      hp: m.hit_points,
      hpNote: m.hit_points_roll || m.hit_dice,
      initiative: mod(m.dexterity),
      perception: m.senses?.passive_perception != null ? m.senses.passive_perception - 10 : undefined,
      speed,
      saves,
      abilities,
      skills,
      senses,
      languages: m.languages || '—',
      immunities: (m.damage_immunities || []).join(', '),
      resistances: (m.damage_resistances || []).join(', '),
      other: other.join('; '),
      spellcasting: spellcasting.join('; '),
      actions,
    }
    const meta = { XP: `${(m.xp ?? 0).toLocaleString('en-US')}${m.xp_in_lair ? ` (${m.xp_in_lair.toLocaleString('en-US')} in lair)` : ''}`, 'Proficiency Bonus': signed(m.proficiency_bonus ?? 2) }
    return {
      id: ids.make('dnd5e', 'creature', m.name),
      system: 'dnd5e',
      category: 'creature',
      name: m.name,
      cr,
      traits,
      summary: `CR ${cr} ${m.size} ${m.type}${m.subtype ? ` (${m.subtype})` : ''}, ${m.alignment}`,
      meta,
      text: m.desc ? dbText(m.desc) : '',
      stats,
      source: SRD52,
    }
  }

  // Equipment (SRD 5.2)
  const costLabel = (c) => (c ? `${c.quantity.toLocaleString('en-US')} ${c.unit}` : '')
  for (const e of L24('Equipment')) {
    const cats = (e.equipment_categories || []).map((c) => c.name)
    const primary = cats.find((c) => /Weapons$/.test(c) && /(Simple|Martial) (Melee|Ranged)/.test(c)) || cats.find((c) => /Armor$/.test(c) && c !== 'Armor') || cats[cats.length > 1 ? 1 : 0] || 'Equipment'
    const meta = {}
    if (e.cost) meta.Price = costLabel(e.cost)
    if (e.weight != null) meta.Weight = `${e.weight} lb.`
    if (e.damage) meta.Damage = `${e.damage.damage_dice} ${e.damage.damage_type?.name || ''}`.trim()
    if (e.two_handed_damage) meta['Two-Handed'] = `${e.two_handed_damage.damage_dice} ${e.two_handed_damage.damage_type?.name || ''}`.trim()
    if (e.properties?.length) meta.Properties = e.properties.map((p) => p.name).join(', ')
    if (e.mastery) meta.Mastery = e.mastery.name
    if (e.range && (e.range.long || /Ranged/.test(primary))) meta.Range = e.range.long ? `${e.range.normal}/${e.range.long} ft.` : `${e.range.normal} ft.`
    if (e.throw_range) meta['Thrown Range'] = `${e.throw_range.normal}/${e.throw_range.long} ft.`
    if (e.ammunition) meta.Ammunition = e.ammunition.name
    if (e.armor_class) meta.AC = `${e.armor_class.base}${e.armor_class.dex_bonus ? ` + Dex modifier${e.armor_class.max_bonus ? ` (max ${e.armor_class.max_bonus})` : ''}` : ''}`.replace(/^(\d+)$/, (x) => (/Shield/.test(primary) ? `+${x}` : x))
    if (e.str_minimum) meta.Strength = `Str ${e.str_minimum}`
    if (e.stealth_disadvantage) meta.Stealth = 'Disadvantage'
    if (e.don_time) meta['Don/Doff'] = `${e.don_time} / ${e.doff_time}`
    if (e.ability) meta.Ability = e.ability.name || e.ability
    if (e.utilize?.length) meta.Utilize = e.utilize.map((u) => u.name || u.description || u).join('; ')
    if (e.craft?.length) meta.Craft = e.craft.map((c) => c.name).join(', ')
    let text = dbText(e.description || e.desc)
    if (e.contents?.length) text = [text, `**Contents:** ${e.contents.map((c) => `${c.item.name}${c.quantity > 1 ? ` (${c.quantity})` : ''}`).join(', ')}`].filter(Boolean).join('\n\n')
    if (e.notes) text = [text, dbText(e.notes)].filter(Boolean).join('\n\n')
    const traits = [...new Set(cats.map((c) => c.toLowerCase()))]
    entries.item.push({
      id: ids.make('dnd5e', 'item', e.name),
      system: 'dnd5e',
      category: 'item',
      name: e.name,
      traits,
      summary: [primary.replace(/s$/, ''), meta.Price, meta.Damage, meta.AC && `AC ${meta.AC}`].filter(Boolean).join(' · '),
      meta,
      text,
      source: SRD52,
    })
  }
  // Magic items (SRD 5.2; variant rows are covered by their parent item)
  for (const mi of L24('Magic-Items')) {
    if (mi.variant) continue
    const lines = (Array.isArray(mi.desc) ? mi.desc.join('\n') : mi.desc || '').split('\n')
    const typeLine = (lines.shift() || '').trim()
    const rarity = mi.rarity?.name || ''
    const meta = { Type: typeLine || mi.equipment_category?.name, Rarity: rarity }
    if (mi.attunement) meta.Attunement = 'Required'
    if (mi['limited-to']) meta['Limited To'] = String(mi['limited-to'])
    if (mi.variants?.length) meta.Variants = mi.variants.map((v) => v.name).join(', ')
    entries.item.push({
      id: ids.make('dnd5e', 'item', mi.name),
      system: 'dnd5e',
      category: 'item',
      name: mi.name,
      traits: ['magic item', (mi.equipment_category?.name || '').toLowerCase(), ...rarity.toLowerCase().split(/,\s*|\s+or\s+/).map((r) => r.replace(/\s*\(.*\)/, '').trim())].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i),
      summary: `${typeLine || mi.equipment_category?.name}, ${rarity.toLowerCase()}${mi.attunement ? ' (requires attunement)' : ''}`,
      meta,
      text: dbText(lines.join('\n')),
      source: SRD52,
    })
  }

  // Traits: weapon properties & mastery properties (SRD 5.2)
  for (const p of L24('Weapon-Properties')) {
    const text = dbText(p.description || p.desc)
    entries.trait.push({ id: ids.make('dnd5e', 'trait', p.name), system: 'dnd5e', category: 'trait', name: p.name, traits: ['weapon property'], summary: firstSentence(text), text, source: SRD52 })
  }
  for (const p of L24('Weapon-Mastery-Properties')) {
    const text = dbText(p.description || p.desc)
    entries.trait.push({ id: ids.make('dnd5e', 'trait', `${p.name} mastery`), system: 'dnd5e', category: 'trait', name: p.name, traits: ['weapon mastery'], summary: `Weapon mastery · ${firstSentence(text)}`, text, source: SRD52 })
  }

  // Rules: SRD 5.1 rule sections (no 5.2 rules dataset in 5e-database yet)
  for (const r of L14('Rule-Sections')) {
    let text = (Array.isArray(r.desc) ? r.desc.join('\n') : r.desc || '').replace(/\r/g, '').trim()
    text = text.replace(new RegExp(`^#+\\s*${r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n+`), '')
    text = text.replace(/\*\* \*\*/g, ' ')
    text = text.replace(/^#{1,6} /gm, (h) => '#'.repeat(Math.min(6, h.trim().length + 1)) + ' ').replace(/\n{3,}/g, '\n\n')
    entries.rule.push({ id: ids.make('dnd5e', 'rule', r.name), system: 'dnd5e', category: 'rule', name: r.name, summary: firstSentence(text.replace(/^#.*$/gm, '')), text, source: SRD51 })
  }

  // Actions (authored from SRD 5.2 "Playing the Game" / Rules Glossary)
  for (const [name, summary, text] of DND5E_ACTIONS) {
    entries.action.push({ id: ids.make('dnd5e', 'action', name), system: 'dnd5e', category: 'action', name, summary, text, source: SRD52 })
  }

  const attribution = [
    'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
    'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
    'Spells, conditions, monsters, equipment, magic items and weapon properties are SRD 5.2; rules sections are SRD 5.1. Data was converted from the 5e-bits/5e-database project (https://github.com/5e-bits/5e-database). Short action summaries were condensed from the SRD 5.2 text.',
    'Dungeons & Dragons is a trademark of Wizards of the Coast LLC. Minion is not affiliated with or endorsed by Wizards of the Coast.',
  ].join('\n\n')
  writeSystem('dnd5e', entries, 'CC-BY-4.0 (SRD 5.2 and SRD 5.1 by Wizards of the Coast LLC)', attribution)
  console.log(`  source: 5e-bits/5e-database @ ${rev}`)
}

const DND5E_ACTIONS = [
  [
    'Attack',
    'Action · make one attack with a weapon or an Unarmed Strike',
    'When you take the Attack action, you can make one attack roll with a weapon or an Unarmed Strike.\n\n**Equipping and Unequipping Weapons.** You can either equip or unequip one weapon when you make an attack as part of this action. You do so either before or after the attack. If you equip a weapon, you must do so by drawing it or picking it up. If you unequip a weapon, you must do so by sheathing, stowing, or dropping it.\n\n**Moving between Attacks.** If you move on your turn and have a feature, such as Extra Attack, that gives you more than one attack as part of the Attack action, you can use some or all of your movement to move between those attacks.',
  ],
  [
    'Dash',
    'Action · gain extra movement equal to your Speed',
    'When you take the Dash action, you gain extra movement for the current turn. The increase equals your Speed after applying any modifiers. With a Speed of 30 feet, for example, you can move up to 60 feet on your turn if you Dash.\n\nIf you have a special speed, such as a Fly Speed or Swim Speed, you can use that speed instead of your Speed when you take this action. You choose which speed to use each time you take it.',
  ],
  ['Disengage', 'Action · your movement doesn\'t provoke Opportunity Attacks', "If you take the Disengage action, your movement doesn't provoke Opportunity Attacks for the rest of the current turn."],
  [
    'Dodge',
    'Action · attacks against you have Disadvantage, Advantage on Dex saves',
    "If you take the Dodge action, you gain the following benefits: until the start of your next turn, any attack roll made against you has Disadvantage if you can see the attacker, and you make Dexterity saving throws with Advantage.\n\nYou lose these benefits if you have the [[Incapacitated]] condition or if your Speed is 0.",
  ],
  [
    'Help',
    'Action · give an ally Advantage on an ability check or attack roll',
    "When you take the Help action, you do one of the following.\n\n**Assist an Ability Check.** Choose one of your skill or tool proficiencies and one ally who is near enough for you to assist verbally or physically when they make an ability check. That ally has Advantage on the next ability check they make with the chosen skill or tool. This benefit expires if the ally doesn't use it before the start of your next turn. The GM has final say on whether your assistance is possible.\n\n**Assist an Attack Roll.** You momentarily distract an enemy within 5 feet of you, giving Advantage to the next attack roll by one of your allies against that enemy. This benefit expires at the start of your next turn.",
  ],
  [
    'Hide',
    'Action · DC 15 Dexterity (Stealth) check to gain the Invisible condition',
    "With the Hide action, you try to conceal yourself. To do so, you must succeed on a DC 15 Dexterity (Stealth) check while you're Heavily Obscured or behind Three-Quarters Cover or Total Cover, and you must be out of any enemy's line of sight; if you can see a creature, you can discern whether it can see you.\n\nOn a successful check, you have the [[Invisible]] condition. Make note of your check's total, which is the DC for a creature to find you with a Wisdom (Perception) check.\n\nThe condition ends on you immediately after any of the following occurs: you make a sound louder than a whisper, an enemy finds you, you make an attack roll, or you cast a spell with a Verbal component.",
  ],
  [
    'Influence',
    'Action · urge a monster to do something (Charisma or Wisdom check)',
    "With the Influence action, you urge a monster to do something. Describe or roleplay how you're communicating with the monster. Are you trying to deceive, intimidate, amuse, or gently persuade? The GM then determines whether the monster feels willing, unwilling, or hesitant due to your interaction; this determination establishes whether an ability check is necessary.\n\n**Willing.** If your urging aligns with the monster's desires, no ability check is necessary; the monster fulfills your request in a way it prefers.\n\n**Unwilling.** If your urging is repugnant to the monster or counter to its alignment, no ability check is necessary; it doesn't comply.\n\n**Hesitant.** If you urge the monster to do something that it is hesitant to do, you must make an ability check: Charisma (Deception) to deceive, Charisma (Intimidation) to intimidate, Charisma (Performance) to amuse, Charisma (Persuasion) to persuade, or Wisdom (Animal Handling) to gently coax a Beast or Monstrosity. The default DC equals 15 or the monster's Intelligence score, whichever is higher. On a successful check, the monster does as urged. On a failed check, you must wait 24 hours (or a duration set by the GM) before urging it in the same way again.",
  ],
  [
    'Magic',
    'Action · cast a spell, use a magic item or a magical feature',
    "When you take the Magic action, you cast a spell that has a casting time of an action or use a feature or magic item that requires a Magic action to be activated.\n\nIf you cast a spell that has a casting time of 1 minute or longer, you must take the Magic action on each turn of that casting, and you must maintain Concentration while you do so. If your Concentration is broken, the spell fails, but you don't expend a spell slot.",
  ],
  [
    'Ready',
    'Action · prepare a Reaction to a trigger you choose',
    "You take the Ready action to wait for a particular circumstance before you act. To do so, you take this action on your turn, which lets you act by taking a Reaction before the start of your next turn.\n\nFirst, you decide what perceivable circumstance will trigger your Reaction. Then, you choose the action you will take in response to that trigger, or you choose to move up to your Speed in response to it. When the trigger occurs, you can either take your Reaction right after the trigger finishes or ignore the trigger.\n\nWhen you Ready a spell, you cast it as normal (expending any resources used to cast it) but hold its energy, which you release with your Reaction when the trigger occurs. To be readied, a spell must have a casting time of an action, and holding on to the spell's magic requires Concentration, which you can maintain up to the start of your next turn. If your Concentration is broken, the spell dissipates without taking effect.",
  ],
  [
    'Search',
    'Action · Wisdom check to discern something that isn\'t obvious',
    "When you take the Search action, you make a Wisdom check to discern something that isn't obvious.\n\n| Skill | Thing to Detect |\n| --- | --- |\n| Insight | Creature's state of mind |\n| Medicine | Creature's ailment or cause of death |\n| Perception | Concealed creature or object |\n| Survival | Tracks or food |",
  ],
  [
    'Study',
    'Action · Intelligence check to recall or deduce information',
    "When you take the Study action, you make an Intelligence check to study your memory, a book, a clue, or another source of knowledge and call to mind an important piece of information about it.\n\n| Skill | Areas of Knowledge |\n| --- | --- |\n| Arcana | Spells, magic items, eldritch symbols, magical traditions, planes of existence, and certain creatures (Aberrations, Constructs, Elementals, Fey, and Monstrosities) |\n| History | Historic events and people, ancient civilizations, wars, and certain creatures (Giants and Humanoids) |\n| Investigation | Traps, ciphers, riddles, and gadgetry |\n| Nature | Terrain, flora, weather, and certain creatures (Beasts, Dragons, Oozes, and Plants) |\n| Religion | Deities, religious hierarchies and rites, holy symbols, cults, and certain creatures (Celestials, Fiends, and Undead) |",
  ],
  [
    'Utilize',
    'Action · use a nonmagical object that requires an action',
    'You normally interact with an object while doing something else, such as when you draw a sword as part of the Attack action. When an object requires an action for its use, you take the Utilize action.',
  ],
  [
    'Opportunity Attack',
    'Reaction · melee attack when a creature leaves your reach',
    "You can make an Opportunity Attack when a creature that you can see leaves your reach using its action, its Bonus Action, its Reaction, or one of its speeds. To make the attack, take a Reaction to make one melee attack with a weapon or an Unarmed Strike against that creature. The attack occurs right before it leaves your reach.\n\nA creature can avoid provoking an Opportunity Attack by taking the [[Disengage]] action. It also doesn't provoke one when it Teleports or when it is moved without using its movement, action, Bonus Action, or Reaction.",
  ],
]

// ---------------------------------------------------------------------------

const t0 = Date.now()
fs.mkdirSync(OUT, { recursive: true })
if (!ONLY || ONLY === 'pf2e') await buildPf2e()
if (!ONLY || ONLY === 'dnd5e') await build5e()
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)} s. Clones cached in ${CACHE}`)
