import { useId } from 'react'

/**
 * Pixels to scale: one square kilometre of ground as MODIS sees it (one pixel) and as VIIRS sees
 * it (375 m pixels), with a 1,000 m² flaming fire drawn at true size: the fire size MODIS detects
 * routinely. The fire fills 0.1% of a MODIS pixel and 0.7% of a VIIRS pixel.
 */

const FIRE_M2 = 1000
const KM = 1000

function Panel({ title, pixel, note, px }: { title: string; pixel: number; note: string; px: number }) {
  const uid = useId().replace(/:/g, '')
  const scale = px / KM
  const fire = { x: 0.62 * KM, y: 0.38 * KM, r: Math.sqrt(FIRE_M2 / Math.PI) }
  const lines = Array.from({ length: Math.floor(KM / pixel) }, (_, i) => (i + 1) * pixel).filter((v) => v < KM)
  const cell = { x: Math.floor(fire.x / pixel) * pixel, y: Math.floor(fire.y / pixel) * pixel }
  const share = (FIRE_M2 / (pixel * pixel)) * 100
  return (
    <figure className="m-0 flex min-w-0 flex-col items-center gap-3">
      <svg width={px + 2} height={px + 2} role="img" aria-label={`${title}: a 1,000 square metre fire fills ${share.toFixed(1)}% of one pixel`}>
        <defs>
          <radialGradient id={`${uid}-fire`}>
            <stop offset="0" stopColor="#fff1e6" />
            <stop offset="0.4" stopColor="#ffb547" />
            <stop offset="1" stopColor="#ff5f1f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x={1} y={1} width={px} height={px} fill="#0b0d12" stroke="rgba(255,255,255,0.25)" />
        <rect x={1 + cell.x * scale} y={1 + cell.y * scale} width={Math.min(pixel, KM - cell.x) * scale} height={Math.min(pixel, KM - cell.y) * scale} fill="#ff7c40" opacity={pixel === KM ? 0.05 : 0.16} />
        {lines.map((v) => (
          <g key={v}>
            <line x1={1 + v * scale} x2={1 + v * scale} y1={1} y2={px + 1} stroke="rgba(255,255,255,0.18)" />
            <line y1={1 + v * scale} y2={1 + v * scale} x1={1} x2={px + 1} stroke="rgba(255,255,255,0.18)" />
          </g>
        ))}
        <circle cx={1 + fire.x * scale} cy={1 + fire.y * scale} r={Math.max(9, fire.r * scale * 4)} fill={`url(#${uid}-fire)`} opacity={0.55} />
        <circle cx={1 + fire.x * scale} cy={1 + fire.y * scale} r={Math.max(1.6, fire.r * scale)} fill="#fff1e6" />
      </svg>
      <figcaption className="text-center">
        <span className="block text-[13.5px] font-medium text-fg">{title}</span>
        <span className="mt-0.5 block font-serif text-[22px] font-[440] tracking-[-0.02em] text-paper">{share.toFixed(1)}%</span>
        <span className="block text-[12px] text-fg-3">{note}</span>
      </figcaption>
    </figure>
  )
}

export function PixelScale() {
  return (
    <div className="grid gap-8 sm:grid-cols-2">
      <Panel title="MODIS · one 1 km pixel" pixel={1000} px={240} note="of the pixel is fire" />
      <Panel title="VIIRS · 375 m pixels" pixel={375} px={240} note="of the lit pixel is fire" />
    </div>
  )
}
