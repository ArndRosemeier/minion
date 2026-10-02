import { useEffect, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { createMap, updateMap, userCtx } from '@/db/repo'
import { generateBattlemapImage } from '@/ai/generate'
import { cropToDataUrl } from '@/lib/mapImage'
import { newId } from '@/lib/id'
import { toast } from '@/state/ui'
import { Button, Field, Input, Modal, Segmented, Select, Textarea, Toggle } from '@/components/ui'
import type { BattleMap, MapLink } from '@/types'

/** Create or edit a link region: point to an existing map or create (and paint) a sub-map. */
export function LinkDialog({
  map,
  link,
  onClose,
}: {
  map: BattleMap
  /** existing link or a fresh rectangle */
  link: MapLink | { x: number; y: number; w: number; h: number } | null
  onClose: () => void
}) {
  const { campaign, maps } = useCampaign()
  const existing = link && 'id' in link ? link : null
  const [label, setLabel] = useState('')
  const [mode, setMode] = useState<'existing' | 'new'>('new')
  const [target, setTarget] = useState('')
  const [desc, setDesc] = useState('')
  const [cols, setCols] = useState(20)
  const [rows, setRows] = useState(15)
  const [paint, setPaint] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!link) return
    setLabel(existing?.label ?? '')
    setTarget(existing?.targetMapId ?? '')
    setMode(existing?.targetMapId ? 'existing' : 'new')
    const ratio = link.w / link.h
    const c = Math.max(12, Math.min(40, Math.round(link.w / map.grid.size) * 2))
    setCols(c)
    setRows(Math.max(8, Math.round(c / ratio)))
    setDesc('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link])

  if (!link) return null
  const others = maps.filter((m) => m.id !== map.id)

  const save = async () => {
    setBusy(true)
    try {
      let targetMapId = mode === 'existing' ? target || undefined : undefined
      if (mode === 'new') {
        const sub = await createMap(
          campaign.id,
          {
            name: label || 'Sub-map',
            description: desc || `${label} — a detailed area inside “${map.name}”. ${map.description}`,
            parentId: map.id,
            width: cols * 70,
            height: rows * 70,
          },
          userCtx(),
        )
        targetMapId = sub.id
        if (paint) {
          toast('Painting sub-map… this can take a minute', 'info')
          const reference = map.image ? await cropToDataUrl(map.image, link) : undefined
          const r = await generateBattlemapImage(campaign, sub.description, { cols, rows, reference })
          await updateMap(sub.id, { image: r.asset.id, width: r.asset.width, height: r.asset.height, prompt: r.prompt, grid: { ...sub.grid, size: r.gridSize } })
        }
      }
      const l: MapLink = { id: existing?.id ?? newId('lnk'), x: link.x, y: link.y, w: link.w, h: link.h, label: label || 'Area', targetMapId, locationId: existing?.locationId }
      const links = existing ? map.links.map((x) => (x.id === l.id ? l : x)) : [...map.links, l]
      await updateMap(map.id, { links }, userCtx())
      onClose()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? 'Edit area link' : 'New area link'}
      footer={
        <>
          {existing && (
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={async () => {
                await updateMap(map.id, { links: map.links.filter((x) => x.id !== existing.id) }, userCtx())
                onClose()
              }}
            >
              Remove
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} icon={mode === 'new' && paint ? <ImagePlus className="size-4" /> : undefined}>
            {mode === 'new' ? (paint ? 'Create & paint' : 'Create') : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Label">
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Crypt, Watchtower, Collapsed Mine" />
        </Field>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'new', label: 'New sub-map' },
            { value: 'existing', label: 'Existing map' },
          ]}
        />
        {mode === 'existing' ? (
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— choose —</option>
            {others.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        ) : (
          <div className="space-y-3">
            <Field label="What is there?" hint="Leave empty to derive from the label and the parent map.">
              <Textarea minRows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Width (squares)">
                <Input type="number" value={cols} onChange={(e) => setCols(Number(e.target.value) || 10)} />
              </Field>
              <Field label="Height (squares)">
                <Input type="number" value={rows} onChange={(e) => setRows(Number(e.target.value) || 10)} />
              </Field>
            </div>
            <Toggle checked={paint} onChange={setPaint} label="Paint it now (uses the parent map area as reference)" />
          </div>
        )}
      </div>
    </Modal>
  )
}
