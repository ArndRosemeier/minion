import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ImagePlus, Map as MapIcon, Plus, Swords, Upload } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { createMap, saveAsset, updateEntity, updateMap, userCtx } from '@/db/repo'
import { generateBattlemapImage } from '@/ai/generate'
import { toast } from '@/state/ui'
import { AssetImage } from '@/components/AssetImage'
import { Button, Empty, Field, Input, Modal, Segmented, Select, Textarea } from '@/components/ui'
import type { BattleMap } from '@/types'

export function BattleListPage() {
  const { maps, campaign } = useCampaign()
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  const roots = useMemo(() => maps.filter((m) => !m.parentId || !maps.some((p) => p.id === m.parentId)).sort((a, b) => a.createdAt - b.createdAt), [maps])
  const children = (id: string) => maps.filter((m) => m.parentId === id)

  const render = (m: BattleMap, depth: number): React.ReactNode => (
    <div key={m.id} className="space-y-3">
      <MapCard m={m} onClick={() => nav(`/c/${campaign.id}/battle/${m.id}`)} depth={depth} />
      {children(m.id).length > 0 && <div className="space-y-3 border-l-2 border-line pl-4">{children(m.id).map((c) => render(c, depth + 1))}</div>}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5 p-5 lg:px-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl">Battle maps</h1>
            <p className="text-sm text-muted">Every map keeps its tokens, fog and combat state until you reset it.</p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New map
          </Button>
        </div>
        {maps.length === 0 && (
          <Empty icon={<MapIcon />} title="No maps yet">
            Paint a map from a description, upload your own, or let the Builder create maps for every encounter.
          </Empty>
        )}
        <div className="grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(min(380px,100%),1fr))]">{roots.map((m) => render(m, 0))}</div>
      </div>
      <NewMapModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => nav(`/c/${campaign.id}/battle/${id}`)} />
    </div>
  )
}

function MapCard({ m, onClick, depth }: { m: BattleMap; onClick: () => void; depth: number }) {
  const { entities } = useCampaign()
  const enc = entities.find((e) => e.type === 'encounter' && (e.id === m.encounterId || e.encounter?.mapId === m.id))
  return (
    <button onClick={onClick} className="block w-full overflow-hidden rounded-xl border border-line bg-surface text-left hover:border-line-strong">
      <div className={depth ? 'aspect-[21/9]' : 'aspect-[16/9]'}>
        {m.image ? <AssetImage id={m.image} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center bg-surface-2 text-faint"><MapIcon className="size-8" /></div>}
      </div>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{m.name}</div>
          <div className="truncate text-xs text-muted">
            {m.state.tokens.length} tokens
            {m.state.combat.active ? ` · combat round ${m.state.combat.round}` : ''}
            {m.links.length ? ` · ${m.links.length} areas` : ''}
          </div>
        </div>
        {enc && (
          <span className="flex items-center gap-1 rounded bg-danger/15 px-2 py-0.5 text-xs text-danger">
            <Swords className="size-3" /> {enc.name}
          </span>
        )}
      </div>
    </button>
  )
}

function NewMapModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { campaign, entities, maps } = useCampaign()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [source, setSource] = useState<'ai' | 'upload' | 'blank'>('ai')
  const [cols, setCols] = useState(30)
  const [rows, setRows] = useState(20)
  const [encounterId, setEncounterId] = useState('')
  const [parentId, setParentId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const encounters = entities.filter((e) => e.type === 'encounter')

  const create = async () => {
    setBusy(true)
    try {
      const enc = encounters.find((e) => e.id === encounterId)
      const description = desc || [enc?.name, enc?.body].filter(Boolean).join('\n') || name
      let map = await createMap(
        campaign.id,
        { name: name || enc?.name || 'New map', description, encounterId: enc?.id, parentId: parentId || undefined, width: cols * 70, height: rows * 70 },
        userCtx(),
      )
      if (enc?.encounter) await updateEntity(enc.id, { encounter: { ...enc.encounter, mapId: map.id } })
      if (source === 'upload' && file) {
        const a = await saveAsset(file, campaign.id)
        map = await updateMap(map.id, { image: a.id, width: a.width, height: a.height, grid: { ...map.grid, size: (a.width || cols * 70) / cols } })
      }
      if (source === 'ai') {
        const r = await generateBattlemapImage(campaign, description, { cols, rows })
        map = await updateMap(map.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...map.grid, size: r.gridSize } })
      }
      onClose()
      onCreated(map.id)
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New battle map"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} icon={source === 'ai' ? <ImagePlus className="size-4" /> : undefined} onClick={create} disabled={source === 'upload' && !file}>
            {source === 'ai' ? 'Paint map' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ambush at the Ford" />
        </Field>
        <Segmented
          size="sm"
          value={source}
          onChange={setSource}
          options={[
            { value: 'ai', label: 'Paint with AI' },
            { value: 'upload', label: 'Upload' },
            { value: 'blank', label: 'Blank' },
          ]}
        />
        {source === 'upload' && (
          <div className="flex items-center gap-2">
            <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
              Choose image
            </Button>
            <span className="truncate text-sm text-muted">{file?.name}</span>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        )}
        <Field label="Description" hint="Be concrete and organic: terrain, shape, features, light, mood. Any layout — a clearing, a ship, a sprawling cave complex.">
          <Textarea minRows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="A shallow river ford in a misty birch forest; a broken cart on the far bank, reeds and boulders for cover, a fallen tree bridging the deeper pool…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Width (squares)">
            <Input type="number" value={cols} onChange={(e) => setCols(Number(e.target.value) || 10)} />
          </Field>
          <Field label="Height (squares)">
            <Input type="number" value={rows} onChange={(e) => setRows(Number(e.target.value) || 10)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="For encounter">
            <Select value={encounterId} onChange={(e) => setEncounterId(e.target.value)}>
              <option value="">—</option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Inside map">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— top level —</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  )
}
