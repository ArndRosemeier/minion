import { assetUrl } from '@/components/AssetImage'

/** Crop a region (image pixels) of an image asset to a JPEG data URL (max 1024 px), e.g. as reference for sub-maps. */
export async function cropToDataUrl(assetId: string, r: { x: number; y: number; w: number; h: number }): Promise<string | undefined> {
  const url = await assetUrl(assetId)
  if (!url) return undefined
  const img = new Image()
  img.src = url
  await img.decode()
  const x = Math.max(0, r.x)
  const y = Math.max(0, r.y)
  const w = Math.min(img.naturalWidth - x, r.w)
  const h = Math.min(img.naturalHeight - y, r.h)
  const scale = Math.min(1, 1024 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
}
