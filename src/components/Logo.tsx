export function Logo({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg viewBox="0 0 512 512" className={small ? 'size-7' : 'size-9'}>
        <path d="M256 70 L410 160 L410 352 L256 442 L102 352 L102 160 Z" fill="#1c1714" stroke="#e0a54b" strokeWidth="26" strokeLinejoin="round" />
        <path d="M256 150 L340 300 L172 300 Z" fill="#e0a54b" />
      </svg>
      {!small && <span className="font-display text-2xl font-bold tracking-wide text-accent">Minion</span>}
    </div>
  )
}
