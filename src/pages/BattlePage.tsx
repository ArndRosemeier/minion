import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ArrowLeft,
  Brush,
  ChevronRight,
  Dices,
  Eraser,
  Hand,
  Link2,
  Maximize,
  MonitorPlay,
  PanelRight,
  Plus,
  Shapes,
  Skull,
  Swords,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { db } from '@/db/db'
import { useCampaign } from '@/state/campaign'
import { useBattle, type SpawnRequest } from '@/state/battle'
import { useUI, toast } from '@/state/ui'
import { MapCanvas, type MapCanvasHandle, type MapTool } from '@/components/battle/MapCanvas'
import { useMapController } from '@/components/battle/useMapController'
import { InitiativePanel } from '@/components/battle/InitiativePanel'
import { TokenPanel } from '@/components/battle/TokenPanel'
import { MapSettingsPanel } from '@/components/battle/MapSettingsPanel'
import { LinkDialog } from '@/components/battle/LinkDialog'
import { CreaturePicker } from '@/components/CreaturePicker'
import { QuickNpcModal } from '@/components/QuickNpc'
import { enterFullscreen, exitFullscreen } from '@/components/Showcase'
import { applyHp, cols, initiativeOrder, nextTurn, rows, tokenFromMember, tokenFromStats } from '@/lib/mapOps'
import { resolveCreature, type CreatureInfo } from '@/lib/creatures'
import { newId } from '@/lib/id'
import { Button, Empty, IconButton, Input, MenuItem, Modal, PopoverMenu, Segmented, cx } from '@/components/ui'
import type { BattleMap, MapLink, MapState } from '@/types'

export function BattlePage() {
  const { mapId } = useParams()
  const map = useLiveQuery(async () => (mapId ? ((await db.maps.get(mapId)) ?? null) : null), [mapId])
  const nav = useNavigate()
  const { campaign } = useCampaign()
  if (map === undefined) return null
  if (map === null)
    return (
      <Empty title="Map not found">
        <Button onClick={() => nav(`/c/${campaign.id}/battle`)}>All maps</Button>
      </Empty>
    )
  return <BattleView key={map.id} map={map} />
}

type PanelTab = 'combat' | 'token' | 'map'

