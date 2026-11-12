import { useId, useRef, type ReactNode } from 'react'
import { Download } from 'lucide-react'

/** Export the actual SVG with resolved styles; no remote rendering or data upload. */
function saveSvg(svg: SVGSVGElement, name: string, title: string, figure: HTMLElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const originals = [svg, ...svg.querySelectorAll('*')]
  const copies = [copy, ...copy.querySelectorAll('*')]
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor']
  originals.forEach((element, i) => {
    const style = getComputedStyle(element)
    for (const property of properties) (copies[i] as SVGElement).style.setProperty(property, style.getPropertyValue(property))
  })
  const ns = 'http://www.w3.org/2000/svg'
  const width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height
  const wrap = (text: string, averageWidth = 6) => {
    const limit = Math.max(12, Math.floor((width - 40) / averageWidth))
    return text.split(/\s+/).reduce<string[]>((lines, word) => {
      if (!lines.length || lines.at(-1)!.length + word.length > limit) lines.push(word)
      else lines[lines.length - 1] += ' ' + word
      return lines
    }, [])
  }
  const page = svg.closest('.viz-page')
  const context = page?.querySelector('.viz-filter-foot')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const controls = [...figure.querySelectorAll('select')].map((select) => `${select.getAttribute('aria-label')}: ${select.selectedOptions[0]?.textContent ?? ''}`).join(' · ')
  const legend = [...figure.querySelectorAll('[data-export-label]')].map((node) => node.getAttribute('data-export-label')).join('; ')
  const notes = [controls, figure.querySelector('.lab-chart-note')?.textContent, legend].filter(Boolean).join(' · ')
  const titleLines = wrap(`FIREBRIDGE · ${title}`, 9)
  const contextLines = wrap(context), footer = wrap(notes)
  const titleOffset = (titleLines.length - 1) * 22
  const top = 50 + titleOffset + contextLines.length * 15
  const outer = document.createElementNS(ns, 'svg')
  outer.setAttribute('xmlns', ns); outer.setAttribute('viewBox', `0 0 ${width} ${top + height + 30 + footer.length * 15}`)
  outer.setAttribute('width', String(width)); outer.setAttribute('height', String(top + height + 30 + footer.length * 15))
  outer.setAttribute('role', 'img'); outer.setAttribute('aria-label', title)
  const backdrop = document.createElementNS(ns, 'rect')
  backdrop.setAttribute('width', '100%'); backdrop.setAttribute('height', '100%'); backdrop.setAttribute('fill', '#10141b')
  outer.append(backdrop)
  const text = (value: string, y: number, size = 11, color = '#aeb9c9') => {
    const node = document.createElementNS(ns, 'text')
    node.setAttribute('x', '20'); node.setAttribute('y', String(y)); node.setAttribute('fill', color)
    node.setAttribute('font-family', 'system-ui, sans-serif'); node.setAttribute('font-size', String(size)); node.textContent = value
    outer.append(node)
  }
  titleLines.forEach((value, i) => text(value, 27 + i * 22, 17, '#f1f4f8'))
  contextLines.forEach((value, i) => text(value, 47 + titleOffset + i * 15))
  copy.setAttribute('width', String(width)); copy.setAttribute('height', String(height)); copy.setAttribute('y', String(top))
  outer.append(copy)
  footer.forEach((value, i) => text(value, top + height + 19 + i * 15))
  const metadata = document.createElementNS(ns, 'desc')
  metadata.textContent = `${figure.querySelector('.viz-help')?.textContent ?? ''} ${notes} · ${context} · Data release: ${page?.querySelector('.viz-filter-foot [title]')?.getAttribute('title') ?? 'not supplied'}`
  outer.prepend(metadata)
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(outer)], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url; a.download = `firebridge-${name}.svg`; a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LabChart({ title, kind, description, children, controls, note, className = '', exportable = true }: {
  title: string; kind: string; description: string; children: ReactNode; controls?: ReactNode; note?: ReactNode; className?: string; exportable?: boolean
}) {
  const id = useId()
  const figure = useRef<HTMLElement>(null)
  return <section className={`card viz-card lab-card ${className}`}>
    <figure className="viz-figure" aria-labelledby={id} ref={figure}>
      <header className="lab-chart-heading"><div><span className="viz-overline">{kind}</span><figcaption id={id}>{title}</figcaption></div>
        <button type="button" className="lab-svg-button" disabled={!exportable} aria-label={`Download SVG: ${title}`} title="Download this chart as SVG" onClick={() => {
          const svg = figure.current?.querySelector<SVGSVGElement>('.lab-scroll > svg, .lab-matrix > svg')
          if (svg && figure.current) saveSvg(svg, title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, figure.current)
        }}><Download size={14} aria-hidden="true" /><span>SVG</span></button>
      </header>
      <p className="viz-help">{description}</p>
      {controls && <div className="lab-controls">{controls}</div>}
      {children}
      {note && <p className="lab-chart-note">{note}</p>}
    </figure>
  </section>
}

export function LabEmpty({ children }: { children: ReactNode }) {
  return <div className="lab-empty" role="status"><span aria-hidden="true">↗</span><p>{children}</p></div>
}
