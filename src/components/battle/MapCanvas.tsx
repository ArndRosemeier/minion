import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { EyeOff, Link2, Skull } from 'lucide-react'
import { useAssetUrl } from '@/components/AssetImage'
import { assetUrl } from '@/components/AssetImage'
import { cx } from '@/components/ui'
import { useOptionalCampaign } from '@/state/campaign'
import type { BattleMap, MapLink, MapState, Token } from '@/types'

export type MapTool = 'select' | 'reveal' | 'hide' | 'link'

export interface MapCanvasHandle {
  fit: () => void
  centerOnCell: (x: number, y: number) => void
  viewCenterCell: () => { x: number; y: number }
  fogCoverAll: () => void
  fogRevealAll: () => void
  fogSnapshot: () => Promise<Blob | null>
}

interface Props {
  map: BattleMap
  state: MapState
  player?: boolean
  tool: MapTool
  brush: number
  selection: string[]
  multiSelect?: boolean
  onSelect: (ids: string[]) => void
  onMoveToken: (id: string, x: number, y: number) => void
  onFogCommit: (blob: Blob) => void
  onCreateLink?: (rect: { x: number; y: number; w: number; h: number }) => void
  onOpenLink?: (link: MapLink) => void
}

type Mode =
  | { type: 'pan'; sx: number; sy: number; tx0: number; ty0: number; moved: boolean }
  | { type: 'pinch'; d0: number; s0: number; mx: number; my: number; tx0: number; ty0: number }
  | { type: 'token'; id: string; sx: number; sy: number; wx0: number; wy0: number; moved: boolean; el: HTMLElement; left0: number; top0: number }
  | { type: 'fog'; last: { x: number; y: number } }
  | { type: 'link'; start: { x: number; y: number }; cur: { x: number; y: number } }
  | { type: 'linktap'; link: MapLink; sx: number; sy: number }
  | null

