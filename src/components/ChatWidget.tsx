import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Bot, Send, Trash2, X } from 'lucide-react'
import { ASSISTANT_STATUS, SUGGESTED_QUESTIONS, localAssistant, type AssistantService } from '../assistant'
import { useAppState } from '../useAppState'

interface ChatMessage { id: number; role: 'user' | 'assistant'; text: string }

const GREETING = 'Ask about the current filters, selected satellites or selected detections. Answers are generated locally from sample data.'

export function ChatWidget({ service = localAssistant }: { service?: AssistantService }) {
  const state = useAppState()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const nextId = useRef(1)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight }) }, [messages, pending, open])
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const close = () => { setOpen(false); launcherRef.current?.focus() }

  async function send(raw: string) {
    const text = raw.trim()
    if (!text) { setError('Type a question before sending.'); return }
    if (pending) return
    setError('')
    setDraft('')
    setMessages((current) => [...current, { id: nextId.current++, role: 'user', text }])
    setPending(true)
    const { area, startDate, endDate, platforms, searchText, frpThresholdMw, selectedDetectionId } = state
    let reply: string
    try {
      reply = await service.answer(text, { selection: { area, startDate, endDate, platforms, searchText, frpThresholdMw }, selectedDetectionId })
    } catch {
      reply = 'The assistant could not produce an answer. No data was changed.'
    }
    setMessages((current) => [...current, { id: nextId.current++, role: 'assistant', text: reply }])
    setPending(false)
  }

  const onSubmit = (event: FormEvent) => { event.preventDefault(); void send(draft) }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(draft) }
  }

  return (
    <div className="chat-root" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close() } }}>
      {open && (
        <section className="chat-panel" role="dialog" aria-label="Astra Data Assistant" aria-modal="false">
          <header className="chat-header">
            <span className="chat-title"><Bot size={16} /><strong>Astra Data Assistant</strong></span>
            <span className="chat-header-actions">
              <button type="button" className="icon-button" aria-label="Clear conversation" title="Clear conversation" onClick={() => { setMessages([]); setError('') }} disabled={!messages.length}><Trash2 size={14} /></button>
              <button type="button" className="icon-button" aria-label="Close data assistant" onClick={close}><X size={15} /></button>
            </span>
          </header>
          <p className="chat-status">{ASSISTANT_STATUS}</p>
          <div className="chat-messages" ref={listRef} role="log" aria-live="polite" aria-label="Conversation">
            {!messages.length && <p className="chat-empty">{GREETING}</p>}
            {messages.map((message) => <div key={message.id} className={`chat-message chat-${message.role}`}><span className="chat-author">{message.role === 'user' ? 'You' : 'Assistant'}</span><p>{message.text}</p></div>)}
            {pending && <div className="chat-message chat-assistant"><span className="chat-author">Assistant</span><p>Reading sample data…</p></div>}
          </div>
          <div className="chat-suggestions" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((question) => <button type="button" key={question} onClick={() => void send(question)}>{question}</button>)}
          </div>
          <form className="chat-form" onSubmit={onSubmit}>
            <textarea ref={inputRef} rows={2} value={draft} placeholder="Ask about the sample data…" aria-label="Message" onChange={(event) => { setDraft(event.target.value); if (error) setError('') }} onKeyDown={onKeyDown} />
            <button type="submit" className="chat-send" aria-label="Send message"><Send size={15} /></button>
          </form>
          {error && <p className="chat-error" role="alert">{error}</p>}
        </section>
      )}
      <button ref={launcherRef} type="button" className="chat-launcher" aria-label={open ? 'Hide data assistant' : 'Open data assistant'} aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Bot size={20} />
      </button>
    </div>
  )
}
