import { useId } from 'react'

/** FIREBRIDGE mark: an ember flame held inside a satellite orbit. */
export function LogoMark({ size = 36, animated = false, className = '' }: { size?: number; animated?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${id}-flame`} x1="16" y1="40" x2="32" y2="8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e84a10" />
          <stop offset="0.55" stopColor="#ff7c40" />
          <stop offset="1" stopColor="#ffb547" />
        </linearGradient>
        <linearGradient id={`${id}-ring`} x1="4" y1="24" x2="44" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff7c40" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ff9f6e" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ff7c40" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="24" cy="28" r="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff5f1f" stopOpacity="0.45" />
          <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#12151c" stroke="rgba(255,255,255,0.08)" />
      <circle cx="24" cy="28" r="16" fill={`url(#${id}-glow)`} />
      <path
        className={animated ? 'origin-[24px_30px] animate-flicker' : undefined}
        d="M24.6 9.5c.9 4.4-1.4 7-3.6 9.6-2.3 2.7-4.6 5.4-4.2 9.9.4 4.6 3.9 8 7.6 8s7.4-3.1 7.4-7.9c0-3.5-1.7-5.6-3-7.6.2 2.6-.8 4.4-2.4 4.9.9-5.3-.2-12.4-1.8-16.9Z"
        fill={`url(#${id}-flame)`}
      />
      <g className={animated ? 'origin-center animate-orbit' : undefined}>
        <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(-24 24 24)" stroke={`url(#${id}-ring)`} strokeWidth="1.6" />
        <circle cx="40.6" cy="16.4" r="2.3" fill="#fff5ee" />
      </g>
    </svg>
  )
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex min-w-0 flex-col leading-none ${className}`}>
      <strong className="font-display text-[15px] font-semibold tracking-[0.14em] text-fg">FIREBRIDGE</strong>
      <span className="mt-1.5 truncate text-[11.5px] font-medium text-fg-3">Fire history across satellites</span>
    </span>
  )
}
