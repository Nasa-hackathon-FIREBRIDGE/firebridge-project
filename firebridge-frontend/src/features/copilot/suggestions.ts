import { fmtMonth } from '../bridge/format'
import type { CopilotView } from './context'

/** Questions worth asking from where the user is in the workspace. */
export function suggestionsFor(view: CopilotView): string[] {
  const month = view.month ? fmtMonth(view.month, 'long') : null
  switch (view.section) {
    case 'fire-calendar':
      return month
        ? [`Why does ${month} stand out?`, `Do all satellites agree on ${month}?`, `What was burning in ${month}?`]
        : ['Which months were unusual, and are they confirmed?', 'Why are some months disputed?', 'Which raw totals are misleading?']
    case 'sensor-bridge':
      return ['Why does VIIRS record more fires than MODIS?', 'What changed when Aqua drifted?', 'What happens to the record when Aqua stops?']
    case 'workspace-top':
      return ['What was the largest fire episode?', 'What happened on the busiest day?', 'Where is the record incomplete?']
    default:
      return ['What should a fire manager take from this analysis?', 'Which months were unusual?', 'Can I trust a year-to-year comparison here?']
  }
}
