import { useState } from 'react'
import { SENSORS } from '../../lib/sensors'
import { ARCHIVE, ARCHIVE_TOTAL_ROWS, millions, monthYear } from './facts'

const max = Math.max(...ARCHIVE.map((platform) => platform.rows))

/** Records per satellite in the audited archive: one labelled bar per platform (identity is
 *  never colour alone), linear scale from zero, exact values on every row. */
export function ArchiveBars() {
  const [active, setActive] = useState<string | null>(null)
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Archived records per satellite">
      {ARCHIVE.map((platform) => {
        const share = (platform.rows / ARCHIVE_TOTAL_ROWS) * 100
        const color = SENSORS[platform.key].color
        const dim = active !== null && active !== platform.key
        return (
          <li
            key={platform.key}
            className={`grid grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-x-4 gap-y-1 rounded-xl px-3 py-2.5 transition-[opacity,background-color] duration-200 sm:grid-cols-[11rem_1fr_7.5rem] ${dim ? 'opacity-40' : ''} ${active === platform.key ? 'bg-white/[0.03]' : ''}`}
            onPointerEnter={() => setActive(platform.key)}
            onPointerLeave={() => setActive(null)}
          >
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 font-sans text-[14px] font-semibold text-fg">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
                {platform.name}
                <span className="font-mono text-[10.5px] font-medium text-fg-3">{platform.instrument}</span>
              </p>
              <p className="m-0 mt-0.5 pl-[18px] font-sans text-[12px] text-fg-3">
                {monthYear(platform.first)} → {monthYear(platform.last)}
              </p>
            </div>
            <div className="relative h-3 min-w-0 rounded-full bg-white/[0.04]" aria-hidden="true">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${Math.max((platform.rows / max) * 100, 0.8)}%`,
                  background: platform.used ? color : 'transparent',
                  border: platform.used ? undefined : `1.5px dashed ${color}`,
                  boxShadow: platform.used ? `0 0 18px -4px ${color}` : undefined,
                }}
              />
            </div>
            <p className="col-start-2 m-0 font-mono text-[12.5px] tabular-nums text-fg sm:col-start-auto sm:text-right">
              {millions(platform.rows)}
              <span className="ml-1.5 text-fg-3">{active === platform.key ? `${share.toFixed(1)}%` : platform.used ? '' : 'not used'}</span>
            </p>
          </li>
        )
      })}
    </ul>
  )
}
