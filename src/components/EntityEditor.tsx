import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { BookOpen, ImagePlus, Minus, Plus, Star, Trash2, Upload, X } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { createEntity, saveAsset, updateEntity, userCtx } from '@/db/repo'
import { db } from '@/db/db'
import { ENTITY_TYPE_ORDER, ENTITY_TYPES } from '@/lib/entityTypes'
import { generateIllustration, entitySubject } from '@/ai/generate'
import { GeneratePanel } from './GeneratePanel'
import { useUI, toast } from '@/state/ui'
import { resolveCreature } from '@/lib/creatures'
import { encounterDifficulty } from '@/lib/encounterMath'
import { LEVELED_TYPES, levelFor } from '@/lib/levels'
import { AssetImage } from './AssetImage'
import { CreaturePicker } from './CreaturePicker'
import { StatBlockEditor, blankStats } from './StatBlockEditor'
import { Button, cx, Field, IconButton, Input, Modal, Segmented, Select, Textarea } from './ui'
import type { Entity, EntityType } from '@/types'

interface EditorState {
  target: { id?: string; draft?: Partial<Entity> } | null
  open: (t: { id?: string; draft?: Partial<Entity> }) => void
  close: () => void
}

export const useEditor = create<EditorState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))

export function EntityEditorHost() {
  const target = useEditor((s) => s.target)
  const close = useEditor((s) => s.close)
  if (!target) return null
  return <EntityEditor key={target.id ?? 'new'} target={target} onClose={close} />
}

type Tab = 'content' | 'stats' | 'encounter' | 'images'