const FOG_MAX = 1400

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(props, ref) {
  const { map, state, player, tool, selection } = props
  const viewport = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const fog = useRef<HTMLCanvasElement>(null)
  const view = useRef({ x: 0, y: 0, s: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const mode = useRef<Mode>(null)
  const loadedFog = useRef<string | undefined | null>(null)
  const [zoom, setZoom] = useState(1)
  const [linkDraft, setLinkDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const imgUrl = useAssetUrl(map.image)
  const gs = map.grid.size
  const fogScale = Math.min(1, FOG_MAX / Math.max(map.width, map.height))
  const propsRef = useRef(props)
  propsRef.current = props

  const apply = useCallback(() => {
    const v = view.current
    if (world.current) world.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`
  }, [])

  const zoomTimer = useRef<number>(0)
  const syncZoom = () => {
    clearTimeout(zoomTimer.current)
    zoomTimer.current = window.setTimeout(() => setZoom(view.current.s), 120)
  }

  const fit = useCallback(() => {
    const el = viewport.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s = Math.min(r.width / map.width, r.height / map.height) * 0.98
    view.current = { s, x: (r.width - map.width * s) / 2, y: (r.height - map.height * s) / 2 }
    apply()
    setZoom(s)
  }, [map.width, map.height, apply])

  useLayoutEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.id])

  const toWorld = (cx: number, cy: number) => {
    const r = viewport.current!.getBoundingClientRect()
    const v = view.current
    return { x: (cx - r.left - v.x) / v.s, y: (cy - r.top - v.y) / v.s }
  }

  // ------------------------------------------------------------------ fog
  const fogCtx = () => fog.current?.getContext('2d') ?? null
  const fillFog = (on: boolean) => {
    const c = fog.current
    const ctx = fogCtx()
    if (!c || !ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, c.width, c.height)
    if (on) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, c.width, c.height)
    }
  }

  // once the parent stored our committed fog snapshot, don't reload it (must run before the load effect)
  useEffect(() => {
    if (loadedFog.current === '__pending__') loadedFog.current = state.fog
  }, [state.fog])

  useEffect(() => {
    const c = fog.current
    if (!c) return
    const w = Math.round(map.width * fogScale)
    const h = Math.round(map.height * fogScale)
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
      loadedFog.current = null
    }
    if (loadedFog.current === (state.fog ?? undefined) && loadedFog.current !== null) return
    if (!state.fog) {
      fillFog(true)
      loadedFog.current = undefined
      return
    }
    // only mark as loaded once drawn (effects may be cancelled and re-run)
    let alive = true
    const fogId = state.fog
    assetUrl(fogId).then((url) => {
      if (!alive || !url) return
      const img = new Image()
      img.onload = () => {
        const ctx = fogCtx()
        if (!ctx || !alive) return
        ctx.globalCompositeOperation = 'source-over'
        ctx.clearRect(0, 0, c.width, c.height)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        loadedFog.current = fogId
      }
      img.src = url
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fog, map.width, map.height, fogScale, state.fogEnabled])

  const paintFog = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const ctx = fogCtx()
    if (!ctx) return
    ctx.globalCompositeOperation = propsRef.current.tool === 'reveal' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = '#000'
    ctx.fillStyle = '#000'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const d = propsRef.current.brush * gs * fogScale
    ctx.lineWidth = d
    ctx.beginPath()
    ctx.moveTo(from.x * fogScale, from.y * fogScale)
    ctx.lineTo(to.x * fogScale, to.y * fogScale)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(to.x * fogScale, to.y * fogScale, d / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const snapshot = () =>
    new Promise<Blob | null>((resolve) => {
      if (!fog.current) return resolve(null)
      fog.current.toBlob((b) => resolve(b), 'image/png')
    })

  const commitFog = async () => {
    const b = await snapshot()
    if (b) {
      loadedFog.current = '__pending__'
      propsRef.current.onFogCommit(b)
    }
  }

  useImperativeHandle(ref, () => ({
    fit,
    centerOnCell: (x, y) => {
      const el = viewport.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const v = view.current
      const wx = map.grid.offsetX + (x + 0.5) * gs
      const wy = map.grid.offsetY + (y + 0.5) * gs
      v.x = r.width / 2 - wx * v.s
      v.y = r.height / 2 - wy * v.s
      apply()
    },
    viewCenterCell: () => {
      const el = viewport.current
      if (!el) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      const w = toWorld(r.left + r.width / 2, r.top + r.height / 2)
      return { x: Math.floor((w.x - map.grid.offsetX) / gs), y: Math.floor((w.y - map.grid.offsetY) / gs) }
    },
    fogCoverAll: () => {
      fillFog(true)
      commitFog()
    },
    fogRevealAll: () => {
      fillFog(false)
      commitFog()
    },
    fogSnapshot: snapshot,
  }))

  // ------------------------------------------------------------------ pointers
  const onPointerDown = (e: React.PointerEvent) => {
    const el = viewport.current!
    el.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = propsRef.current

    if (pointers.current.size === 2) {
      // switch to pinch; cancel single-pointer actions
      const m = mode.current
      if (m?.type === 'token') {
        m.el.style.left = `${m.left0}px`
        m.el.style.top = `${m.top0}px`
      }
      if (m?.type === 'fog') commitFog()
      if (m?.type === 'link') setLinkDraft(null)
      const [a, b] = [...pointers.current.values()]
      const r = el.getBoundingClientRect()
      mode.current = {
        type: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        s0: view.current.s,
        mx: (a.x + b.x) / 2 - r.left,
        my: (a.y + b.y) / 2 - r.top,
        tx0: view.current.x,
        ty0: view.current.y,
      }
      return
    }
    if (pointers.current.size > 2) return

    const target = e.target as HTMLElement
    const tokenEl = target.closest<HTMLElement>('[data-token]')
    const linkEl = target.closest<HTMLElement>('[data-link]')
    if (p.tool === 'select' && tokenEl) {
      const w = toWorld(e.clientX, e.clientY)
      mode.current = {
        type: 'token',
        id: tokenEl.dataset.token!,
        sx: e.clientX,
        sy: e.clientY,
        wx0: w.x,
        wy0: w.y,
        moved: false,
        el: tokenEl,
        left0: parseFloat(tokenEl.style.left),
        top0: parseFloat(tokenEl.style.top),
      }
      return
    }
    if (p.tool === 'select' && linkEl) {
      const link = p.map.links.find((l) => l.id === linkEl.dataset.link)
      if (link) {
        mode.current = { type: 'linktap', link, sx: e.clientX, sy: e.clientY }
        return
      }
    }
    if ((p.tool === 'reveal' || p.tool === 'hide') && p.state.fogEnabled) {
      const w = toWorld(e.clientX, e.clientY)
      mode.current = { type: 'fog', last: w }
      paintFog(w, w)
      return
    }
    if (p.tool === 'link') {
      const w = toWorld(e.clientX, e.clientY)
      mode.current = { type: 'link', start: w, cur: w }
      setLinkDraft({ x: w.x, y: w.y, w: 0, h: 0 })
      return
    }
    mode.current = { type: 'pan', sx: e.clientX, sy: e.clientY, tx0: view.current.x, ty0: view.current.y, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const m = mode.current
    if (!m) return
    if (m.type === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const r = viewport.current!.getBoundingClientRect()
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const s = clampScale(m.s0 * (d / m.d0))
      const mx = (a.x + b.x) / 2 - r.left
      const my = (a.y + b.y) / 2 - r.top
      // keep the world point under the initial midpoint under the current midpoint
      const wx = (m.mx - m.tx0) / m.s0
      const wy = (m.my - m.ty0) / m.s0
      view.current = { s, x: mx - wx * s, y: my - wy * s }
      apply()
      syncZoom()
      return
    }
    if (m.type === 'pan') {
      const dx = e.clientX - m.sx
      const dy = e.clientY - m.sy
      if (Math.abs(dx) + Math.abs(dy) > 4) m.moved = true
      view.current.x = m.tx0 + dx
      view.current.y = m.ty0 + dy
      apply()
      return
    }
    if (m.type === 'token') {
      const dx = e.clientX - m.sx
      const dy = e.clientY - m.sy
      if (!m.moved && Math.abs(dx) + Math.abs(dy) < 6) return
      m.moved = true
      m.el.style.left = `${m.left0 + dx / view.current.s}px`
      m.el.style.top = `${m.top0 + dy / view.current.s}px`
      m.el.style.zIndex = '30'
      return
    }
    if (m.type === 'fog') {
      const w = toWorld(e.clientX, e.clientY)
      paintFog(m.last, w)
      m.last = w
      return
    }
    if (m.type === 'link') {
      const w = toWorld(e.clientX, e.clientY)
      m.cur = w
      setLinkDraft({ x: Math.min(m.start.x, w.x), y: Math.min(m.start.y, w.y), w: Math.abs(w.x - m.start.x), h: Math.abs(w.y - m.start.y) })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const m = mode.current
    const p = propsRef.current
    if (m?.type === 'pinch') {
      if (pointers.current.size === 0) mode.current = null
      else {
        // one finger still down: continue as pan
        const [a] = [...pointers.current.values()]
        mode.current = { type: 'pan', sx: a.x, sy: a.y, tx0: view.current.x, ty0: view.current.y, moved: true }
      }
      setZoom(view.current.s)
      return
    }
    if (pointers.current.size > 0) return
    mode.current = null
    if (!m) return
    if (m.type === 'pan' && !m.moved) {
      if (!p.multiSelect) p.onSelect([])
      return
    }
    if (m.type === 'token') {
      m.el.style.zIndex = ''
      if (!m.moved) {
        const id = m.id
        if (p.multiSelect || e.shiftKey) p.onSelect(p.selection.includes(id) ? p.selection.filter((x) => x !== id) : [...p.selection, id])
        else p.onSelect(p.selection.length === 1 && p.selection[0] === id ? [] : [id])
        return
      }
      const t = p.state.tokens.find((x) => x.id === m.id)
      if (!t) return
      const left = parseFloat(m.el.style.left)
      const top = parseFloat(m.el.style.top)
      const nx = Math.round((left - p.map.grid.offsetX) / gs)
      const ny = Math.round((top - p.map.grid.offsetY) / gs)
      m.el.style.left = `${p.map.grid.offsetX + nx * gs}px`
      m.el.style.top = `${p.map.grid.offsetY + ny * gs}px`
      p.onMoveToken(m.id, nx, ny)
      if (!p.selection.includes(m.id)) p.onSelect([m.id])
      return
    }
    if (m.type === 'linktap') {
      if (Math.abs(e.clientX - m.sx) + Math.abs(e.clientY - m.sy) < 8) p.onOpenLink?.(m.link)
      return
    }
    if (m.type === 'fog') {
      commitFog()
      return
    }
    if (m.type === 'link') {
      const r = { x: Math.min(m.start.x, m.cur.x), y: Math.min(m.start.y, m.cur.y), w: Math.abs(m.cur.x - m.start.x), h: Math.abs(m.cur.y - m.start.y) }
      setLinkDraft(null)
      if (r.w > gs / 2 && r.h > gs / 2) p.onCreateLink?.(r)
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const r = viewport.current!.getBoundingClientRect()
    const v = view.current
    const s = clampScale(v.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const wx = (mx - v.x) / v.s
    const wy = (my - v.y) / v.s
    view.current = { s, x: mx - wx * s, y: my - wy * s }
    apply()
    syncZoom()
  }

  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const prevent = (e: Event) => e.preventDefault()
    el.addEventListener('wheel', prevent, { passive: false })
    el.addEventListener('touchmove', prevent, { passive: false })
    const ro = new ResizeObserver(() => {
      /* keep view; nothing */
    })
    ro.observe(el)
    return () => {
      el.removeEventListener('wheel', prevent)
      el.removeEventListener('touchmove', prevent)
      ro.disconnect()
    }
  }, [])

  const screenCell = gs * zoom
  const showLabels = screenCell > 34
  const visibleTokens = player ? state.tokens.filter((t) => !t.hidden) : state.tokens

  return (
    <div
      ref={viewport}
      className={cx('relative size-full touch-none overflow-hidden bg-[#0b0908] select-none', tool !== 'select' ? 'cursor-crosshair' : 'cursor-grab')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={world} className="absolute top-0 left-0 origin-top-left will-change-transform" style={{ width: map.width, height: map.height }}>
        {imgUrl ? (
          <img src={imgUrl} width={map.width} height={map.height} className="pointer-events-none absolute inset-0 max-w-none" draggable={false} />
        ) : (
          <div className="absolute inset-0 bg-[#4a4236]" />
        )}
        {map.grid.visible && (
          <svg className="pointer-events-none absolute inset-0" width={map.width} height={map.height} style={{ opacity: map.grid.opacity }}>
            <defs>
              <pattern id={`grid-${map.id}`} x={map.grid.offsetX} y={map.grid.offsetY} width={gs} height={gs} patternUnits="userSpaceOnUse">
                <path d={`M ${gs} 0 L 0 0 0 ${gs}`} fill="none" stroke={map.grid.color} strokeWidth={Math.max(1.2 / zoom, gs * 0.02)} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#grid-${map.id})`} />
          </svg>
        )}

        {!player &&
          map.links.map((l) => (
            <div
              key={l.id}
              data-link={l.id}
              className="absolute rounded-md border-2 border-dashed border-sky-400/80 bg-sky-400/10"
              style={{ left: l.x, top: l.y, width: l.w, height: l.h }}
            >
              <span
                className="absolute top-0 left-0 flex origin-top-left items-center gap-1 rounded-br-md bg-sky-500/90 px-1.5 py-0.5 font-semibold whitespace-nowrap text-white"
                style={{ fontSize: Math.min(l.h * 0.3, 14 / zoom) }}
              >
                <Link2 style={{ width: '1em', height: '1em' }} />
                {l.label}
              </span>
            </div>
          ))}
        {linkDraft && <div className="absolute border-2 border-sky-400 bg-sky-400/20" style={{ left: linkDraft.x, top: linkDraft.y, width: linkDraft.w, height: linkDraft.h }} />}

        {visibleTokens.map((t) => (
          <TokenView
            key={t.id}
            t={t}
            map={map}
            selected={selection.includes(t.id)}
            active={state.combat.active && state.combat.turnId === t.id}
            player={!!player}
            showLabel={showLabels}
            zoom={zoom}
          />
        ))}

        <canvas
          ref={fog}
          className={cx('pointer-events-none absolute inset-0', !state.fogEnabled && 'hidden')}
          style={{ width: map.width, height: map.height, opacity: player ? 1 : 0.55, filter: player ? 'blur(3px)' : undefined, zIndex: player ? 50 : 5 }}
        />
      </div>
    </div>
  )
})

