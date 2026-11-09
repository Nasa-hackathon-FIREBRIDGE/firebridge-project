import { UserInputError } from '../../lib/userFeedback'
import type { ResourceBudget } from '../../services/data.types'

export function validateIngestionPlan(start: string, end: string, budget: ResourceBudget, optionalWindow = false): UserInputError | null {
  if (!(optionalWindow && !start && !end)) {
    const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
    const valid = (value: string) => timestamp.test(value) && Number.isFinite(Date.parse(value)) &&
      new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === value.slice(0, 10)
    if (!valid(start) || !valid(end)) {
      return new UserInputError('Renseigner un début et une fin ISO 8601 avec fuseau, par exemple 2024-01-17T00:00:00Z.')
    }
    if (Date.parse(end) <= Date.parse(start)) return new UserInputError('La fin exclusive doit être strictement après le début.')
    if (Date.parse(end) > Date.now()) return new UserInputError('La période ne peut pas se terminer dans le futur.')
  }
  if (!Number.isSafeInteger(budget.max_chunks) || budget.max_chunks < 1 || budget.max_chunks > 366 ||
    !Number.isSafeInteger(budget.max_bytes) || budget.max_bytes < 1 || budget.max_bytes > 1_000_000_000_000) {
    return new UserInputError('Le budget doit contenir des entiers positifs : au maximum 366 blocs et 1 000 000 000 000 octets.')
  }
  return null
}
