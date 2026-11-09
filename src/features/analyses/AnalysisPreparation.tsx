import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarRange, Check, MapPin, Timer } from 'lucide-react'
import type { AreaView } from '@firebridge/contracts'
import { SENSORS } from '../../lib/sensors'
import { formatElapsed, type PreparationStage } from './workspace.presentation'
import { overpassTarget, startOverpassScene, type OverpassSatellite, type OverpassScene } from './overpass/overpassScene'
import './analysis-preparation.css'

const stageCopy: Record<PreparationStage, { label: string; detail: string }> = {
  submitting: { label: 'Sending your request', detail: 'Sending the saved study area and date selection for processing.' },
  queued: { label: 'Your request is queued', detail: 'The analysis will begin when a processing slot is available.' },
  resolving_data: { label: 'Finding published observations', detail: 'Checking the data available for your area and UTC interval.' },
  preparing_history: { label: 'Matching your area & dates', detail: 'Preparing archived satellite observations for your selection.' },
  retrying: { label: 'Retrying preparation', detail: 'The server is retrying this request. Its processing status will update here.' },
  completed: { label: 'Finalising your results', detail: 'Waiting for the completed analysis details to become available.' },
  processing: { label: 'Your analysis is processing', detail: 'Preparing the available observations for your area and date range.' },
}

/** Lifecycle phases reported by the server; the illustration never implies a percentage. */
const phases = ['Request', 'Queue', 'Process', 'Finalise'] as const
const phaseOf: Record<PreparationStage, number> = {
  submitting: 0, queued: 1, resolving_data: 2, preparing_history: 2, retrying: 2, processing: 2, completed: 3,
}

// Real swath widths; orbit timings are compressed for the illustration.
const satellites: (OverpassSatellite & { sensor: typeof SENSORS.aqua })[] = [
  { sensor: SENSORS.aqua, instrument: 'MODIS', color: SENSORS.aqua.color, swathKm: 2330, pixel: 3.4, period: 10.5, phase: 2.6, tilt: -0.17, altitude: 1.17, sweep: { amplitude: 0.4, period: 37, phase: 0.4 } },
  { sensor: SENSORS.noaa20, instrument: 'VIIRS', color: SENSORS.noaa20.color, swathKm: 3060, pixel: 2, period: 8.2, phase: -1.1, tilt: -0.21, altitude: 1.23, sweep: { amplitude: 0.36, period: 29, phase: 2.1 } },
]

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function AnalysisPreparation({ stage, areaName, geometry, interval, startedAt }: {
  stage: PreparationStage
  areaName?: string
  geometry?: AreaView['geometry']
  /** Human-readable UTC interval of the request. */
  interval?: string
  /** Server creation time, used when the page opens on an analysis that is already running. */
  startedAt?: string
}) {
  const copy = stageCopy[stage]
  const current = phaseOf[stage]
  const section = useRef<HTMLElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef<HTMLSpanElement>(null)
  const scene = useRef<OverpassScene | null>(null)
  const [reducedMotion] = useState(prefersReducedMotion)
  const [origin] = useState(() => {
    const created = startedAt ? Date.parse(startedAt) : Number.NaN
    return stage === 'submitting' || !Number.isFinite(created) ? Date.now() : Math.min(Date.now(), created)
  })
  const target = useMemo(() => overpassTarget(geometry, areaName), [geometry, areaName])
  const tone = stage === 'retrying' ? 'warn' : 'normal'

  // The request is usually sent from the setup column further down the page: bring the scene into view once.
  useEffect(() => {
    const element = section.current
    if (!element || typeof element.scrollIntoView !== 'function') return
    const { top, bottom } = element.getBoundingClientRect()
    if (top >= 56 && bottom <= window.innerHeight) return
    element.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    const element = elapsed.current
    if (!element) return
    const tick = () => { element.textContent = formatElapsed(Date.now() - origin) }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [origin])

  useEffect(() => {
    if (!canvas.current) return
    scene.current = startOverpassScene(canvas.current, { satellites, target, reducedMotion })
    return () => {
      scene.current?.destroy()
      scene.current = null
    }
  }, [target, reducedMotion])
  useEffect(() => { scene.current?.setTone(tone) }, [tone, target, reducedMotion])

  return (
    <section ref={section} className="fb-overpass" aria-label="Analysis preparation" data-stage={stage}>
      <div className="fb-overpass__scene" aria-hidden="true">
        <canvas ref={canvas} className="fb-overpass__canvas" />
        <span className="fb-overpass__caption">Illustrative overpass · not live positions</span>
      </div>
      <div className="fb-overpass__content">
        <div className="fb-overpass__topline">
          <p className="fb-overpass__eyebrow"><span className="fb-overpass__beacon" aria-hidden="true" />Analysis in progress</p>
          <ul className="fb-overpass__sensors" aria-label="Illustrated sensors">
            {satellites.map(({ instrument, color, sensor }) => (
              <li key={instrument} style={{ '--sensor': color } as React.CSSProperties}>
                <i aria-hidden="true" />
                {instrument} · {sensor.label}
                <span>{sensor.pixel}</span>
              </li>
            ))}
          </ul>
        </div>
        <h2 className="fb-overpass__title">Preparing your <span>fire history</span></h2>
        {(areaName || interval) && (
          <p className="fb-overpass__meta">
            {areaName && <span><MapPin size={13} aria-hidden="true" />{areaName}</span>}
            {interval && <span><CalendarRange size={13} aria-hidden="true" />{interval}<small>UTC</small></span>}
          </p>
        )}
        <div className="fb-overpass__status" role="status" aria-live="polite" aria-atomic="true">
          <p className="fb-overpass__stage"><span className="fb-overpass__radar" aria-hidden="true" />{copy.label}</p>
          <p className="fb-overpass__detail">{copy.detail}</p>
        </div>
        <ol className="fb-overpass__phases" aria-label="Request lifecycle">
          {phases.map((phase, index) => (
            <li key={phase} data-state={index < current ? 'done' : index === current ? 'current' : 'next'} aria-current={index === current ? 'step' : undefined}>
              <span className="fb-overpass__bar" aria-hidden="true"><span /></span>
              <span className="fb-overpass__phase">
                {index < current && <Check size={11} aria-hidden="true" />}
                {phase}
              </span>
            </li>
          ))}
        </ol>
        <div className="fb-overpass__footer">
          <span className="fb-overpass__elapsed"><Timer size={12} aria-hidden="true" />Elapsed <span ref={elapsed}>0:00</span></span>
          <span>Results load automatically — keep exploring meanwhile.</span>
        </div>
      </div>
    </section>
  )
}
