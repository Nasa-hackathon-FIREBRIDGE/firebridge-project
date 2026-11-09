export const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export function externalReportUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
export const displayValue = (value: unknown): string =>
  value === null || value === undefined ? 'Inconnu / non disponible' :
    typeof value === 'boolean' ? value ? 'Oui' : 'Non' : String(value)

