import { memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useOptionalCampaign } from '@/state/campaign'
import { useSettings } from '@/state/settings'
import { preprocessWikilinks, resolveLink, targetOf, type AutoLinker, type Resolved } from '@/lib/links'
import { ENTITY_TYPES, REF_TYPES, UNRESOLVED_META } from '@/lib/entityTypes'
import { useUI } from '@/state/ui'
import { cx } from './ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

const SKIP = new Set(['link', 'linkReference', 'inlineCode', 'code', 'heading', 'html'])
const BLOCK = new Set(['paragraph', 'listItem', 'tableCell', 'blockquote'])

/** remark plugin: turn plain-text mentions of campaign entities into wiki links (first mention per block). */
function remarkAutoLink(linker: AutoLinker, skipName: (name: string) => boolean) {
  const { re, strict } = linker
  return () => (tree: any) => {
    const walk = (node: any, used: Set<string>) => {
      if (SKIP.has(node.type) || !node.children) return
      const scope = BLOCK.has(node.type) ? new Set<string>() : used
      const out: any[] = []
      for (const child of node.children) {
        if (child.type !== 'text') {
          walk(child, scope)
          out.push(child)
          continue
        }
        const value: string = child.value
        let last = 0
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(value))) {
          const name = m[1]
          const key = name.toLowerCase()
          if (scope.has(key) || skipName(name)) continue
          // proper names only link when capitalized in the text
          if (strict.has(key) && name[0] === name[0].toLowerCase() && name[0] !== name[0].toUpperCase()) continue
          scope.add(key)
          if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
          out.push({ type: 'link', url: `wiki:${encodeURIComponent(name)}`, children: [{ type: 'text', value: name }] })
          last = m.index + name.length
        }
        if (last === 0) out.push(child)
        else if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
      }
      node.children = out
    }
    walk(tree, new Set())
  }
}

export function chipMeta(r: Resolved) {
  if (r.kind === 'entity') return ENTITY_TYPES[r.entity.type]
  if (r.kind === 'ref') return REF_TYPES[r.ref.category]
  return UNRESOLVED_META
}

export function LinkChip({ target, children, className }: { target: string; children?: ReactNode; className?: string }) {
  const ctx = useOptionalCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const resolved = useMemo(
    () => (ctx ? resolveLink(target, ctx.index, ctx.campaign.system) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, ctx?.index, ctx?.campaign.system, ctx?.compendiumVersion],
  )
  if (!ctx || !resolved) return <span>{children ?? target}</span>
  const meta = chipMeta(resolved)
  const Icon = meta.icon
  return (
    <a
      role="button"
      tabIndex={0}
      className={cx('chip', resolved.kind === 'unresolved' && 'chip-unresolved', className)}
      style={{ ['--c' as string]: meta.color }}
      title={resolved.kind === 'unresolved' ? `“${resolved.name}” not found — tap to create` : meta.label}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openDetail(targetOf(resolved, ctx.campaign.system))
      }}
    >
      <Icon />
      {children ?? target}
    </a>
  )
}

const urlTransform = (url: string) => (url.startsWith('wiki:') ? url : defaultUrlTransform(url))

export const Markdown = memo(function Markdown({
  text,
  selfName,
  className,
  autoLink = true,
  onReadAloud,
}: {
  text: string
  /** name of the entity being displayed (excluded from auto-linking) */
  selfName?: string
  className?: string
  autoLink?: boolean
  /** when given, read-aloud boxes get a "show to players" button */
  onReadAloud?: (markdown: string) => void
}) {
  const ctx = useOptionalCampaign()
  const autoLinkOn = useSettings((s) => s.settings.autoLink) && autoLink
  const source = useMemo(() => preprocessWikilinks(text || ''), [text])
  const plugins = useMemo(() => {
    const p: any[] = [remarkGfm]
    if (autoLinkOn && ctx?.autoLinker) {
      const self = selfName?.toLowerCase()
      p.push(remarkAutoLink(ctx.autoLinker, (n) => n.toLowerCase() === self))
    }
    return p
  }, [autoLinkOn, ctx?.autoLinker, selfName])

  return (
    <div className={cx('prose-m', className)}>
      <ReactMarkdown
        remarkPlugins={plugins}
        urlTransform={urlTransform}
        components={{
          blockquote: ({ node, children }) => {
            if (!onReadAloud) return <blockquote>{children}</blockquote>
            const start = node?.position?.start.offset ?? 0
            const end = node?.position?.end.offset ?? 0
            const raw = source
              .slice(start, end)
              .split('\n')
              .map((l) => l.replace(/^\s*>\s?/, ''))
              .join('\n')
              .replace(/\[([^\]]+)\]\(wiki:[^)]+\)/g, '$1')
            return (
              <blockquote>
                <button
                  type="button"
                  title="Show this text to the players"
                  onClick={() => onReadAloud(raw)}
                  className="float-right ml-2 rounded-md border border-accent/40 bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-accent not-italic hover:bg-accent/20"
                >
                  ▶ Show
                </button>
                {children}
              </blockquote>
            )
          },
          a: ({ href, children }) => {
            if (href?.startsWith('wiki:')) return <LinkChip target={decodeURIComponent(href.slice(5))}>{children}</LinkChip>
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
})
