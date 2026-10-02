import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Cloud, CloudOff, ImagePlus, Link2, Minus, Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { deleteMap, saveAsset, updateMap, userCtx } from '@/db/repo'
import { generateBattlemapImage } from '@/ai/generate'
import { toast } from '@/state/ui'
import { Button, ConfirmModal, Field, IconButton, Input, LiveInput, Textarea, Toggle } from '@/components/ui'
import type { BattleMap, MapLink, MapState } from '@/types'
import type { MapCanvasHandle } from './MapCanvas'

export function MapSettingsPanel({
  map,
  state,
  commit,
  canvas,
  onEditLink,
}: {
  map: BattleMap
  state: MapState
  commit: (fn: (s: MapState) => MapState) => void
  canvas: React.RefObject<MapCanvasHandle | null>
  onEditLink: (l: MapLink) => void
}) {
  const { campaign } = useCampaign()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [direction, setDirection] = useState('')
  const [confirm, setConfirm] = useState<'reset' | 'save' | 'delete' | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const g = map.grid
  const setGrid = (patch: Partial<BattleMap['grid']>) => updateMap(map.id, { grid: { ...g, ...patch } })
  const [name, setName] = useState(map.name)
  const [desc, setDesc] = useState(map.description)

  const regenerate = async () => {
    setBusy(true)
    try {
      const cols = Math.max(5, Math.round(map.width / g.size))
      const rows = Math.max(5, Math.round(map.height / g.size))
      const r = await generateBattlemapImage(campaign, desc || map.name, { cols, rows, direction })
      await updateMap(
        map.id,
        { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...g, size: r.gridSize, offsetX: 0, offsetY: 0 } },
        userCtx(),
      )
      toast('New map painted', 'success')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <H>Setup</H>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setConfirm('reset')}>
            Reset map
          </Button>
          <Button size="sm" icon={<Save className="size-4" />} onClick={() => setConfirm('save')}>
            Save as start
          </Button>
        </div>
        <p className="text-xs text-faint">Reset restores tokens, fog and combat to the saved starting setup.</p>
      </section>

      <section className="space-y-3">
        <H>Fog of war</H>
        <Toggle checked={state.fogEnabled} onChange={(fogEnabled) => commit((s) => ({ ...s, fogEnabled }))} label="Fog enabled" />
        {state.fogEnabled && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" icon={<Cloud className="size-4" />} onClick={() => canvas.current?.fogCoverAll()}>
              Cover all
            </Button>
            <Button size="sm" icon={<CloudOff className="size-4" />} onClick={() => canvas.current?.fogRevealAll()}>
              Reveal all
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <H>Grid</H>
        <Toggle checked={g.visible} onChange={(visible) => setGrid({ visible })} label="Show grid" />
        <Stepper label="Cell size (px)" value={g.size} step={0.5} min={8} onChange={(size) => setGrid({ size })} />
        <Stepper label="Offset X" value={g.offsetX} step={1} min={-g.size} onChange={(offsetX) => setGrid({ offsetX })} />
        <Stepper label="Offset Y" value={g.offsetY} step={1} min={-g.size} onChange={(offsetY) => setGrid({ offsetY })} />
        <div className="text-xs text-faint">
          {Math.round(map.width / g.size)} × {Math.round(map.height / g.size)} squares. Line up the grid with the drawn floor tiles, if the image has any.
        </div>
        <div className="flex items-center gap-3">
          <input type="color" value={g.color} onChange={(e) => setGrid({ color: e.target.value })} className="h-9 w-14 rounded border border-line bg-surface-2" />
          <input type="range" min={0.05} max={1} step={0.05} value={g.opacity} onChange={(e) => setGrid({ opacity: Number(e.target.value) })} className="flex-1 accent-[var(--color-accent)]" />
        </div>
      </section>

      {map.links.length > 0 && (
        <section className="space-y-2">
          <H>Sub-map links</H>
          {map.links.map((l) => (
            <button key={l.id} onClick={() => onEditLink(l)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2">
              <Link2 className="size-4 text-sky-400" />
              <span className="flex-1 truncate">{l.label}</span>
              {!l.targetMapId && <span className="text-xs text-faint">no target</span>}
            </button>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <H>Map</H>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== map.name && updateMap(map.id, { name }, userCtx())} />
        </Field>
        <Field label="Description (used to paint the map)">
          <Textarea minRows={3} value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc !== map.description && updateMap(map.id, { description: desc }, userCtx())} />
        </Field>
        <Input placeholder="Direction for a new image (optional)" value={direction} onChange={(e) => setDirection(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="primary" icon={<ImagePlus className="size-4" />} loading={busy} onClick={regenerate}>
            {map.image ? 'Repaint' : 'Paint map'}
          </Button>
          <Button size="sm" icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>
            Upload image
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const a = await saveAsset(f, campaign.id)
            const cols = Math.max(5, Math.round(map.width / g.size))
            await updateMap(map.id, { image: a.id, width: a.width || map.width, height: a.height || map.height, grid: { ...g, size: (a.width || map.width) / cols } }, userCtx())
          }}
        />
        <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('delete')}>
          Delete map
        </Button>
      </section>

      <ConfirmModal
        open={confirm === 'reset'}
        onClose={() => setConfirm(null)}
        title="Reset map?"
        text="Tokens, HP, conditions, fog and combat go back to the saved starting setup."
        confirmLabel="Reset"
        onConfirm={() => commit(() => structuredClone(map.initialState))}
      />
      <ConfirmModal
        open={confirm === 'save'}
        onClose={() => setConfirm(null)}
        title="Save as starting setup?"
        text="The current tokens and fog become what “Reset” restores."
        confirmLabel="Save"
        onConfirm={async () => {
          const s = structuredClone(state)
          s.combat = { active: false, round: 0 }
          s.tokens = s.tokens.map((t) => ({ ...t, initiative: undefined }))
          await updateMap(map.id, { initialState: s }, userCtx())
          toast('Starting setup saved', 'success')
        }}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete “${map.name}”?`}
        text="Sub-maps are kept and move up one level. You can undo this in History."
        danger
        confirmLabel="Delete"
        onConfirm={async () => {
          await deleteMap(map.id, userCtx())
          nav(`/c/${campaign.id}/battle`)
        }}
      />
    </div>
  )
}

function H({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-bold tracking-widest text-faint uppercase">{children}</div>
}

function Stepper({ label, value, step, min, onChange }: { label: string; value: number; step: number; min: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-sm text-muted">{label}</span>
      <IconButton size="sm" variant="secondary" label="Less" icon={<Minus />} onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))} />
      <LiveInput
        type="number"
        value={+value.toFixed(2)}
        step={step}
        onCommit={(v) => onChange(Math.max(min, Number(v)))}
        className="!h-8 w-20 px-1 text-center text-sm"
      />
      <IconButton size="sm" variant="secondary" label="More" icon={<Plus />} onClick={() => onChange(+(value + step).toFixed(2))} />
    </div>
  )
}
