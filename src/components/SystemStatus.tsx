import { useQuery } from '@tanstack/react-query'
import { health } from '../services/health.service'

const labels: Record<string, string> = { database: 'Database', redis: 'Queue', catalogue: 'Catalogue', workers: 'Workers' }

/** Compact, non-interactive service status for the navigation footer. */
export function SystemStatus() {
  const ready = useQuery({
    queryKey: ['firebridge', 'health', 'ready', 'sidebar'],
    queryFn: ({ signal }) => health.getHealthReady(signal),
    refetchInterval: 60_000,
    retry: 1,
  })
  const status = ready.isPending ? 'checking' : ready.isError ? 'offline' : ready.data.status === 'ok' ? 'ok' : 'degraded'
  const tone = { checking: 'bg-fg-3', ok: 'bg-ok', degraded: 'bg-warn', offline: 'bg-bad' }[status]
  const title = { checking: 'Checking services…', ok: 'API ready · worker unverified', degraded: 'Some services degraded', offline: 'API unreachable' }[status]
  const checks = ready.data ? Object.entries(ready.data.checks) : []
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className="relative flex size-2">
          {status === 'ok' && <span className={`absolute inset-0 rounded-full ${tone} animate-pulse-ring`} />}
          <span className={`relative size-2 rounded-full ${tone}`} />
        </span>
        <span className="text-[12.5px] font-medium text-fg">{title}</span>
      </div>
      {checks.length > 0 && (
        <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1">
          {checks.map(([name, value]) => (
            <li key={name} className="flex items-center gap-1.5 text-[11px] text-fg-3">
              <span className={`size-1 rounded-full ${value === 'ready' ? 'bg-ok' : value === 'not_checked' ? 'bg-fg-3' : 'bg-warn'}`} aria-hidden="true" />
              {labels[name] ?? name}
              <span className="sr-only">: {String(value).replace('_', ' ')}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-[11px] leading-snug text-fg-3">NASA FIRMS · MODIS & VIIRS active-fire records</p>
    </div>
  )
}
