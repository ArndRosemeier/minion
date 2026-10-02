import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Download, ImagePlus, Recycle, Trash2, Upload } from 'lucide-react'
import { useCampaign } from '@/state/campaign'
import { deleteCampaign, saveAsset, updateCampaign } from '@/db/repo'
import { exportCampaign, safeFileName, saveFile } from '@/lib/backup'
import { generateIllustration } from '@/ai/generate'
import { garbageCollectAssets } from '@/components/EntityEditor'
import { AssetImage } from '@/components/AssetImage'
import { Button, Card, ConfirmModal, Field, Input, Select, Textarea } from '@/components/ui'
import { LANGUAGES } from './HomePage'
import { toast } from '@/state/ui'
import { SYSTEM_LABEL, type Campaign, type GameSystem } from '@/types'

/** Text field that saves on blur (avoids a DB write per keystroke). */
function useDraft<K extends keyof Campaign>(campaign: Campaign, key: K) {
  const [v, setV] = useState(campaign[key])
  useEffect(() => setV(campaign[key]), [campaign, key])
  return {
    value: v as any,
    onChange: (e: { target: { value: string } }) => setV(e.target.value as Campaign[K]),
    onBlur: () => v !== campaign[key] && updateCampaign(campaign.id, { [key]: v } as Partial<Campaign>),
  }
}

export function CampaignSettingsPage() {
  const { campaign } = useCampaign()
  const nav = useNavigate()
  const [del, setDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const name = useDraft(campaign, 'name')
  const premise = useDraft(campaign, 'premise')
  const tone = useDraft(campaign, 'tone')
  const art = useDraft(campaign, 'artStyle')
  const instr = useDraft(campaign, 'aiInstructions')
  const [lang, setLang] = useState(LANGUAGES.includes(campaign.language) ? campaign.language : '__custom')

  const cover = async () => {
    setBusy(true)
    try {
      const a = await generateIllustration(campaign, `Cover art for the campaign "${campaign.name}". ${campaign.premise} ${campaign.tone}`, { aspectRatio: '16:9' })
      await updateCampaign(campaign.id, { coverImage: a.id })
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5 p-5 pb-20 lg:px-8">
        <h1 className="font-display text-2xl">Campaign</h1>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:items-start">
        <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <div className="overflow-hidden rounded-xl border border-line">
            {campaign.coverImage ? <AssetImage id={campaign.coverImage} className="aspect-[16/9] w-full object-cover" /> : <div className="flex aspect-[16/9] items-center justify-center bg-surface-2 text-faint">No cover</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<ImagePlus className="size-4" />} loading={busy} onClick={cover}>
              Generate cover
            </Button>
            <Button size="sm" icon={<Upload className="size-4" />} onClick={() => file.current?.click()}>
              Upload cover
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) updateCampaign(campaign.id, { coverImage: (await saveAsset(f, campaign.id)).id })
              }}
            />
          </div>
          <Field label="Name">
            <Input {...name} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="System">
              <Select value={campaign.system} onChange={(e) => updateCampaign(campaign.id, { system: e.target.value as GameSystem })}>
                <option value="pf2e">{SYSTEM_LABEL.pf2e}</option>
                <option value="dnd5e">{SYSTEM_LABEL.dnd5e}</option>
              </Select>
            </Field>
            <Field label="Content language" hint="All AI-written text uses this language. Rules stay English.">
              <Select
                value={lang}
                onChange={(e) => {
                  setLang(e.target.value)
                  if (e.target.value !== '__custom') updateCampaign(campaign.id, { language: e.target.value })
                }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
                <option value="__custom">Other…</option>
              </Select>
              {lang === '__custom' && <Input className="mt-2" defaultValue={campaign.language} onBlur={(e) => updateCampaign(campaign.id, { language: e.target.value })} />}
            </Field>
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="font-display text-lg">Data</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Download className="size-4" />}
              onClick={async () => saveFile(await exportCampaign(campaign.id), `${safeFileName(campaign.name)}.minion`)}
            >
              Export campaign
            </Button>
            <Button
              icon={<Recycle className="size-4" />}
              onClick={async () => {
                const n = await garbageCollectAssets(campaign.id)
                toast(`Removed ${n} unused image${n === 1 ? '' : 's'}`, 'success')
              }}
            >
              Clean up unused images
            </Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDel(true)}>
              Delete campaign
            </Button>
          </div>
        </Card>
        </div>
        <Card className="space-y-4 p-5">
          <Field label="Premise">
            <Textarea minRows={3} {...premise} />
          </Field>
          <Field label="Tone & style" hint="E.g. “dark fairy tale, humor allowed, PG-13, sandboxy”.">
            <Textarea minRows={2} {...tone} />
          </Field>
          <Field label="Art style" hint="Used for every illustration and battle map.">
            <Textarea minRows={2} {...art} />
          </Field>
          <Field label="Standing instructions for the AI" hint="House rules, homebrew policy, things to avoid, player preferences…">
            <Textarea minRows={3} {...instr} />
          </Field>
        </Card>
        </div>
      </div>
      <ConfirmModal
        open={del}
        onClose={() => setDel(false)}
        title={`Delete “${campaign.name}”?`}
        text="Everything in this campaign is deleted from this device."
        danger
        confirmLabel="Delete forever"
        onConfirm={async () => {
          await deleteCampaign(campaign.id)
          nav('/')
        }}
      />
    </div>
  )
}
