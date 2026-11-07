import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigationType } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  Compass,
  Database,
  Flame,
  Layers2,
  LayoutDashboard,
  Map,
  Menu,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  CloudSun,
} from 'lucide-react'
import { ChatWidget } from './ChatWidget'
import { RouteErrorBoundary } from './RouteErrorBoundary'

const research = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/analyses', label: 'Analysis workspace', icon: Activity },
  { to: '/api-analysis', label: 'Results explorer', icon: Layers2 },
  { to: '/catalog', label: 'Data catalogue', icon: Database },
]
const demonstrations = [
  { to: '/', label: 'Overview', icon: Compass },
  { to: '/explore', label: 'Explore map', icon: Map },
  { to: '/compare', label: 'Compare sensors', icon: Layers2 },
  { to: '/calendar', label: 'Activity calendar', icon: CalendarDays },
  { to: '/weather', label: 'Weather context', icon: CloudSun },
  { to: '/reports', label: 'Reports & events', icon: BookOpen },
  { to: '/explain', label: 'Analysis notes', icon: Sparkles },
  { to: '/alerts', label: 'Watchlist', icon: AlertTriangle },
]
const tools = [
  { to: '/evidence', label: 'Data & methods', icon: BookOpen },
  { to: '/ingestion', label: 'Ingestion administration', icon: ShieldCheck },
  { to: '/settings', label: 'Preferences', icon: Settings2 },
]

export function ApplicationShell({
  children,
  demoControls,
}: {
  children: ReactNode
  demoControls: ReactNode
}) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const previousPath = useRef(location.pathname)
  const demo = demonstrations.some((item) => item.to === location.pathname)
  const researchPage =
    research.some((item) => item.to === location.pathname) || location.pathname === '/ingestion'
  const current = [...research, ...demonstrations, ...tools].find(
    (item) => item.to === location.pathname,
  )
  const [open, setOpen] = useState(false)
  const [compact, setCompact] = useState(
    () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches,
  )
  const sidebar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => menu.current?.focus())
  }
  useEffect(() => {
    const pageChanged = previousPath.current !== location.pathname
    previousPath.current = location.pathname
    if (!pageChanged) return
    setOpen(false)
    if (compact && sidebar.current?.contains(document.activeElement)) {
      requestAnimationFrame(() => menu.current?.focus())
    }
    // Keep browser Back/Forward restoration and in-page result navigation intact.
    if (navigationType !== 'POP' && !location.hash) window.scrollTo(0, 0)
  }, [location.pathname, location.hash, navigationType, compact])
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 820px)')
    const changed = () => {
      setCompact(media.matches)
      if (!media.matches) setOpen(false)
    }
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    document.title = `${current?.label ?? 'Workspace'} · FIREBRIDGE`
  }, [current?.label])
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Apply the drawer's visible state before moving focus into it.
    const focusFrame = requestAnimationFrame(() => closeButton.current?.focus())
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        requestAnimationFrame(() => menu.current?.focus())
      }
      if (event.key !== 'Tab') return
      const targets = [
        ...(sidebar.current?.querySelectorAll<HTMLElement>('a, button, summary') ?? []),
      ].filter((el) => el.getClientRects().length)
      const first = targets[0]
      const last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.body.style.overflow = previous
      document.removeEventListener('keydown', keydown)
    }
  }, [open])
  const links = (items: typeof research) =>
    items.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        className={({ isActive }) => `nav-link fb-nav-item ${isActive ? 'nav-link-active fb-nav-active' : ''}`}
        onClick={() => {
          setOpen(false)
          if (compact) requestAnimationFrame(() => menu.current?.focus())
        }}
      >
        <Icon size={17} strokeWidth={1.7} />
        <span>{label}</span>
      </NavLink>
    ))
  return (
    <div className="app-shell fb-shell astra-shell">
      <a href="#main-content" className="astra-skip-link">
        Skip to content
      </a>
      {open && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation backdrop"
          onClick={close}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
        aria-label="Application navigation"
        role={compact && open ? 'dialog' : undefined}
        aria-modal={compact && open ? true : undefined}
        inert={(compact && !open) || undefined}
        aria-hidden={(compact && !open) || undefined}
      >
        <div className="astra-brand-row">
          <Link
            to="/dashboard"
            className="brand fb-sidebar-brand astra-brand-link"
            aria-label="FIREBRIDGE home"
            onClick={() => {
              if (compact) close()
              else setOpen(false)
            }}
          >
            <span className="fb-brand-symbol" aria-hidden="true">
              <Flame size={20} />
            </span>
            <div>
              <strong>FIREBRIDGE</strong>
              <span>EARTH OBSERVATION</span>
            </div>
          </Link>
          <button
            ref={closeButton}
            className="astra-sidebar-close icon-button"
            aria-label="Close navigation"
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        <div className="astra-workspace-context">
          <span className="astra-workspace-icon">
            <Flame size={17} />
          </span>
          <span>
            <strong>Earth observation</strong>
            <small>Public research workspace</small>
          </span>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <section className="nav-group">
            <p className="nav-heading">Research</p>
            {links(research)}
          </section>
          <details
            key={demo ? 'demo' : 'research'}
            className="astra-demo-navigation nav-group"
            open={demo}
          >
            <summary className="nav-heading">
              Demonstration <span>DEMO</span>
              <ChevronDown size={13} />
            </summary>
            <div>{links(demonstrations)}</div>
          </details>
          <section className="nav-group">
            <p className="nav-heading">Workspace tools</p>
            {links(tools)}
          </section>
        </nav>
        <div className="astra-sidebar-foot">
          <span className="astra-orbit" aria-hidden="true">
            <Compass size={18} />
          </span>
          <p>
            Observe with context.
            <br />
            <strong>Keep the evidence in view.</strong>
          </p>
          <small>Public access · No sign-in required</small>
        </div>
      </aside>
      <main id="main-content" tabIndex={-1} className="main-panel" inert={open || undefined}>
        <header className="topbar">
          <div className="topbar-title">
            <button
              ref={menu}
              className="mobile-menu"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="workspace-navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumbs">
              <Link to="/dashboard">FIREBRIDGE</Link>
              <span className="breadcrumb-slash">/</span>
              <strong>{current?.label ?? 'Workspace'}</strong>
            </div>
          </div>
          <div className="astra-header-context">
            {demo ? (
              demoControls
            ) : (
              <>
                <span className="astra-public-label">
                  <span />
                  Public workspace
                </span>
                <span className="astra-coordinate">WGS 84 / UTC</span>
              </>
            )}
          </div>
        </header>
        {demo ? (
          <div className="global-demo-banner">
            <Flame size={14} />
            <span>
              <strong>Demo workspace.</strong> Maps and figures use synthetic fixtures, separate
              from saved analyses.
            </span>
            <Link to="/dashboard">
              Open research dashboard <ArrowRight size={13} />
            </Link>
          </div>
        ) : researchPage ? (
          <div className="astra-data-notice">
            <Database size={13} />
            <span>
              <strong>Published data</strong> Results reflect the server’s releases. Test releases
              can contain synthetic records.
            </span>
            <Link to="/evidence">
              Data & methods <ArrowRight size={12} />
            </Link>
          </div>
        ) : null}
        <RouteErrorBoundary key={location.pathname}>
          <Suspense
            fallback={
              <div className="loading-view" role="status">
                <span className="astra-loading-dot" />
                Loading workspace…
              </div>
            }
          >
            {children}
          </Suspense>
        </RouteErrorBoundary>
      </main>
      {demo && !open && <ChatWidget />}
    </div>
  )
}
