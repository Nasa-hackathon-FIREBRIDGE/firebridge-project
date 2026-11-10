/** Bring an element into view once it has rendered, and flash it so the user sees what the
 *  copilot pointed at. Tabs mount lazily, so the element may appear a few frames later. */
export function reveal(id: string, tries = 90): void {
  const element = document.getElementById(id)
  if (!element) {
    if (tries > 0) requestAnimationFrame(() => reveal(id, tries - 1))
    return
  }
  element.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  const target = (element.closest('section') as HTMLElement | null) ?? element
  target.animate?.(
    [
      { boxShadow: '0 0 0 0 rgba(255,124,64,0)' },
      { boxShadow: '0 0 0 3px rgba(255,124,64,0.65), 0 0 40px -6px rgba(255,124,64,0.55)', offset: 0.25 },
      { boxShadow: '0 0 0 0 rgba(255,124,64,0)' },
    ],
    { duration: 1800, easing: 'ease-out' },
  )
}
