import { useContext } from 'react'
import { StateContext, type AppState } from './state-context'

export function useAppState(): AppState {
  const value = useContext(StateContext)
  if (!value) throw new Error('useAppState must be used inside AppStateProvider')
  return value
}
