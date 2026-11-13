import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DetectionRow, ExportFormat } from '@firebridge/results';
import { csvChunks } from './csv.js';
import { geojsonChunks } from './geojson.js';
import { writeParquet } from './parquet.js';

export async function writeExport(format: ExportFormat, rows: AsyncIterable<DetectionRow>, output: Writable): Promise<void> {
  if (format === 'parquet') {
    await writeParquet(rows, output);
  } else {
    await pipeline(Readable.from(format === 'csv' ? csvChunks(rows) : geojsonChunks(rows), { objectMode: false }), output);
  }
}