const clampScale = (s: number) => Math.max(0.05, Math.min(8, s))

function TokenView({ t, map, selected, active, player, showLabel, zoom }: { t: Token; map: BattleMap; selected: boolean; active: boolean; player: boolean; showLabel: boolean; zoom: number }) {
  const gs = map.grid.size
  const size = t.size * gs
  const ctx = useOptionalCampaign()
  // live art: explicit token image, else the source's current art (rules-entry art, campaign entry, party portrait)
  const artId =
    t.image ??
    (t.refId && ctx
      ? (ctx.campaign.refImages?.[t.refId]?.[0] ?? ctx.index.byId.get(t.refId)?.images[0] ?? ctx.campaign.party.find((m) => m.id === t.refId)?.image)
      : undefined)
  const img = useAssetUrl(artId)
  const dead = t.hp !== undefined && t.hp <= 0
  const hpPct = t.hp !== undefined && t.maxHp ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : null
  const ring = active ? '#f0b862' : selected ? '#6aa8d8' : t.color
  const fs = Math.max(10, size * 0.3)
  return (
    <div
      data-token={t.id}
      className={cx('absolute touch-none', t.hidden && 'opacity-50')}
      style={{ left: map.grid.offsetX + t.x * gs, top: map.grid.offsetY + t.y * gs, width: size, height: size, zIndex: active ? 20 : selected ? 15 : t.kind === 'pc' ? 12 : 10 }}
    >
      <div
        className={cx('absolute inset-[6%] overflow-hidden rounded-full shadow-[0_2px_8px_rgba(0,0,0,.6)]', dead && 'grayscale')}
        style={{
          border: `${Math.max(2, size * 0.07)}px solid ${ring}`,
          boxShadow: active ? `0 0 ${size * 0.35}px ${size * 0.08}px #f0b862` : selected ? `0 0 ${size * 0.25}px #6aa8d8` : undefined,
          background: img ? '#000' : `radial-gradient(circle at 35% 30%, ${t.color}, #1a1512)`,
        }}
      >
        {img ? (
          <img src={img} className="pointer-events-none size-full object-cover" draggable={false} />
        ) : (
          <div className="flex size-full items-center justify-center font-bold text-white drop-shadow" style={{ fontSize: fs }}>
            {t.label ?? t.name.slice(0, 2)}
          </div>
        )}
        {dead && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Skull style={{ width: size * 0.5, height: size * 0.5 }} className="text-white/80" />
          </div>
        )}
      </div>
      {t.hidden && !player && <EyeOff className="absolute -top-1 -right-1 rounded-full bg-black p-0.5 text-white" style={{ width: size * 0.3, height: size * 0.3 }} />}
      {!player && hpPct !== null && (
        <div className="absolute right-[10%] bottom-0 left-[10%] overflow-hidden rounded-full bg-black/70" style={{ height: Math.max(3, size * 0.09) }}>
          <div className="h-full" style={{ width: `${hpPct * 100}%`, background: hpPct > 0.5 ? '#6fbf73' : hpPct > 0.25 ? '#e0a54b' : '#e0604b' }} />
        </div>
      )}
      {t.conditions.length > 0 && (
        <div className="absolute -top-[8%] left-0 flex flex-wrap gap-[2px]" style={{ maxWidth: size }}>
          {t.conditions.slice(0, 4).map((c) => (
            <span key={c.name} className="rounded-full bg-[#f08fb0] font-bold text-black" style={{ fontSize: Math.max(7, size * 0.16), padding: `0 ${size * 0.05}px` }}>
              {c.name.slice(0, 3)}
              {c.value ?? ''}
            </span>
          ))}
        </div>
      )}
      {showLabel && (
        <div
          className="pointer-events-none absolute top-full left-1/2 mt-[2px] -translate-x-1/2 rounded bg-black/70 px-1 whitespace-nowrap text-white"
          style={{ fontSize: Math.min(size * 0.28, 13 / zoom) }}
        >
          {t.name}
        </div>
      )}
    </div>
  )
}
