import type { Writable } from 'node:stream';
import type { DetectionRow } from '@firebridge/results';
import parquet from 'parquetjs-lite';

export async function writeParquet(rows: AsyncIterable<DetectionRow>, output: Writable): Promise<void> {
  const schema = new parquet.ParquetSchema({
    id: { type: 'UTF8' }, source_id: { type: 'UTF8' }, acquired_at: { type: 'UTF8' },
    longitude: { type: 'DOUBLE' }, latitude: { type: 'DOUBLE' },
    confidence_raw: { type: 'UTF8', optional: true }, day_night: { type: 'UTF8', optional: true },
    frp_mw: { type: 'DOUBLE', optional: true }
  });
  // parquetjs-lite's convenience constructor does not await its header write.
  // Explicitly await the public envelope API so an early disk failure cannot
  // become an unhandled rejection; the constructor's second header is a no-op.
  const envelope = await parquet.ParquetEnvelopeWriter.openStream(schema, output, {});
  await envelope.writeHeader();
  envelope.writeHeader = () => Promise.resolve();
  const writer = new parquet.ParquetWriter(schema, envelope, {});
  writer.setRowGroupSize(2048);
  try {
    for await (const row of rows) await writer.appendRow({ ...row });
  } finally {
    await writer.close();
  }
}
