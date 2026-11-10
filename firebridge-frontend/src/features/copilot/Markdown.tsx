import { Fragment, useState, type ReactNode } from 'react'

const INLINE = /(\*\*[^*\n]+\*\*|\[\s*F\d+(?:\s*[,;]\s*F?\d+)*\s*\]|`[^`\n]+`|(?<![\w*])\*[^*\n]+\*(?![\w*]))/g

/** A citation to an evidence fact: expands in place to the fact itself. */
function Citation({ ids, facts }: { ids: string[]; facts: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const known = ids.filter((id) => facts[id])
  return (
    <span className="inline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={known.map((id) => `${id}: ${facts[id]}`).join('\n') || 'Evidence fact'}
        className="mx-0.5 inline-flex items-center rounded-md border-0 bg-ember-500/15 px-1.5 py-px align-[1px] font-mono text-[10.5px] font-semibold text-ember-200 hover:bg-ember-500/25"
      >
        {ids.join(' · ')}
      </button>
      {open && known.length > 0 && (
        <span className="my-1.5 block rounded-lg border border-ember-400/20 bg-ink-800/80 px-2.5 py-2 text-[12px] leading-relaxed text-fg-2">
          {known.map((id) => <span key={id} className="block"><span className="font-mono text-ember-300">{id}</span> {facts[id]}</span>)}
        </span>
      )}
    </span>
  )
}

function inline(text: string, facts: Record<string, string>): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-fg">{part.slice(2, -2)}</strong>
    if (/^\[\s*F\d+/.test(part)) return <Citation key={i} ids={part.replace(/[[\]\s]/g, '').split(/[,;]/).map((id) => (id.startsWith('F') ? id : `F${id}`))} facts={facts} />
    if (part.startsWith('`')) return <code key={i} className="rounded bg-white/[0.06] px-1 font-mono text-[12px]">{part.slice(1, -1)}</code>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Minimal, safe Markdown for model answers: paragraphs, lists, headings, simple tables, emphasis,
 *  code and [F#] evidence citations. Builds React elements only; never injects HTML. */
export function Markdown({ text, facts = {} }: { text: string; facts?: Record<string, string> }) {
  // Some models cite in full-width brackets: 【F12】 → [F12]; other bracketed notes are dropped.
  const normalized = text.replace(/【\s*(F\d+(?:\s*[,;]\s*F?\d+)*)\s*】/g, '[$1]').replace(/【[^】]{0,60}】/g, '')
  const lines = normalized.replace(/\r/g, '').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trimEnd()
    if (!line.trim()) {
      i++
      continue
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells)
        i++
      }
      const [head, ...body] = rows
      blocks.push(
        <div key={blocks.length} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px] [&_th]:static [&_th]:bg-transparent [&_th]:font-sans [&_th]:normal-case [&_th]:tracking-normal">
            <thead><tr>{head.map((c, j) => <th key={j} className="border-b border-white/10 py-1 pr-3 font-medium text-fg-2">{inline(c, facts)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k} className="border-b border-white/[0.04]">{r.map((c, j) => <td key={j} className="py-1 pr-3 text-fg">{inline(c, facts)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: { depth: number; text: string }[] = []
      while (i < lines.length && bullet.test(lines[i])) {
        items.push({ depth: lines[i].search(/\S/) >= 2 ? 1 : 0, text: lines[i].replace(bullet, '') })
        i++
      }
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List key={blocks.length} className={`my-1.5 flex flex-col gap-1 ${ordered ? 'list-decimal' : 'list-disc'} pl-5 marker:text-ember-300/70`}>
          {items.map((item, j) => <li key={j} className={item.depth ? 'ml-4 list-[circle]' : ''}>{inline(item.text, facts)}</li>)}
        </List>,
      )
      continue
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push(<p key={blocks.length} className="mb-1 mt-2 font-semibold text-fg">{inline(heading[1], facts)}</p>)
      i++
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && !bullet.test(lines[i]) && !lines[i].trim().startsWith('|') && !/^#{1,4}\s/.test(lines[i])) {
      paragraph.push(lines[i].trim())
      i++
    }
    blocks.push(<p key={blocks.length} className="my-1.5">{inline(paragraph.join(' '), facts)}</p>)
  }
  return <div className="text-[13.5px] leading-relaxed text-fg-2 [overflow-wrap:anywhere]">{blocks}</div>
}
