import { runBridge, type BridgeInput } from './engine/index.ts'

/** The dedicated-worker surface used here (the app's tsconfig types the DOM, not webworker). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BridgeInput>) => void) | null
  postMessage: (message: unknown) => void
}

/** Runs the bridge engine off the main thread so large analyses never freeze the UI. */
scope.onmessage = (event) => {
  try {
    scope.postMessage({ ok: true, report: runBridge(event.data) })
  } catch (error) {
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}
