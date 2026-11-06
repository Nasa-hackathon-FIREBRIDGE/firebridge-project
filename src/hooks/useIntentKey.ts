import { useRef } from 'react'
import { createIdempotencyKey } from '../services/analyses.service'

/** An explicit retry of an unchanged form keeps its key, including after a timeout. */
export function useIntentKey() {
  const last = useRef<{ signature: string; key: string } | null>(null)
  return (intent: object) => {
    const signature = JSON.stringify(intent)
    if (last.current?.signature !== signature) last.current = { signature, key: createIdempotencyKey() }
    return last.current.key
  }
}

