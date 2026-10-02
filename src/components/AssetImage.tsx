import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { ImageOff } from 'lucide-react'
import { db } from '@/db/db'
import { cx } from './ui'

const urlCache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

export async function assetUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id)
  if (hit) return hit
  let p = pending.get(id)
  if (!p) {
    p = db.assets.get(id).then((a) => {
      if (!a) return null
      const url = URL.createObjectURL(a.blob)
      urlCache.set(id, url)
      return url
    })
    pending.set(id, p)
  }
  return p
}

export function useAssetUrl(id?: string | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(id ? (urlCache.get(id) ?? undefined) : null)
  useEffect(() => {
    let alive = true
    if (!id) {
      setUrl(null)
      return
    }
    const hit = urlCache.get(id)
    if (hit) {
      setUrl(hit)
      return
    }
    setUrl(undefined)
    assetUrl(id).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [id])
  return url
}

export function AssetImage({
  id,
  className,
  fallback,
  ...rest
}: { id?: string | null; fallback?: React.ReactNode } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const url = useAssetUrl(id)
  if (url === undefined) return <div className={cx('animate-pulse bg-surface-3', className)} />
  if (!url)
    return (
      <>
        {fallback ?? (
          <div className={cx('flex items-center justify-center bg-surface-2 text-faint', className)}>
            <ImageOff className="size-6" />
          </div>
        )}
      </>
    )
  return <img src={url} className={className} draggable={false} {...rest} />
}
