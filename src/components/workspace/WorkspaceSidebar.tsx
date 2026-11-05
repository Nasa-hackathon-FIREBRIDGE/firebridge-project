import {
  Activity,
  ArrowUpRight,
  Database,
  FileDown,
  Flame,
  Layers2,
  MapPinned,
  PanelLeftClose,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export function WorkspaceSidebar({ close }: { close: () => void }) {
  return (
    <>
      <div className="fb-sidebar-brand">
        <span className="fb-brand-symbol">
          <Flame size={20} />
        </span>
        <div>
          <strong>FIREBRIDGE</strong>
          <span>EARTH OBSERVATION</span>
        </div>
        <button
          className="fb-sidebar-close"
          type="button"
          onClick={close}
          aria-label="Close navigation"
        >
          <PanelLeftClose size={19} />
        </button>
      </div>
      <div className="fb-workspace-label">
        <span className="fb-label-line" />
        Research workspace<span className="fb-public-chip">PUBLIC</span>
      </div>
      <nav className="fb-navigation" aria-label="Primary navigation">
        <p className="fb-nav-label">WORKSPACE</p>
        <Link to="/analyses" className="fb-nav-item fb-nav-active" onClick={close}>
          <Layers2 size={17} />
          <span>Analysis workspace</span>
          <span className="fb-nav-marker" />
        </Link>
        <a href="#spatial-workspace" className="fb-nav-item" onClick={close}>
          <MapPinned size={17} />
          <span>Spatial exploration</span>
        </a>
        <a href="#observation-records" className="fb-nav-item" onClick={close}>
          <Activity size={17} />
          <span>Observation records</span>
        </a>
        <a href="#data-provenance" className="fb-nav-item" onClick={close}>
          <Database size={17} />
          <span>Data & provenance</span>
        </a>
        <a href="#export-results" className="fb-nav-item" onClick={close}>
          <FileDown size={17} />
          <span>Exports</span>
        </a>
        <p className="fb-nav-label fb-nav-secondary-label">REFERENCE</p>
        <Link to="/evidence" className="fb-nav-item" onClick={close}>
          <span>Methods & limitations</span>
          <ArrowUpRight size={14} />
        </Link>
        <Link to="/" className="fb-nav-item" onClick={close}>
          <span>Demonstration views</span>
          <span className="fb-demo-chip">DEMO</span>
        </Link>
      </nav>
      <div className="fb-sidebar-foot">
        <div className="fb-coordinate-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <p>
          Observe with context.
          <br />
          <strong>Keep the evidence in view.</strong>
        </p>
        <div>
          <span>WGS 84</span>
          <span>Native observations</span>
        </div>
      </div>
    </>
  )
}
