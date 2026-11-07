export const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export const displayValue = (value: unknown): string =>
  value === null || value === undefined ? 'Inconnu / non disponible' :
    typeof value === 'boolean' ? value ? 'Oui' : 'Non' : String(value)