function EntityEditor({ target, onClose }: { target: { id?: string; draft?: Partial<Entity> }; onClose: () => void }) {
  const { campaign, entities, maps, index } = useCampaign()
  const openDetail = useUI((s) => s.openDetail)
  const existing = target.id ? index.byId.get(target.id) : undefined
  const [e, setE] = useState<Partial<Entity>>(() =>
    existing
      ? structuredClone(existing)
      : { type: 'npc', name: '', aliases: [], summary: '', body: '', tags: [], images: [], ...target.draft },
  )
  const [tab, setTab] = useState<Tab>('content')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const set = (patch: Partial<Entity>) => setE((x) => ({ ...x, ...patch }))
  const type = (e.type ?? 'npc') as EntityType
  // level inherited from parents / referencing chapter when not set on the entry itself
  const inheritedLevel = useMemo(() => levelFor({ ...e, level: undefined }, entities, campaign), [e.parentId, e.name, entities, campaign])

  useEffect(() => {
    if (type === 'encounter' && !e.encounter) set({ encounter: { creatures: [] } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  const parents = useMemo(() => {
    const want: EntityType[] = type === 'scene' ? ['chapter'] : type === 'location' ? ['location', 'dungeon'] : ['chapter', 'location', 'dungeon', 'faction']
    return entities.filter((x) => want.includes(x.type) && x.id !== existing?.id)
  }, [entities, type, existing?.id])

  const save = async () => {
    if (!e.name?.trim()) {
      toast('Please enter a name', 'error')
      return
    }
    setSaving(true)
    try {
      const ctx = userCtx()
      let saved: Entity
      if (existing) saved = await updateEntity(existing.id, e, ctx)
      else saved = await createEntity(campaign.id, type, e, ctx)
      onClose()
      if (!existing) openDetail({ kind: 'entity', id: saved.id })
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const tabs: { value: Tab; label: string }[] = [
    { value: 'content', label: 'Content' },
    { value: 'stats', label: 'Stats' },
    ...(type === 'encounter' ? [{ value: 'encounter' as Tab, label: 'Encounter' }] : []),
    { value: 'images', label: `Images${e.images?.length ? ` (${e.images.length})` : ''}` },
  ]

  return (
    <Modal
      open
      wide="xl"
      onClose={onClose}
      title={existing ? `Edit ${ENTITY_TYPES[type].label}` : `New ${ENTITY_TYPES[type].label}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={generating} title={generating ? 'The AI saves its result itself' : undefined} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={tab} onChange={setTab} options={tabs} size="sm" />
        </div>

        {tab === 'content' && (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4">
              <Field label="Name">
                <Input autoFocus={!existing} value={e.name ?? ''} onChange={(ev) => set({ name: ev.target.value })} />
              </Field>
            <Field label="Summary" hint="One line, shown in lists and given to the AI as context.">
              <Input value={e.summary ?? ''} onChange={(ev) => set({ summary: ev.target.value })} />
            </Field>
            <Field
              label="Text"
              hint={
                <>
                  Markdown. Link with <code>[[Name]]</code>, <code>[[spell:Fireball]]</code> or <code>[[Name|shown text]]</code>. Use <code>&gt; …</code> for read-aloud boxes.
                </>
              }
            >
              <Textarea minRows={14} value={e.body ?? ''} onChange={(ev) => set({ body: ev.target.value })} className="font-mono text-sm" />
            </Field>
            <Field label="GM secrets">
              <Textarea minRows={2} value={e.secrets ?? ''} onChange={(ev) => set({ secrets: ev.target.value })} className="font-mono text-sm" />
            </Field>
            </div>
            <div className="space-y-4">
              <Field label="Type">
                <Select value={type} onChange={(ev) => set({ type: ev.target.value as EntityType })}>
                  {ENTITY_TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>
                      {ENTITY_TYPES[t].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Aliases (comma separated)">
                <Input
                  value={(e.aliases ?? []).join(', ')}
                  onChange={(ev) => set({ aliases: ev.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                />
              </Field>
              <Field label="Tags (comma separated)">
                <Input
                  value={(e.tags ?? []).join(', ')}
                  onChange={(ev) => set({ tags: ev.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
                />
              </Field>
              {parents.length > 0 && (
                <Field label="Belongs to">
                  <Select value={e.parentId ?? ''} onChange={(ev) => set({ parentId: ev.target.value || undefined })}>
                    <option value="">—</option>
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        {ENTITY_TYPES[p.type].label}: {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {LEVELED_TYPES.includes(type) && (
                <Field label="Party level here" hint={e.level === undefined ? `Inherited: ${inheritedLevel}` : 'Children inherit this level.'}>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    placeholder={String(inheritedLevel)}
                    value={e.level ?? ''}
                    onChange={(ev) => set({ level: ev.target.value === '' ? undefined : Number(ev.target.value) })}
                  />
                </Field>
              )}
              {(type === 'chapter' || type === 'scene') && (
                <Field label="Order">
                  <Input type="number" value={e.order ?? ''} onChange={(ev) => set({ order: Number(ev.target.value) })} />
                </Field>
              )}
              <GeneratePanel
                type={type}
                existingId={existing?.id}
                getDraft={() => e}
                onStart={() => setGenerating(true)}
                onDone={(id) => {
                  onClose()
                  openDetail({ kind: 'entity', id })
                }}
              />
            </div>
          </div>
        )}

        {tab === 'stats' && (
          <div className="space-y-3">
            {!e.stats ? (
              <div className="space-y-3 rounded-xl border border-dashed border-line-strong p-5 text-center">
                <p className="text-sm text-muted">No stat block. Add one if this can fight or be spawned on a battle map.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button icon={<Plus className="size-4" />} onClick={() => set({ stats: blankStats(campaign.system, campaign.partyLevel) })}>
                    Blank stat block
                  </Button>
                  <ImportStats onPick={(s) => set({ stats: structuredClone(s) })} />
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap justify-end gap-2">
                  <ImportStats onPick={(s) => set({ stats: structuredClone(s) })} label="Replace from rules" />
                  <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => set({ stats: undefined })}>
                    Remove stat block
                  </Button>
                </div>
                <StatBlockEditor value={e.stats} onChange={(stats) => set({ stats })} system={campaign.system} />
              </>
            )}
          </div>
        )}

        {tab === 'encounter' && e.encounter && (
          <EncounterEditor
            level={e.level ?? inheritedLevel}
            value={e.encounter}
            onChange={(encounter) => set({ encounter })}
            mapsSelect={
              <Field label="Battle map">
                <Select value={e.encounter.mapId ?? ''} onChange={(ev) => set({ encounter: { ...e.encounter!, mapId: ev.target.value || undefined } })}>
                  <option value="">— none —</option>
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
            }
          />
        )}

        {tab === 'images' && <ImagesEditor entity={e} onChange={(images) => set({ images })} />}
      </div>
    </Modal>
  )
}

function ImportStats({ onPick, label = 'Import from rules / campaign' }: { onPick: (s: NonNullable<Entity['stats']>) => void; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" icon={<BookOpen className="size-4" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Pick a creature">
        <CreaturePicker
          autoFocus
          className="h-[60vh]"
          onPick={(c) => {
            if (!c.stats) return toast('That one has no stats', 'error')
            onPick(c.stats)
            setOpen(false)
          }}
        />
      </Modal>
    </>
  )
}

function EncounterEditor({
  value,
  onChange,
  mapsSelect,
  level,
}: {
  level: number
  value: NonNullable<Entity['encounter']>
  onChange: (v: NonNullable<Entity['encounter']>) => void
  mapsSelect: React.ReactNode
}) {
  const { campaign, index, compendiumVersion } = useCampaign()
  const [picking, setPicking] = useState(false)
  const diff = useMemo(
    () =>
      encounterDifficulty(
        campaign.system,
        value.creatures.map((c) => ({ count: c.count, stats: resolveCreature(c.refId, c.name, index, campaign.system)?.stats })),
        level,
        campaign.partySize,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.creatures, campaign, index, compendiumVersion, level],
  )
  const setCount = (i: number, d: number) =>
    onChange({
      ...value,
      creatures: value.creatures.map((c, j) => (j === i ? { ...c, count: c.count + d } : c)).filter((c) => c.count > 0),
    })
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-center justify-between text-sm">
          <span>
            Difficulty: <b className="text-accent">{diff.label}</b> <span className="text-muted">({diff.xp} XP)</span>
          </span>
          <span className="text-xs text-faint">
            Party {campaign.partySize} × lvl {level}
          </span>
        </div>
        <div className="mt-2 flex gap-1 text-[11px] text-faint">
          {diff.scale.map((s) => (
            <span key={s.label} className={cx('rounded px-1.5 py-0.5', diff.label === s.label && 'bg-accent/20 text-accent')}>
              {s.label} {s.xp}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {value.creatures.map((c, i) => {
          const info = resolveCreature(c.refId, c.name, index, campaign.system)
          return (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
              {!info?.stats && <span className="text-xs text-danger">no stats</span>}
              <IconButton size="sm" label="Less" icon={<Minus />} onClick={() => setCount(i, -1)} />
              <span className="w-6 text-center font-semibold">{c.count}</span>
              <IconButton size="sm" label="More" icon={<Plus />} onClick={() => setCount(i, 1)} />
            </div>
          )
        })}
        <Button icon={<Plus className="size-4" />} onClick={() => setPicking(true)}>
          Add creature
        </Button>
      </div>
      {mapsSelect}
      <Field label="Tactics">
        <Textarea minRows={2} value={value.tactics ?? ''} onChange={(ev) => onChange({ ...value, tactics: ev.target.value })} />
      </Field>
      <Field label="Difficulty note">
        <Input value={value.difficulty ?? ''} placeholder={diff.label} onChange={(ev) => onChange({ ...value, difficulty: ev.target.value })} />
      </Field>
      <Modal open={picking} onClose={() => setPicking(false)} title="Add creature">
        <CreaturePicker
          autoFocus
          className="h-[60vh]"
          onPick={(c) => {
            onChange({ ...value, creatures: [...value.creatures, { refId: c.refId, name: c.name, count: 1 }] })
            setPicking(false)
          }}
        />
      </Modal>
    </div>
  )
}

function ImagesEditor({ entity, onChange }: { entity: Partial<Entity>; onChange: (ids: string[]) => void }) {
  const { campaign } = useCampaign()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [direction, setDirection] = useState('')
  const images = entity.images ?? []

  const upload = async (files: FileList | null) => {
    if (!files) return
    const ids: string[] = []
    for (const f of Array.from(files)) ids.push((await saveAsset(f, campaign.id)).id)
    onChange([...images, ...ids])
  }
  const generate = async () => {
    setBusy(true)
    try {
      const aspect = entity.type === 'npc' || entity.type === 'creature' ? '3:4' : entity.type === 'item' ? '1:1' : '16:9'
      const a = await generateIllustration(campaign, entitySubject({ images: [], aliases: [], tags: [], summary: '', body: '', ...entity } as Entity), {
        aspectRatio: aspect,
        direction,
      })
      onChange([a.id, ...images])
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((id, i) => (
          <div key={id} className="group relative overflow-hidden rounded-lg border border-line">
            <AssetImage id={id} className="aspect-square w-full object-cover" />
            {i === 0 && <span className="absolute top-1.5 left-1.5 rounded bg-accent px-1.5 text-[11px] font-bold text-accent-ink">MAIN</span>}
            <div className="absolute right-1.5 bottom-1.5 flex gap-1">
              {i > 0 && (
                <IconButton size="sm" variant="secondary" label="Make main" icon={<Star />} onClick={() => onChange([id, ...images.filter((x) => x !== id)])} />
              )}
              <IconButton size="sm" variant="secondary" label="Remove" icon={<X />} onClick={() => onChange(images.filter((x) => x !== id))} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Image direction (optional)" value={direction} onChange={(e) => setDirection(e.target.value)} />
        <Button variant="primary" icon={<ImagePlus className="size-4" />} loading={busy} onClick={generate}>
          Generate
        </Button>
        <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
          Upload
        </Button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
    </div>
  )
}

/** Remove assets no entity, map or campaign references anymore. */
export async function garbageCollectAssets(campaignId: string) {
  const [ents, maps, camp, assets] = await Promise.all([
    db.entities.where('campaignId').equals(campaignId).toArray(),
    db.maps.where('campaignId').equals(campaignId).toArray(),
    db.campaigns.get(campaignId),
    db.assets.where('campaignId').equals(campaignId).primaryKeys(),
  ])
  const used = new Set<string>()
  ents.forEach((e) => e.images.forEach((i) => used.add(i)))
  maps.forEach((m) => {
    if (m.image) used.add(m.image)
    for (const st of [m.state, m.initialState]) {
      if (st.fog) used.add(st.fog)
      st.tokens.forEach((t) => t.image && used.add(t.image))
    }
  })
  if (camp?.coverImage) used.add(camp.coverImage)
  Object.values(camp?.refImages ?? {}).forEach((ids) => ids.forEach((i) => used.add(i)))
  camp?.party.forEach((p) => p.image && used.add(p.image))
  const msgs = await db.messages.where('campaignId').equals(campaignId).toArray()
  msgs.forEach((m) => m.images?.forEach((i) => used.add(i)))
  const changes = await db.changes.where('campaignId').equals(campaignId).toArray()
  const changeText = JSON.stringify(changes.map((c) => [c.before, c.after]))
  const unused = assets.filter((id) => !used.has(id) && !changeText.includes(id))
  await db.assets.bulkDelete(unused)
  return unused.length
}