function BattleView({ map }: { map: BattleMap }) {
  const { campaign, maps, entities, index } = useCampaign()
  const nav = useNavigate()
  const { state, ref, commit, commitFog } = useMapController(map)
  const canvas = useRef<MapCanvasHandle>(null)
  const selection = useBattle((s) => s.selection)
  const setSelection = useBattle((s) => s.setSelection)
  const setActiveMap = useBattle((s) => s.setActiveMap)
  const setApplyHandler = useBattle((s) => s.setApplyHandler)
  const pendingSpawn = useBattle((s) => s.pendingSpawn)
  const clearSpawn = useBattle((s) => s.clearSpawn)
  const openDice = useUI((s) => s.openDice)

  const [tool, setTool] = useState<MapTool>('select')
  const [brush, setBrush] = useState(3)
  const [multi, setMulti] = useState(false)
  const [panel, setPanel] = useState<PanelTab>('combat')
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 900)
  const [player, setPlayer] = useState(false)
  const [picker, setPicker] = useState(false)
  const [npcOpen, setNpcOpen] = useState(false)
  const [linkEdit, setLinkEdit] = useState<MapLink | { x: number; y: number; w: number; h: number } | null>(null)

  const bounds = { maxX: cols(map), maxY: rows(map) }
  const parent = map.parentId ? maps.find((m) => m.id === map.parentId) : undefined
  const encounters = useMemo(
    () => entities.filter((e) => e.type === 'encounter' && (e.encounter?.mapId === map.id || e.id === map.encounterId)),
    [entities, map.id, map.encounterId],
  )

  useEffect(() => {
    setActiveMap(map.id)
    setSelection([])
    return () => {
      setActiveMap(null)
      setSelection([])
      setApplyHandler(null)
    }
  }, [map.id, setActiveMap, setSelection, setApplyHandler])

  useEffect(() => {
    setApplyHandler((amount, mode) => {
      const ids = new Set(useBattle.getState().selection)
      if (!ids.size) return
      commit((s) => ({ ...s, tokens: s.tokens.map((t) => (ids.has(t.id) ? applyHp(t, amount, mode) : t)) }))
      toast(`${mode === 'heal' ? 'Healed' : 'Dealt'} ${mode === 'half' ? Math.floor(amount / 2) : amount} ${mode === 'heal' ? '' : 'damage '}to ${ids.size} token${ids.size > 1 ? 's' : ''}`, 'success')
    })
  }, [commit, setApplyHandler])

  useEffect(() => {
    if (selection.length) setPanel('token')
  }, [selection])

  const spawn = (req: SpawnRequest) => {
    const c = canvas.current?.viewCenterCell() ?? { x: 0, y: 0 }
    commit((s) => {
      let next = s
      for (let i = 0; i < (req.count ?? 1); i++) {
        const t = tokenFromStats(next, { kind: req.kind, name: req.name, refId: req.refId, stats: req.stats, image: req.image }, c, bounds)
        if (s.combat.active) t.initiative = 1 + Math.floor(Math.random() * 20) + (t.initBonus ?? 0)
        next = { ...next, tokens: [...next.tokens, t] }
      }
      return next
    })
  }

  useEffect(() => {
    if (pendingSpawn) {
      spawn(pendingSpawn)
      clearSpawn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSpawn])

  const addParty = () => {
    const c = canvas.current?.viewCenterCell() ?? { x: 0, y: 0 }
    const missing = campaign.party.filter((m) => !ref.current.tokens.some((t) => t.kind === 'pc' && t.refId === m.id))
    if (!campaign.party.length) return toast('Add characters on the Party page first', 'info')
    if (!missing.length) return toast('The whole party is already on the map', 'info')
    commit((s) => {
      let next = s
      for (const m of missing) next = { ...next, tokens: [...next.tokens, tokenFromMember(next, m, c, bounds)] }
      return next
    })
  }

  const addEncounter = (id: string) => {
    const e = entities.find((x) => x.id === id)
    if (!e?.encounter) return
    let missing = 0
    for (const c of e.encounter.creatures) {
      const info = resolveCreature(c.refId, c.name, index, campaign.system)
      if (!info) missing++
      spawn({ kind: info?.kind ?? 'monster', name: info?.name ?? c.name, refId: info?.refId ?? c.refId, stats: info?.stats, image: info?.image, count: c.count })
    }
    if (missing) toast(`${missing} creature${missing > 1 ? 's' : ''} without stat block were added as plain tokens`, 'info')
  }

  const addObject = () => {
    const c = canvas.current?.viewCenterCell() ?? { x: 0, y: 0 }
    commit((s) => ({
      ...s,
      tokens: [...s.tokens, { id: newId('tok'), kind: 'object', name: 'Marker', x: c.x, y: c.y, size: 1, conditions: [], color: '#6b7280', label: '★' }],
    }))
  }

  const openLink = (l: MapLink) => {
    if (l.targetMapId && maps.some((m) => m.id === l.targetMapId)) nav(`/c/${campaign.id}/battle/${l.targetMapId}`)
    else setLinkEdit(l)
  }

  const setToolSafe = (t: MapTool) => {
    if ((t === 'reveal' || t === 'hide') && !state.fogEnabled) commit((s) => ({ ...s, fogEnabled: true }))
    setTool(t)
  }

  const selectedTokens = state.tokens.filter((t) => selection.includes(t.id))
  const current = state.combat.active ? state.tokens.find((t) => t.id === state.combat.turnId) : undefined

  const canvasEl = (
    <MapCanvas
      ref={canvas}
      map={map}
      state={state}
      player={player}
      tool={player ? 'select' : tool}
      brush={brush}
      selection={selection}
      multiSelect={multi}
      onSelect={setSelection}
      onMoveToken={(id, x, y) => commit((s: MapState) => ({ ...s, tokens: s.tokens.map((t) => (t.id === id ? { ...t, x, y } : t)) }))}
      onFogCommit={commitFog}
      onCreateLink={(r) => setLinkEdit(r)}
      onOpenLink={openLink}
    />
  )

  if (player) {
    return (
      <div className="fixed inset-0 z-[65] bg-black">
        {canvasEl}
        <div className="safe-top pointer-events-none absolute inset-x-0 top-0 flex justify-end p-3">
          <button
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/70 backdrop-blur hover:text-white"
            onClick={() => {
              setPlayer(false)
              exitFullscreen()
            }}
          >
            <X className="size-3.5" /> GM view
          </button>
        </div>
        {state.combat.active && (
          <div className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center gap-3 p-4">
            <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-black/60 py-2 pr-2 pl-4 text-white backdrop-blur">
              <span className="text-xs text-white/60">Round {state.combat.round}</span>
              {current && !current.hidden && (
                <span className="flex items-center gap-2 font-display text-lg">
                  <span className="size-3 rounded-full" style={{ background: current.color }} />
                  {current.name}
                </span>
              )}
              {current?.hidden && <span className="font-display text-lg text-white/60">…</span>}
              <button className="flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/25" onClick={() => commit((s) => nextTurn(s, campaign.system))}>
                Next <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-line px-2">
        <IconButton label="Back" icon={<ArrowLeft />} onClick={() => nav(parent ? `/c/${campaign.id}/battle/${parent.id}` : `/c/${campaign.id}/battle`)} />
        <div className="min-w-0 shrink">
          {parent && <div className="truncate text-[11px] text-faint">{parent.name} ›</div>}
          <div className="max-w-48 truncate font-display text-sm">{map.name}</div>
        </div>
        <div className="flex-1" />
        <Segmented
          size="sm"
          value={tool}
          onChange={setToolSafe}
          options={[
            { value: 'select', label: <span className="hidden lg:inline">Move</span>, icon: <Hand /> },
            { value: 'reveal', label: <span className="hidden lg:inline">Reveal</span>, icon: <Eraser /> },
            { value: 'hide', label: <span className="hidden lg:inline">Fog</span>, icon: <Brush /> },
            { value: 'link', label: <span className="hidden lg:inline">Area</span>, icon: <Link2 /> },
          ]}
        />
        {(tool === 'reveal' || tool === 'hide') && (
          <Segmented
            size="sm"
            value={String(brush)}
            onChange={(v) => setBrush(Number(v))}
            options={[1, 3, 6, 12].map((b) => ({ value: String(b), label: b === 1 ? 'S' : b === 3 ? 'M' : b === 6 ? 'L' : 'XL' }))}
          />
        )}
        {tool === 'select' && (
          <button
            onClick={() => setMulti(!multi)}
            className={cx('h-8 rounded-md px-2.5 text-xs font-medium', multi ? 'bg-info/20 text-info' : 'text-muted hover:bg-surface-3')}
          >
            Multi
          </button>
        )}
        <PopoverMenu
          trigger={(open) => (
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={open}>
              Add
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={<Users className="size-4" />} onClick={() => (close(), addParty())}>
                Party
              </MenuItem>
              {encounters.map((e) => (
                <MenuItem key={e.id} icon={<Swords className="size-4 text-danger" />} onClick={() => (close(), addEncounter(e.id))}>
                  {e.name}
                </MenuItem>
              ))}
              <MenuItem icon={<Skull className="size-4" />} onClick={() => (close(), setPicker(true))}>
                Creature…
              </MenuItem>
              <MenuItem icon={<UserPlus className="size-4" />} onClick={() => (close(), setNpcOpen(true))}>
                NPC on the fly…
              </MenuItem>
              <MenuItem icon={<Shapes className="size-4" />} onClick={() => (close(), addObject())}>
                Marker
              </MenuItem>
            </>
          )}
        </PopoverMenu>
        <IconButton label="Dice" icon={<Dices />} onClick={() => openDice()} />
        <IconButton label="Fit map" icon={<Maximize />} onClick={() => canvas.current?.fit()} />
        <Button
          size="sm"
          variant="primary"
          icon={<MonitorPlay className="size-4" />}
          onClick={() => {
            setSelection([])
            setPlayer(true)
            enterFullscreen()
          }}
        >
          <span className="hidden sm:inline">Player view</span>
        </Button>
        <IconButton label="Panel" icon={<PanelRight />} onClick={() => setPanelOpen(!panelOpen)} />
      </div>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {canvasEl}
          {!map.image && (
            <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
              <div className="rounded-full bg-black/60 px-4 py-2 text-sm text-muted backdrop-blur">No image yet — paint or upload one in the Map panel.</div>
            </div>
          )}
          {state.combat.active && current && (
            <button
              onClick={() => commit((s) => nextTurn(s, campaign.system))}
              className="absolute bottom-4 left-4 flex items-center gap-3 rounded-2xl border border-accent/40 bg-black/70 py-2 pr-3 pl-4 text-left backdrop-blur"
            >
              <div>
                <div className="text-[10px] text-faint uppercase">Round {state.combat.round}</div>
                <div className="font-display text-ink">{current.name}</div>
              </div>
              <span className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-sm font-semibold text-accent-ink">
                Next <ChevronRight className="size-4" />
              </span>
            </button>
          )}
        </div>
        {panelOpen && (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(340px,90vw)] flex-col border-l border-line bg-surface/95 backdrop-blur md:static md:bg-surface">
            <div className="flex items-center gap-2 border-b border-line p-2">
              <Segmented
                size="sm"
                value={panel}
                onChange={setPanel}
                className="flex-1"
                options={[
                  { value: 'combat', label: `Combat${initiativeOrder(state).length ? ` (${initiativeOrder(state).length})` : ''}` },
                  { value: 'token', label: selection.length ? `Token (${selection.length})` : 'Token' },
                  { value: 'map', label: 'Map' },
                ]}
              />
              <IconButton size="sm" label="Close panel" icon={<X />} onClick={() => setPanelOpen(false)} className="md:hidden" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panel === 'combat' && (
                <InitiativePanel
                  state={state}
                  commit={commit}
                  selection={selection}
                  onPick={(t) => {
                    setSelection([t.id])
                    canvas.current?.centerOnCell(t.x, t.y)
                  }}
                />
              )}
              {panel === 'token' && <TokenPanel tokens={selectedTokens} commit={commit} onDeselect={() => setSelection([])} />}
              {panel === 'map' && <MapSettingsPanel map={map} state={state} commit={commit} canvas={canvas} onEditLink={setLinkEdit} />}
            </div>
          </aside>
        )}
      </div>

      <Modal open={picker} onClose={() => setPicker(false)} title="Add creature">
        <SpawnPicker
          onSpawn={(c, count) => {
            spawn({ kind: c.kind, name: c.name, refId: c.refId, stats: c.stats, image: c.image, count })
            setPicker(false)
          }}
        />
      </Modal>
      <QuickNpcModal
        open={npcOpen}
        onClose={() => setNpcOpen(false)}
        onCreated={async (id) => {
          const e = await db.entities.get(id)
          if (e) spawn({ kind: 'npc', name: e.name, refId: e.id, stats: e.stats, image: e.images[0] })
        }}
      />
      <LinkDialog map={map} link={linkEdit} onClose={() => setLinkEdit(null)} />
    </div>
  )
}

function SpawnPicker({ onSpawn }: { onSpawn: (c: CreatureInfo, count: number) => void }) {
  const [count, setCount] = useState(1)
  return (
    <div className="flex h-[65vh] flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-muted">
        Count
        <Input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} className="w-20 text-center" />
      </div>
      <CreaturePicker autoFocus className="min-h-0 flex-1" onPick={(c) => onSpawn(c, count)} />
    </div>
  )
}
