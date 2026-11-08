import type { DetectionRow } from '@firebridge/results';

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Text cells can contain formula prefixes after whitespace/control characters.
  // Numeric fields are passed as numbers and remain usable as numbers in CSV.
  const firstVisible = [...text].find((char) => char.charCodeAt(0) > 32 && char.trim().length > 0);
  if (typeof value === 'string' && ((firstVisible !== undefined && '=+-@'.includes(firstVisible)) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function* csvChunks(rows: AsyncIterable<DetectionRow>): AsyncGenerator<string> {
  yield 'id,source_id,acquired_at,longitude,latitude,confidence_raw,day_night,frp_mw\r\n';
  for await (const row of rows) {
    yield [row.id, row.source_id, row.acquired_at, row.longitude, row.latitude,
      row.confidence_raw, row.day_night, row.frp_mw].map(csvCell).join(',') + '\r\n';
  }
}
