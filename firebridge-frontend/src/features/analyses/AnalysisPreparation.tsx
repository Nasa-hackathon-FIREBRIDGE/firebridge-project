import { useId } from 'react'
import type { PreparationStage } from './workspace.presentation'
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

export function AnalysisPreparation({ stage }: { stage: PreparationStage }) {
  const id = useId().replace(/:/g, '')
  const globe = `orbital-globe-${id}`
  const glow = `orbital-light-${id}`
  const copy = stageCopy[stage]
  return (
    <section className="fb-orbital" aria-label="Analysis preparation">
      <div className="fb-orbital__scene" aria-hidden="true">
        <svg viewBox="0 0 360 220" fill="none" focusable="false">
          <defs>
            <clipPath id={globe}><circle cx="180" cy="108" r="73" /></clipPath>
            <radialGradient id={glow} cx=".34" cy=".27" r=".84">
              <stop stopColor="#173641" /><stop offset=".65" stopColor="#10232c" /><stop offset="1" stopColor="#0b141c" />
            </radialGradient>
          </defs>
          <path className="fb-orbital__crosshair" d="M180 13v10m0 170v10M75 108H65m220 0h10" />
          <circle cx="180" cy="108" r="84" stroke="#42717b" strokeOpacity=".13" strokeDasharray="2 7" />
          <circle cx="180" cy="108" r="73" fill={`url(#${glow})`} stroke="#61909a" strokeOpacity=".4" />
          <g clipPath={`url(#${globe})`}>
            <g className="fb-orbital__coordinates">
              <ellipse cx="180" cy="108" rx="29" ry="73" /><ellipse cx="180" cy="108" rx="56" ry="73" />
              <ellipse cx="180" cy="108" rx="73" ry="27" /><ellipse cx="180" cy="108" rx="73" ry="53" />
              <path d="M107 108h146M180 35v146" />
            </g>
            <g className="fb-orbital__land">
              <path d="m133 64 18-9 17 5 7 12-12 7-2 12-15 5-12-13-8-4Zm20 36 18 1 9 14-7 17-3 21-9 8-5-24-9-18Z" />
              <path d="m185 64 18-11 19 12 14 2 10 18-17 11-14-5-5 12-13-7-2-14-14-3Zm5 38 18 6 10 18-12 19-13-9-10-19Zm37 42 13-7 14 11-5 12-19-4Z" />
            </g>
            <g className="fb-orbital__swath">
              <path d="M150 24h31l34 169h-31Z" fill="#ffb547" fillOpacity=".09" />
              <path d="m181 24 34 169" stroke="#ffba67" strokeOpacity=".55" />
            </g>
            <g className="fb-orbital__signals" fill="#ffb366">
              <circle cx="159" cy="99" r="2.5" /><circle cx="202" cy="121" r="2" /><circle cx="210" cy="78" r="2.5" />
            </g>
          </g>
          <g transform="translate(180 108) rotate(-20) scale(1 .43)">
            <circle r="142" className="fb-orbital__orbit-path" />
            <g className="fb-orbital__satellite-orbit">
              <g transform="translate(142 0) scale(1 2.3256) rotate(20)">
                <path d="M-21-7h13v14h-13zm29 0h13v14H8Z" fill="#1d4658" stroke="#79adbc" strokeWidth="1" />
                <path d="M-17-7V7m5-14V7m21-14V7m5-14V7M-21 0h13M8 0h13" stroke="#79adbc" strokeOpacity=".6" strokeWidth=".7" />
                <path d="M-8 0H8" stroke="#d0dce0" strokeWidth="2" />
                <rect x="-5" y="-8" width="10" height="16" rx="2" fill="#e8d9bc" stroke="#fff4dd" />
                <path d="m-2 9 2 5 2-5" fill="#ffb547" /><path d="M0-8v-5m-3-1 3 1 3-1" stroke="#e8d9bc" />
              </g>
            </g>
          </g>
          <path d="M44 176h33l14-14M269 54l14-14h30" stroke="#68858c" strokeOpacity=".32" />
          <circle cx="44" cy="176" r="2" fill="#94a9b0" /><circle cx="313" cy="40" r="2" fill="#ffb547" />
        </svg>
        <span className="fb-orbital__illustration-label">Earth observation illustration</span>
      </div>
      <div className="fb-orbital__content">
        <p className="fb-orbital__eyebrow">MODIS / VIIRS <span>·</span> Earth observation</p>
        <div className="fb-orbital__status" role="status" aria-live="polite" aria-atomic="true">
          <h2>Preparing your fire history</h2>
          <p className="fb-orbital__stage"><span aria-hidden="true" />{copy.label}</p>
          <p className="fb-orbital__detail">{copy.detail}</p>
        </div>
        <p className="fb-orbital__footnote">Results will appear here automatically.</p>
      </div>
    </section>
  )
}
