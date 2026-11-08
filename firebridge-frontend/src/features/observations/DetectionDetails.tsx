import { useEffect, useRef } from 'react'
import { Database, X } from 'lucide-react'
import type { DetectionFeature } from './types'
import { CopyableId } from '../../components/ui/CopyableId'

export function DetectionDetails({ feature, onClose }: { feature: DetectionFeature; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    close.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const p = feature.properties
  return <section className="geo-detection-details" aria-label="Selected detection details" tabIndex={-1}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <header><div><span className="fb-eyebrow"><Database size={12} />NATIVE OBSERVATION</span><h3>Detection #{p.detection_id}</h3></div>
      <button ref={close} type="button" className="icon-button" aria-label="Close detection details" onClick={onClose}><X size={18} /></button></header>
    <p className="geo-metadata-note">A satellite detection record. This does not identify a unique fire incident.</p>
    <CopyableId value={String(p.detection_id)} label="detection ID" />
    <dl>
      <div><dt>Platform</dt><dd>{p.platform}</dd></div>
      <div><dt>Acquired · UTC</dt><dd><time dateTime={p.acquired_at}>{p.acquired_at}</time></dd></div>
      <div><dt>Longitude / latitude</dt><dd>{feature.geometry.coordinates.map((n) => n.toFixed(5)).join(' / ')}°</dd></div>
      <div><dt>Radiative power</dt><dd>{p.frp_mw === null ? 'Not measured' : `${p.frp_mw} MW`}</dd></div>
      <div><dt>Confidence · raw</dt><dd>{p.confidence_raw == null ? 'Not supplied' : p.confidence_raw}</dd></div>
      <div><dt>Confidence scheme</dt><dd>{p.confidence_scheme ?? 'Not supplied'}</dd></div>
      <div><dt>Day / night</dt><dd>{p.day_night ?? 'Unknown'}</dd></div>
      <div><dt>Processing level</dt><dd>{p.processing_level}</dd></div>
      <div><dt>Source identifier</dt><dd><CopyableId value={p.source_id} label="source ID" /><code>{p.source_id}</code></dd></div>
    </dl>
    <p className="geo-metadata-note">Raw confidence values retain their source scheme. Inspect the pinned release and provenance for validation and test-data status.</p>
  </section>
}
