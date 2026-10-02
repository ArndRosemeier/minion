import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useUI } from '@/state/ui'
import { cx } from './ui'

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'anim-pop pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl shadow-black/50 backdrop-blur',
            t.kind === 'error' && 'border-danger/40 bg-[#2a1613]/95 text-[#ffd2c9]',
            t.kind === 'success' && 'border-success/40 bg-[#14231a]/95 text-[#d4f5d6]',
            t.kind === 'info' && 'border-line-strong bg-surface-2/95 text-ink',
          )}
        >
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
