import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useUI } from '@/state/ui'
import { AssetImage } from './AssetImage'
import { Markdown } from './Markdown'
import { cx } from './ui'

export async function enterFullscreen() {
  try {
    const el = document.documentElement as any
    if (document.fullscreenElement) return
    await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())
  } catch {
    /* not supported (e.g. iPhone) — the overlay still covers the screen */
  }
}

export async function exitFullscreen() {
  try {
    const d = document as any
    if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
  } catch {
    /* ignore */
  }
}

/** Player-facing full-screen view for images and read-aloud text. */
export function Showcase() {
  const showcase = useUI((s) => s.showcase)
  const show = useUI((s) => s.show)
  const [chrome, setChrome] = useState(true)
  const [caption, setCaption] = useState(true)

  useEffect(() => {
    if (!showcase) return
    enterFullscreen()
    setChrome(true)
    const t = setTimeout(() => setChrome(false), 2500)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcase])

  const close = () => {
    show(null)
    exitFullscreen()
  }

  if (!showcase) return null
  return (
    <div className="anim-fade fixed inset-0 z-[70] flex items-center justify-center bg-black" onClick={() => setChrome((c) => !c)}>
      {showcase.image ? (
        <AssetImage id={showcase.image} className="size-full object-contain" />
      ) : (
        <div className="max-w-3xl px-10 text-center">
          {showcase.title && <div className="mb-6 font-display text-5xl text-accent-strong">{showcase.title}</div>}
          {showcase.text && <Markdown text={showcase.text} className="text-2xl !leading-relaxed text-ink" autoLink={false} />}
        </div>
      )}
      {showcase.image && showcase.title && caption && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-8 pt-16 pb-8 text-center font-display text-3xl text-white drop-shadow-lg">
          {showcase.title}
        </div>
      )}
      <div className={cx('safe-top absolute top-0 right-0 flex gap-2 p-4 transition-opacity', chrome ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        {showcase.image && showcase.title && (
          <button
            className="rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation()
              setCaption(!caption)
            }}
          >
            {caption ? 'Hide title' : 'Show title'}
          </button>
        )}
        <button
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm text-white backdrop-blur hover:bg-white/20"
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          <X className="size-4" /> Close
        </button>
      </div>
    </div>
  )
}
