import { useState } from 'react'
import { CalendarDays, Layers2, Search, X } from 'lucide-react'
import { SensorSelector } from '../../components/SensorSelector'
import { useAppState } from '../../useAppState'

export default function DemoControls() {
  const { startDate, endDate, setStartDate, setEndDate, searchText, setSearchText, platforms, setPlatforms } = useAppState()
  const [searchOpen, setSearchOpen] = useState(false)
  const [satellitesOpen, setSatellitesOpen] = useState(false)
  return (
    <div className="topbar-controls">
      <div className="satellite-filter-wrap" onKeyDown={(event) => { if (event.key === 'Escape') setSatellitesOpen(false) }}>
        <button type="button" className={`button button-secondary satellite-filter-button ${satellitesOpen ? 'active' : ''}`} aria-expanded={satellitesOpen} aria-haspopup="true" onClick={() => setSatellitesOpen((value) => !value)}><Layers2 size={14} /><span className="satellite-label">Satellites</span> <span className="satellite-count">{platforms.length}/5</span></button>
        {satellitesOpen && <div className="satellite-popover" role="region" aria-label="Satellite filter"><SensorSelector platforms={platforms} setPlatforms={setPlatforms} /></div>}
      </div>
      <label className="date-filter"><CalendarDays size={14} /><span className="sr-only">Start date</span><input aria-label="Start date" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /><span className="date-separator">—</span><span className="sr-only">End date</span><input aria-label="End date" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
      <div className="global-search-wrap">
        <button className={`icon-button top-search-toggle ${searchOpen ? 'active' : ''}`} aria-label={searchOpen ? 'Close search' : 'Search detections'} onClick={() => setSearchOpen((value) => !value)}>{searchOpen ? <X size={17} /> : <Search size={17} />}</button>
        {searchOpen && <label className="global-search"><Search size={15} /><input autoFocus value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search demo records…" aria-label="Search synthetic detections" /><button className="icon-button" aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button></label>}
      </div>
      <span className="topbar-status"><span className="status-dot" /> Local demo</span>
    </div>
  )
}
