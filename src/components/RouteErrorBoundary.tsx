import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { logDiagnostic } from '../lib/userFeedback'

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    logDiagnostic(error, 'page-render')
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="astra-page astra-render-error" role="alert">
        <AlertTriangle size={28} />
        <h1>This view couldn’t be displayed</h1>
        <p>Try opening it again. You can use the navigation to continue to another section.</p>
        <button className="button button-primary" onClick={() => this.setState({ failed: false })}>
          <RotateCcw size={15} />
          Try this view again
        </button>
      </section>
    )
  }
}
