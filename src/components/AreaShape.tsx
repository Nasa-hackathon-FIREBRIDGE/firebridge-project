import { useId } from 'react'
import { MapPinned } from 'lucide-react'

type Geometry = { type: string; coordinates: unknown } | null | undefined
type Ring = [number, number][]

function ringsOf(geometry: Geometry): Ring[] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates as Ring[]
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Ring[][]).flat()
  return []
}

/** Normalised outline of a saved study area. Not a basemap. */
export function AreaShape({ geometry, size = 80, label = 'Loaded area geometry preview, not a basemap', className = '', decorative = false }: {
  geometry: Geometry
  size?: number
  label?: string
  className?: string
  decorative?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const rings = ringsOf(geometry)
  const points = rings.flat()
  if (!points.length || points.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1])))
    return <MapPinned size={Math.round(size * 0.3)} aria-hidden="true" className={className} />
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxY = Math.max(...ys)
  const width = Math.max(...xs) - minX
  const height = maxY - Math.min(...ys)
  const scale = 56 / Math.max(width, height || 1)
  const xOffset = 12 + (56 - width * scale) / 2
  const yOffset = 12 + (56 - height * scale) / 2
  const path = rings
    .map((ring) => ring.map((point, index) => `${index ? 'L' : 'M'}${(xOffset + (point[0] - minX) * scale).toFixed(2)},${(yOffset + (maxY - point[1]) * scale).toFixed(2)}`).join(' ') + 'Z')
    .join(' ')
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} role={decorative ? undefined : 'img'} className={className}>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9f6e" stopOpacity="0.35" />
          <stop offset="1" stopColor="#e84a10" stopOpacity="0.12" />
        </linearGradient>
        <pattern id={`${id}-grid`} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M8 0H0V8" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="80" height="80" fill={`url(#${id}-grid)`} />
      <path d={path} fillRule="evenodd" fill={`url(#${id}-fill)`} stroke="#ff9f6e" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}
