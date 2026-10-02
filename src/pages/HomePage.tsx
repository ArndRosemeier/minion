import { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FolderOpen, KeyRound, MoreVertical, Plus, Save, Settings, Trash2, Upload } from 'lucide-react'
import { db } from '@/db/db'
import { createCampaign, deleteCampaign } from '@/db/repo'
import { exportAll, exportCampaign, importAll, importCampaign, openFile, readBackup, safeFileName, saveFile, type ImportPreview } from '@/lib/backup'
import { useSettings } from '@/state/settings'
import { toast } from '@/state/ui'
import { AssetImage } from '@/components/AssetImage'
import { Button, ConfirmModal, Field, IconButton, Input, MenuItem, Modal, PopoverMenu, Select, Textarea } from '@/components/ui'
import { SYSTEM_LABEL, type GameSystem } from '@/types'
import { Logo } from '@/components/Logo'

export const LANGUAGES = ['English', 'Deutsch', 'Français', 'Español', 'Italiano', 'Nederlands', 'Polski', 'Português', 'Svenska', 'Dansk', 'Norsk', 'Suomi', 'Čeština', 'Русский', '日本語', '中文', '한국어']

export function HomePage() {
  const nav = useNavigate()
  const campaigns = useLiveQuery(() => db.campaigns.orderBy('updatedAt').reverse().toArray(), [])
  const counts = useLiveQuery(async () => {
    const all = await db.entities.toArray()
    const m: Record<string, number> = {}
    all.forEach((e) => (m[e.campaignId] = (m[e.campaignId] ?? 0) + 1))
    return m
  }, [])
  const apiKey = useSettings((s) => s.settings.apiKey)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState<ImportPreview | null>(null)
  const [del, setDel] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const doImport = async () => {
    const f = await openFile()
    if (!f) return
    try {
      setImporting(await readBackup(f))
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const saveAll = async () => {
    setBusy(true)
    try {
      const data = await exportAll()
      await saveFile(data, `minion-backup-${new Date().toISOString().slice(0, 10)}.zip`, 'Minion backup')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="safe-top min-h-full">
      <header className="flex flex-wrap items-center gap-3 px-5 pt-6 pb-4 lg:px-8">
        <Logo />
        <div className="flex-1" />
        <Button variant="ghost" icon={<FolderOpen className="size-4" />} onClick={doImport}>
          <span className="hidden sm:inline">Load…</span>
        </Button>
        <Button variant="ghost" icon={<Save className="size-4" />} loading={busy} onClick={saveAll}>
          <span className="hidden sm:inline">Save all</span>
        </Button>
        <Link to="/settings">
          <IconButton label="Settings" icon={<Settings />} />
        </Link>
      </header>

      <main className="space-y-6 px-5 pb-16 lg:px-8">
        {!apiKey && (
          <Link to="/settings" className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm hover:bg-accent/15">
            <KeyRound className="size-5 text-accent" />
            <span>
              <b>Add your OpenRouter API key</b> to use AI authoring and image generation. Playing works fully offline without it.
            </span>
          </Link>
        )}

        <div className="flex items-end justify-between gap-3">
          <h1 className="font-display text-3xl">Campaigns</h1>
          <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
            New campaign
          </Button>
        </div>

        {campaigns && campaigns.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line-strong p-10 text-center">
            <div className="font-display text-xl">Your table awaits.</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Create a campaign and build it with the AI — from a one-click module to hand-crafted chapters. Or load a campaign file from another device.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New campaign
              </Button>
              <Button icon={<Upload className="size-4" />} onClick={doImport}>
                Import
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
          {campaigns?.map((c) => (
            <div key={c.id} className="group relative overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-line-strong">
              <button className="block w-full text-left" onClick={() => nav(`/c/${c.id}`)}>
                <div className="relative aspect-[16/9] bg-gradient-to-br from-surface-3 to-surface-2">
                  {c.coverImage && <AssetImage id={c.coverImage} className="size-full object-cover" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
                  <div className="absolute right-4 bottom-3 left-4">
                    <div className="font-display text-xl leading-tight text-white drop-shadow">{c.name}</div>
                    <div className="mt-1 text-xs text-white/70">
                      {SYSTEM_LABEL[c.system]} · Level {c.partyLevel} · {c.language}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
                  <span>{counts?.[c.id] ?? 0} entries</span>
                  <span>{new Date(c.updatedAt).toLocaleDateString()}</span>
                </div>
              </button>
              <div className="absolute top-2 right-2">
                <PopoverMenu
                  width={200}
                  trigger={(open) => <IconButton label="More" variant="secondary" size="sm" icon={<MoreVertical />} className="bg-black/50 backdrop-blur" onClick={open} />}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        icon={<Download className="size-4" />}
                        onClick={async () => {
                          close()
                          await saveFile(await exportCampaign(c.id), `${safeFileName(c.name)}.minion`)
                        }}
                      >
                        Export campaign
                      </MenuItem>
                      <MenuItem
                        danger
                        icon={<Trash2 className="size-4" />}
                        onClick={() => {
                          close()
                          setDel({ id: c.id, name: c.name })
                        }}
                      >
                        Delete
                      </MenuItem>
                    </>
                  )}
                </PopoverMenu>
              </div>
            </div>
          ))}
        </div>
      </main>

      <NewCampaignModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => nav(`/c/${id}/builder`)} />
      <ImportModal preview={importing} onClose={() => setImporting(null)} onDone={(id) => id && nav(`/c/${id}`)} />
      <ConfirmModal
        open={!!del}
        onClose={() => setDel(null)}
        title={`Delete “${del?.name}”?`}
        text="This permanently deletes the campaign with all entries, maps and images on this device. Export it first if you want a backup."
        danger
        confirmLabel="Delete forever"
        onConfirm={() => del && deleteCampaign(del.id)}
      />
    </div>
  )
}

function NewCampaignModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [system, setSystem] = useState<GameSystem>('pf2e')
  const [language, setLanguage] = useState('Deutsch')
  const [level, setLevel] = useState(1)
  const [size, setSize] = useState(4)
  const [premise, setPremise] = useState('')
  const create = async () => {
    const c = await createCampaign({ name: name.trim() || 'Untitled Campaign', system, language, partyLevel: level, partySize: size, premise })
    onClose()
    onCreated(c.id)
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New campaign"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus placeholder="e.g. The Sunken Crown" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="System">
            <Select value={system} onChange={(e) => setSystem(e.target.value as GameSystem)}>
              <option value="pf2e">{SYSTEM_LABEL.pf2e}</option>
              <option value="dnd5e">{SYSTEM_LABEL.dnd5e}</option>
            </Select>
          </Field>
          <Field label="Content language" hint="For AI-written text. Rules stay English.">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Starting level">
            <Input type="number" min={1} max={20} value={level} onChange={(e) => setLevel(Number(e.target.value) || 1)} />
          </Field>
          <Field label="Party size">
            <Input type="number" min={1} max={8} value={size} onChange={(e) => setSize(Number(e.target.value) || 4)} />
          </Field>
        </div>
        <Field label="Premise (optional)" hint="A few words or a paragraph. The AI can also invent one.">
          <Textarea minRows={3} value={premise} onChange={(e) => setPremise(e.target.value)} placeholder="Goblins have stolen the bells of a mountain monastery…" />
        </Field>
      </div>
    </Modal>
  )
}

function ImportModal({ preview, onClose, onDone }: { preview: ImportPreview | null; onClose: () => void; onDone: (id?: string) => void }) {
  const [busy, setBusy] = useState(false)
  if (!preview) return null
  const run = async (mode: 'replace' | 'copy' | 'all') => {
    setBusy(true)
    try {
      if (preview.kind === 'all') {
        await importAll(preview.files)
        toast('Backup restored', 'success')
        await useSettings.getState().load()
        onClose()
        onDone()
      } else {
        const id = await importCampaign(preview.files, mode === 'copy' ? 'copy' : 'replace')
        toast('Campaign imported', 'success')
        onClose()
        onDone(id)
      }
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={preview.kind === 'all' ? 'Restore full backup' : 'Import campaign'}>
      {preview.kind === 'all' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This <b className="text-danger">replaces everything</b> on this device with the backup ({preview.campaigns.length} campaigns: {preview.campaigns.join(', ')}). Your API key is kept.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => run('all')}>
              Replace everything
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Import <b className="text-ink">{preview.name}</b>.{' '}
            {preview.exists ? 'This campaign already exists on this device. Update it (replace with the file’s version) or keep both?' : ''}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {preview.exists && (
              <Button loading={busy} onClick={() => run('copy')}>
                Keep both
              </Button>
            )}
            <Button variant="primary" loading={busy} onClick={() => run('replace')}>
              {preview.exists ? 'Replace' : 'Import'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
