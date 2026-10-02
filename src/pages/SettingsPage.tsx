import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { DEFAULT_ADVISORS, useSettings } from '@/state/settings'
import { listModels } from '@/ai/openrouter'
import { ModelPicker } from '@/components/ModelPicker'
import { Button, Card, Field, IconButton, Input, Segmented, Textarea, Toggle } from '@/components/ui'
import { newId } from '@/lib/id'
import type { CompendiumManifest } from '@/types'
import { Markdown } from '@/components/Markdown'

export function SettingsPage() {
  const { settings, update } = useSettings()
  const [showKey, setShowKey] = useState(false)
  const [keyState, setKeyState] = useState<'idle' | 'ok' | 'bad' | 'testing'>('idle')
  const [missing, setMissing] = useState<string[]>([])
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const [credits, setCredits] = useState<CompendiumManifest[]>([])

  useEffect(() => {
    navigator.storage?.estimate?.().then(async (e) => setStorage({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: (await navigator.storage.persisted?.()) ?? false }))
    Promise.all(
      ['pf2e', 'dnd5e'].map((s) =>
        fetch(`${import.meta.env.BASE_URL}compendium/${s}/manifest.json`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((m) => setCredits(m.filter(Boolean)))
  }, [])

  useEffect(() => {
    listModels()
      .then((models) => {
        const ids = new Set(models.map((m) => m.id))
        setMissing([settings.chatModel, settings.fastModel, settings.imageModel].filter((id) => id && !ids.has(id)))
      })
      .catch(() => {})
  }, [settings.chatModel, settings.fastModel, settings.imageModel])

  const testKey = async () => {
    setKeyState('testing')
    try {
      const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${settings.apiKey}` } })
      setKeyState(r.ok ? 'ok' : 'bad')
    } catch {
      setKeyState('bad')
    }
  }

  const setAdvisor = (id: string, patch: Partial<(typeof settings.advisors)[number]>) =>
    update({ advisors: settings.advisors.map((a) => (a.id === id ? { ...a, ...patch } : a)) })

  return (
    <div className="safe-top space-y-6 px-5 py-6 pb-20 lg:px-8">
      <div className="flex items-center gap-2">
        <Link to="/">
          <IconButton label="Back" icon={<ArrowLeft />} />
        </Link>
        <h1 className="font-display text-2xl">Settings</h1>
      </div>

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
      <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <h2 className="font-display text-lg">OpenRouter</h2>
        <Field
          label="API key"
          hint={
            <>
              Stored only on this device. Get one at{' '}
              <a className="text-accent underline" href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                openrouter.ai/keys
              </a>
              .
            </>
          }
        >
          <div className="flex gap-2">
            <Input type={showKey ? 'text' : 'password'} value={settings.apiKey} placeholder="sk-or-…" onChange={(e) => update({ apiKey: e.target.value.trim() })} />
            <IconButton label={showKey ? 'Hide' : 'Show'} icon={showKey ? <EyeOff /> : <Eye />} onClick={() => setShowKey(!showKey)} />
            <Button onClick={testKey} loading={keyState === 'testing'} disabled={!settings.apiKey}>
              {keyState === 'ok' ? <CheckCircle2 className="size-4 text-success" /> : null}
              Test
            </Button>
          </div>
          {keyState === 'bad' && <div className="mt-1 text-xs text-danger">Key rejected.</div>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Main model (chat & authoring)" hint="Smart, tool-capable model.">
            <ModelPicker kind="chat" value={settings.chatModel} onChange={(chatModel) => update({ chatModel })} />
          </Field>
          <Field label="Fast model" hint="Image prompts, quick NPCs, advisors default.">
            <ModelPicker kind="chat" value={settings.fastModel} onChange={(fastModel) => update({ fastModel })} />
          </Field>
          <Field label="Image model" hint="Illustrations and battle maps.">
            <ModelPicker kind="image" value={settings.imageModel} onChange={(imageModel) => update({ imageModel })} />
          </Field>
          <Field label="AI context" hint="Auto sends the whole campaign while it is small, then switches to index + lookups.">
            <Segmented
              size="sm"
              value={settings.contextMode}
              onChange={(contextMode) => update({ contextMode })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'full', label: 'Always all' },
                { value: 'index', label: 'Index' },
              ]}
            />
          </Field>
        </div>
        {missing.length > 0 && <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">Not found on OpenRouter: {missing.join(', ')} — please pick another model.</div>}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-display text-lg">Reading & play</h2>
        <Toggle checked={settings.autoLink} onChange={(autoLink) => update({ autoLink })} label="Auto-link names of campaign entries in text" />
        <Toggle
          checked={settings.showAiActivity !== false}
          onChange={(showAiActivity) => update({ showAiActivity })}
          label="Show the AI’s thinking and writing live while it works"
        />
        <Field label="Dice color">
          <input type="color" value={settings.diceColor} onChange={(e) => update({ diceColor: e.target.value })} className="h-10 w-20 rounded-lg border border-line bg-surface-2" />
        </Field>
      </Card>

      <Card className="space-y-2 p-5">
        <h2 className="font-display text-lg">Storage</h2>
        {storage && (
          <p className="text-sm text-muted">
            Using {(storage.usage / 1e6).toFixed(1)} MB of {(storage.quota / 1e9).toFixed(1)} GB.{' '}
            {storage.persisted ? 'Storage is persistent.' : 'The browser may evict data under pressure — use “Save all” regularly.'}
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-display text-lg">Rules content & licenses</h2>
        {credits.length === 0 && <p className="text-sm text-muted">No bundled rules data found.</p>}
        {credits.map((c) => (
          <div key={c.system} className="space-y-1 text-xs text-muted">
            <div className="font-semibold text-ink">
              {c.system === 'pf2e' ? 'Pathfinder 2e' : 'D&D 5e'} — {c.categories.map((x) => `${x.count} ${x.category}`).join(', ')}
            </div>
            <Markdown text={`${c.license}\n\n${c.attribution}`} className="text-xs" autoLink={false} />
          </div>
        ))}
        <p className="text-xs text-faint">3D dice: @3d-dice/dice-box (MIT).</p>
      </Card>
      </div>
      <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Advisors</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => update({ advisors: DEFAULT_ADVISORS })}>
              Defaults
            </Button>
            <Button
              size="sm"
              icon={<Plus className="size-4" />}
              onClick={() => update({ advisors: [...settings.advisors, { id: newId('adv'), name: 'New advisor', emoji: '🦉', persona: '', enabled: true }] })}
            >
              Add
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted">Advisors give second opinions in the campaign chat. Each can use its own model.</p>
        <div className="grid items-start gap-4 grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))]">
        {settings.advisors.map((a) => (
          <div key={a.id} className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
            <div className="flex items-center gap-2">
              <Input className="w-14 text-center" value={a.emoji} onChange={(e) => setAdvisor(a.id, { emoji: e.target.value })} />
              <Input value={a.name} onChange={(e) => setAdvisor(a.id, { name: e.target.value })} />
              <Toggle checked={a.enabled} onChange={(enabled) => setAdvisor(a.id, { enabled })} />
              <IconButton label="Remove" icon={<Trash2 />} onClick={() => update({ advisors: settings.advisors.filter((x) => x.id !== a.id) })} />
            </div>
            <Textarea minRows={2} value={a.persona} placeholder="Who is this advisor and what do they look for?" onChange={(e) => setAdvisor(a.id, { persona: e.target.value })} />
            <ModelPicker kind="chat" value={a.model ?? ''} allowEmpty="Use fast model" onChange={(model) => setAdvisor(a.id, { model: model || undefined })} />
          </div>
        ))}
        </div>
      </Card>
      </div>
      </div>
    </div>
  )
}
