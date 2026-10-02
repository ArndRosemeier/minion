import { useEffect, useMemo, useState } from 'react'
import { listModels, type ORModel } from '@/ai/openrouter'
import { useSettings } from '@/state/settings'
import type { Prices } from './gaps'

/** USD-per-token prices of the configured chat, fast and image models (null while loading). */
export function usePrices(): Prices | null {
  const { chatModel, fastModel, imageModel } = useSettings((s) => s.settings)
  const [models, setModels] = useState<ORModel[] | null>(null)
  useEffect(() => {
    listModels()
      .then(setModels)
      .catch(() => setModels([]))
  }, [])
  return useMemo(() => {
    if (!models) return null
    const p = (id: string) => models.find((m) => m.id === id)?.pricing as (ORModel['pricing'] & { image_output?: string }) | undefined
    const num = (v?: string) => Math.max(0, Number(v) || 0)
    const chat = p(chatModel)
    const fast = p(fastModel)
    const img = p(imageModel)
    return {
      chat: { in: num(chat?.prompt), out: num(chat?.completion) },
      fast: { in: num(fast?.prompt), out: num(fast?.completion) },
      image: { in: num(img?.prompt), out: num(img?.completion), imageOut: num(img?.image_output) },
    }
  }, [models, chatModel, fastModel, imageModel])
}

/** rough cost of one generated image incl. the prompt-writing call */
export const imageCost = (p: Prices) => 1400 * (p.image.imageOut || p.image.out) + 100 * p.image.out + 700 * p.image.in + 1500 * p.fast.in + 200 * p.fast.out
