import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-strong font-semibold shadow-sm shadow-black/30',
  secondary: 'bg-surface-3 text-ink hover:bg-line border border-line-strong',
  ghost: 'text-ink hover:bg-surface-3',
  subtle: 'text-muted hover:text-ink hover:bg-surface-3',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-sm gap-1.5 rounded-md',
  md: 'h-10 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors select-none disabled:opacity-45 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(function IconButton(
  { variant = 'subtle', size = 'md', label, className, children, icon, loading, ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10'
  return (
    <button
      ref={ref}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors select-none disabled:opacity-40 disabled:pointer-events-none [&_svg]:size-[1.15rem]',
        variants[variant],
        dim,
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" /> : (icon ?? children)}
    </button>
  )
})

const fieldBase =
  'w-full rounded-lg bg-surface-2 border border-line px-3 text-ink placeholder:text-faint focus:outline-none focus:border-accent/70 focus:ring-2 focus:ring-accent/20 transition-colors'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', className)} {...rest} />
})

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean; minRows?: number }
>(function Textarea({ className, autoGrow = true, minRows = 3, value, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el || !autoGrow) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 900)}px`
  }, [value, autoGrow])
  return (
    <textarea
      ref={(el) => {
        inner.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
      rows={minRows}
      value={value}
      className={cx(fieldBase, 'py-2 leading-relaxed resize-y', className)}
      {...rest}
    />
  )
})

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, 'h-10 pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-sm text-ink select-none"
      role="switch"
      aria-checked={checked}
    >
      <span className={cx('relative h-6 w-10 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3 border border-line-strong')}>
        <span
          className={cx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
}: {
  value: T
  options: { value: T; label: ReactNode; icon?: ReactNode }[]
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div className={cx('inline-flex rounded-lg border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors [&_svg]:size-4',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
            value === o.value ? 'bg-accent text-accent-ink shadow' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin text-accent', className ?? 'size-5')} />
}

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cx('rounded-xl border border-line bg-surface', onClick && 'cursor-pointer hover:border-line-strong', className)}
    >
      {children}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-faint [&_svg]:size-10">{icon}</div>}
      <div className="font-display text-lg text-ink">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean | 'xl'
  className?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={cx(
          'anim-pop flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-line-strong bg-surface shadow-2xl shadow-black/60 sm:rounded-2xl',
          wide === 'xl' ? 'sm:max-w-5xl 2xl:max-w-7xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
          className,
        )}
      >
        {title && (
          <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0 flex-1 font-display text-lg">{title}</div>
            <IconButton label="Close" icon={<X />} onClick={onClose} size="sm" />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Small round badge with a count. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-3 px-1.5 text-[11px] font-semibold text-muted', className)}>
      {children}
    </span>
  )
}

export function Tag({ children, onRemove, className }: { children: ReactNode; onRemove?: () => void; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-0.5 text-xs text-muted', className)}>
      {children}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-ink" aria-label="Remove">
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

/** Confirm helper that never uses window.confirm (blocked in some PWAs). */
export function ConfirmModal({
  open,
  title,
  text,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  text?: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {text && <div className="text-sm text-muted">{text}</div>}
    </Modal>
  )
}

/** Dropdown menu rendered in a portal (never clipped by scroll containers), closes on outside tap. */
export function PopoverMenu({
  trigger,
  children,
  width = 240,
}: {
  trigger: (open: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  width?: number
}) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = () => {
    const r = anchor.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width)) })
  }
  const close = () => setPos(null)
  return (
    <>
      <span ref={anchor} className="inline-flex">
        {trigger(open)}
      </span>
      {pos &&
        createPortal(
          <div className="fixed inset-0 z-[80]" onPointerDown={(e) => e.target === e.currentTarget && close()}>
            <div
              className="anim-pop absolute max-h-[70vh] overflow-y-auto rounded-xl border border-line-strong bg-surface-2 py-1 shadow-xl shadow-black/60"
              style={{ top: pos.top, left: pos.left, width }}
            >
              {children(close)}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export function MenuItem({ children, icon, onClick, danger }: { children: ReactNode; icon?: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm hover:bg-surface-3', danger && 'text-danger')}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

/**
 * Input bound to persisted (async) data: keeps a local draft while editing so keystrokes are never
 * lost, commits debounced and on blur, and follows external changes while not focused.
 */
export function LiveInput({
  value,
  onCommit,
  delay = 400,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string | number | undefined; onCommit: (v: string) => void; delay?: number }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const focused = useRef(false)
  const timer = useRef<number>(0)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  useEffect(() => {
    if (!focused.current) setDraft(String(value ?? ''))
  }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])
  const flush = (v: string) => {
    clearTimeout(timer.current)
    if (v !== String(value ?? '')) commitRef.current(v)
  }
  return (
    <input
      className={cx(fieldBase, 'h-10', className)}
      {...rest}
      value={draft}
      onFocus={(e) => {
        focused.current = true
        rest.onFocus?.(e)
      }}
      onChange={(e) => {
        const v = e.target.value
        setDraft(v)
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => commitRef.current(v), delay)
      }}
      onBlur={(e) => {
        focused.current = false
        flush(e.target.value)
        rest.onBlur?.(e)
      }}
    />
  )
}
