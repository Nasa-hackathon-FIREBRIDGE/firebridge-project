import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigationType } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CloudSun,
  Compass,
  Database,
  FlaskConical,
  Home,
  Layers2,
  LayoutDashboard,
  Library,
  Map,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ChatWidget } from './ChatWidget'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { LogoMark, Wordmark } from './brand/Logo'
import { SHOW_DEMONSTRATION, SHOW_INGESTION_ADMIN } from '../config/features'

type NavItem = { to: string; label: string; icon: LucideIcon }

const workspace: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/analyses', label: 'Analysis workspace', icon: Activity },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
]
const data: NavItem[] = [
  { to: '/catalog', label: 'Data catalogue', icon: Database },
  { to: '/evidence', label: 'Data & methods', icon: BookOpen },
  { to: '/sources', label: 'Sources & credits', icon: Library },
  { to: '/api-analysis', label: 'Results explorer', icon: Layers2 },
]
const demonstrations: NavItem[] = !SHOW_DEMONSTRATION ? [] : [
  { to: '/demo', label: 'Overview', icon: Compass },
  { to: '/explore', label: 'Explore map', icon: Map },
  { to: '/compare', label: 'Compare sensors', icon: Layers2 },
  { to: '/calendar', label: 'Activity calendar', icon: CalendarDays },
  { to: '/weather', label: 'Weather context', icon: CloudSun },
  { to: '/reports', label: 'Reports & events', icon: BookOpen },
  { to: '/explain', label: 'Analysis notes', icon: Sparkles },
  { to: '/alerts', label: 'Watchlist', icon: AlertTriangle },
]
const system: NavItem[] = [
  ...(SHOW_INGESTION_ADMIN ? [{ to: '/ingestion', label: 'Ingestion administration', icon: ShieldCheck }] : []),
  // Preferences only configure the synthetic demonstration, so they share its switch.
  ...(SHOW_DEMONSTRATION ? [{ to: '/settings', label: 'Preferences', icon: Settings2 }] : []),
]
const researchPaths = new Set(['/dashboard', '/analyses', '/api-analysis', '/catalog', '/ingestion'])

