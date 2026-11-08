import { useEffect, useRef } from 'react'
import { Info } from 'lucide-react'
import { NO_RECORDS_EXPLANATION, NO_RECORDS_LABEL, PLATFORMS, SENSOR_FAMILIES, familyState, hasDemoRecords, operationalNote, selectedWithoutRecords, toggleFamily, togglePlatformIn } from '../platforms'
import type { SatellitePlatform } from '../types'

function FamilyCheckbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />
}

export function SensorSelector({ platforms, setPlatforms }: { platforms: SatellitePlatform[]; setPlatforms: (next: SatellitePlatform[]) => void }) {
  const empty = selectedWithoutRecords(platforms)
  const allEmpty = platforms.length > 0 && empty.length === platforms.length
  return (
    <div className="sensor-selector" role="group" aria-label="Satellite sensors">
      {SENSOR_FAMILIES.map((family) => {
        const state = familyState(platforms, family.id)
        return (
          <div className="selector-family" key={family.id}>
            <label className="selector-parent">
              <FamilyCheckbox checked={state === 'all'} indeterminate={state === 'some'} onChange={() => setPlatforms(toggleFamily(platforms, family.id))} label={`${family.label} (all satellites)`} />
              <span><strong>{family.label}</strong><small>{family.description}</small></span>
            </label>
            <div className="selector-children">
              {PLATFORMS.filter((platform) => platform.sensor === family.id).map((platform) => {
                const note = operationalNote(platform.id)
                return (
                  <div key={platform.id}>
                    <label className="selector-child">
                      <input type="checkbox" checked={platforms.includes(platform.id)} onChange={() => setPlatforms(togglePlatformIn(platforms, platform.id))} />
                      <span>{platform.label}</span>
                      <small className={hasDemoRecords(platform.id) ? 'selector-available' : 'selector-missing'}>{hasDemoRecords(platform.id) ? 'Demo records available' : NO_RECORDS_LABEL}</small>
                    </label>
                    {note && <p className="selector-note"><Info size={11} />{note}</p>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {!platforms.length && <p className="selector-empty" role="status">No satellites selected. No records can be shown until at least one is chosen.</p>}
      {allEmpty && <p className="selector-empty" role="status">{NO_RECORDS_LABEL} for the selected satellites. {NO_RECORDS_EXPLANATION}</p>}
      <p className="selector-footnote">Native detection counts differ by sensor and are not harmonized or comparable.</p>
    </div>
  )
}
