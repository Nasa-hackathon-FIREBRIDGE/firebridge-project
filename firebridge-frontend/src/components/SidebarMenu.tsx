import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface SidebarMenuProps {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  className: string
  placement: 'below' | 'above'
  trigger: ReactNode
  children: ReactNode
}

export function SidebarMenu({ id, open, onOpenChange, label, className, placement, trigger, children }: SidebarMenuProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  const items = () => Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]') ?? [])

  const focusItem = (index: number) => {
    const list = items()
    if (list.length) list[(index + list.length) % list.length].focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      onOpenChange(false)
      triggerRef.current?.focus()
      return
    }
    const list = items()
    const current = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(current + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(current < 0 ? -1 : current - 1) }
    else if (event.key === 'Home') { event.preventDefault(); focusItem(0) }
    else if (event.key === 'End') { event.preventDefault(); focusItem(-1) }
    else if (event.key === 'Tab') onOpenChange(false)
  }

  return (
    <div ref={wrapRef} className={`sidebar-menu-wrap ${className}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`sidebar-menu-trigger ${open ? 'sidebar-menu-trigger-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => onOpenChange(!open)}
      >
        {trigger}
        <ChevronDown size={14} className="sidebar-menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className={`sidebar-menu sidebar-menu-${placement}`} role="menu" aria-label={label} onClick={(event) => { if ((event.target as HTMLElement).closest('[role^="menuitem"]')) onOpenChange(false) }}>
          {children}
        </div>
      )}
    </div>
  )
}