export function ApplicationShell({
  children,
  demoControls,
  sidebarFooter,
}: {
  children: ReactNode
  demoControls: ReactNode
  sidebarFooter?: ReactNode
}) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const previousPath = useRef(location.pathname)
  const demo = demonstrations.some((item) => item.to === location.pathname)
  const researchPage = researchPaths.has(location.pathname)
  const home = location.pathname === '/'
  const current = [...workspace, ...data, ...demonstrations, ...system].find((item) => item.to === location.pathname)
  const [open, setOpen] = useState(false)
  const [compact, setCompact] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 820px)').matches,
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
    document.title = home ? 'FIREBRIDGE · A consistent fire history across changing satellites' : `${current?.label ?? 'Workspace'} · FIREBRIDGE`
  }, [current?.label, home])
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

  const links = (items: NavItem[]) =>
    items.map(({ to, label, icon: Icon }) => (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        className={({ isActive }) =>
          `group relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium no-underline outline-offset-0 transition-colors duration-150 ${
            isActive ? 'bg-white/[0.06] text-fg' : 'text-fg-2 hover:bg-white/[0.035] hover:text-fg'
          }`
        }
        onClick={() => {
          setOpen(false)
          if (compact) requestAnimationFrame(() => menu.current?.focus())
        }}
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <motion.span
                layoutId="fb-nav-active"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                className="absolute inset-y-2 -left-3 w-[3px] rounded-r-full bg-ember-gradient shadow-[0_0_14px_rgba(255,95,31,0.8)]"
                aria-hidden="true"
              />
            )}
            <Icon
              size={17}
              strokeWidth={1.8}
              className={`shrink-0 transition-colors ${isActive ? 'text-ember-400' : 'text-fg-3 group-hover:text-fg-2'}`}
              aria-hidden="true"
            />
            <span className="truncate">{label}</span>
          </>
        )}
      </NavLink>
    ))
  const group = (label: string, items: NavItem[]) => (
    <section className="flex flex-col gap-0.5">
      <p className="mb-1.5 px-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3">{label}</p>
      {links(items)}
    </section>
  )

  return (
    <div className="fb-shell astra-shell relative min-h-screen bg-ink-950 text-fg">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[80] -translate-y-24 rounded-lg bg-ember-400 px-4 py-2 font-semibold text-ink-950 transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      {open && (
        <button
          className="fixed inset-0 z-40 cursor-default bg-ink-950/70 backdrop-blur-sm animate-fade-in"
          aria-label="Close navigation backdrop"
          onClick={close}
        />
      )}
      <aside
        ref={sidebar}
        id="workspace-navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-white/[0.06] bg-ink-900/95 backdrop-blur-xl transition-[transform,visibility] duration-300 ease-out-expo ${
          compact ? (open ? 'translate-x-0 shadow-float' : 'invisible -translate-x-full') : ''
        }`}
        aria-label="Application navigation"
        role={compact && open ? 'dialog' : undefined}
        aria-modal={compact && open ? true : undefined}
        inert={(compact && !open) || undefined}
        aria-hidden={(compact && !open) || undefined}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(255,95,31,0.10),transparent_70%)]" aria-hidden="true" />
        <div className="relative flex items-center justify-between gap-2 px-4 pb-4 pt-5">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-xl no-underline"
            aria-label="FIREBRIDGE home"
            onClick={() => {
              if (compact) close()
              else setOpen(false)
            }}
          >
            <LogoMark size={38} animated />
            <Wordmark />
          </Link>
          <button
            ref={closeButton}
            className={`grid size-9 shrink-0 place-items-center rounded-lg text-fg-2 hover:bg-white/5 hover:text-fg ${compact ? '' : 'hidden'}`}
            aria-label="Close navigation"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="relative flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4 pt-2 scrollbar-none" aria-label="Primary navigation">
          {group('Workspace', workspace)}
          {group('Data', data)}
          {SHOW_DEMONSTRATION && <details key={demo ? 'demo' : 'research'} className="group/demo flex flex-col" open={demo}>
            <summary className="mb-1.5 flex cursor-pointer list-none items-center gap-2 rounded-md px-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-3 hover:text-fg-2 [&::-webkit-details-marker]:hidden">
              Demonstration
              <span className="rounded-full border border-snpp/30 bg-snpp/10 px-1.5 py-px font-sans text-[9.5px] tracking-wider text-snpp">SYNTHETIC</span>
              <ChevronDown size={13} className="ml-auto transition-transform group-open/demo:rotate-180" aria-hidden="true" />
            </summary>
            <div className="flex flex-col gap-0.5">{links(demonstrations)}</div>
          </details>}
          {system.length > 0 && group('System', system)}
        </nav>
        {sidebarFooter && <div className="relative border-t border-white/[0.06] p-4">{sidebarFooter}</div>}
      </aside>
      <main
        id="main-content"
        tabIndex={-1}
        className={`relative min-h-screen min-w-0 outline-none ${compact ? '' : 'pl-[260px]'}`}
        inert={open || undefined}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[420px] bg-[radial-gradient(60%_100%_at_70%_0%,rgba(255,95,31,0.07),transparent_70%)]" aria-hidden="true" />
        <header
          className={`sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.06] bg-ink-950/70 px-4 py-2 backdrop-blur-xl sm:px-6`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <button
              ref={menu}
              className={`grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-800 text-fg hover:bg-ink-700 ${compact ? '' : 'hidden'}`}
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls="workspace-navigation"
              onClick={() => setOpen(true)}
            >
              <Menu size={18} />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-[13px]">
              <Link to="/" className="hidden text-fg-3 no-underline hover:text-fg-2 sm:inline">FIREBRIDGE</Link>
              <span className="hidden text-fg-3/60 sm:inline" aria-hidden="true">/</span>
              <strong className="truncate font-medium text-fg">{home ? 'Home' : current?.label ?? 'Workspace'}</strong>
            </div>
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
            {demo ? (
              demoControls
            ) : (
              <>
                <span className="hidden items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1 text-[12px] text-fg-2 md:inline-flex">
                  <span className="relative flex size-1.5">
                    <span className="absolute inset-0 rounded-full bg-ok animate-pulse-ring" />
                    <span className="relative size-1.5 rounded-full bg-ok" />
                  </span>
                  Public workspace
                </span>
                <span className="hidden rounded-full border border-white/[0.07] px-3 py-1 font-mono text-[11px] text-fg-3 lg:inline">WGS 84 · UTC</span>
                {location.pathname !== '/analyses' && (
                  <Link to="/analyses" className="ui-button ui-button--primary ui-button--small">
                    <Plus size={15} aria-hidden="true" />
                    New analysis
                  </Link>
                )}
              </>
            )}
          </div>
        </header>
        {demo ? (
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-snpp/15 bg-snpp/[0.06] px-4 py-2 text-[12.5px] text-fg-2 sm:px-6">
            <FlaskConical size={14} className="text-snpp" aria-hidden="true" />
            <span>
              <strong className="font-semibold text-fg">Demo workspace.</strong> Maps and figures use synthetic fixtures, separate from saved analyses.
            </span>
            <Link to="/dashboard" className="ml-auto inline-flex items-center gap-1 font-medium text-snpp no-underline hover:underline">
              Open research dashboard <ArrowRight size={13} />
            </Link>
          </div>
        ) : researchPage ? (
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.04] px-4 py-2 text-[12.5px] text-fg-3 sm:px-6">
            <Database size={13} className="text-ember-300" aria-hidden="true" />
            <span>
              <strong className="font-medium text-fg-2">Published data.</strong> Results reflect the server’s releases. Test releases can contain synthetic records.
            </span>
            <Link to="/evidence" className="ml-auto inline-flex items-center gap-1 font-medium text-ember-300 no-underline hover:text-ember-200">
              Data & methods <ArrowRight size={12} />
            </Link>
          </div>
        ) : null}
        <RouteErrorBoundary key={location.pathname}>
          <Suspense
            fallback={
              <div className="flex min-h-[50vh] items-center justify-center gap-3 text-fg-2" role="status">
                <LogoMark size={28} animated />
                Loading workspace…
              </div>
            }
          >
            <div className="relative animate-fade-up">{children}</div>
          </Suspense>
        </RouteErrorBoundary>
      </main>
      {demo && !open && <ChatWidget />}
    </div>
  )
}
