import { useState } from 'react'
export function useCursorPage() {
  const [positions, setPositions] = useState<(string | undefined)[]>([undefined])
  return {
    cursor: positions.at(-1), first: positions.length === 1,
    next: (cursor: string) => setPositions((previous) => [...previous, cursor]),
    back: () => setPositions((previous) => previous.length > 1 ? previous.slice(0, -1) : previous),
  }
}

