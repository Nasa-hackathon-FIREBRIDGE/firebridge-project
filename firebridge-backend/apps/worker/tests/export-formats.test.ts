import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import parquet from 'parquetjs-lite';
import type { DetectionRow } from '@firebridge/results';
import { csvCell } from '../src/exports/csv.js';
import { writeExport } from '../src/exports/write-export.js';

const row: DetectionRow = { id: '9007199254740993', source_id: 'satellite', acquired_at: '2026-01-01T00:00:00.000000Z',
  longitude: -4, latitude: 32, confidence_raw: '=1+1', day_night: null, frp_mw: 12.5 };
async function* rows(count = 1) { for (let i = 0; i < count; i++) yield { ...row, id: String(BigInt(row.id) + BigInt(i)) }; }
async function collect(format: 'csv' | 'geojson' | 'parquet', count = 1) {
  const chunks: Buffer[] = [];
  const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  await writeExport(format, rows(count), output);
  return Buffer.concat(chunks);
}

describe('Streaming export formats', () => {
  it.each(['=cmd()', '+cmd()', '-cmd()', '@cmd()', '  =cmd()', '\tformula', '\rcell', '\u0000=cmd()'])('neutralizes CSV formula %j', (text) => {
    expect(csvCell(text)).toBe(`"'${text}"`);
  });
  it('escapes CSV quotes/newlines while preserving numeric coordinates', () => {
    expect(csvCell('hello,"world"\nnext')).toBe('"hello,""world""\nnext"');
    expect(csvCell(-4.5)).toBe('"-4.5"');
  });
  it('writes CSV without loss of bigint IDs and neutralizes confidence text', async () => {
    const file = (await collect('csv')).toString();
    expect(file).toContain('"9007199254740993"');
    expect(file).toContain('"\'=1+1"');
    expect(file.split('\r\n')).toHaveLength(3);
  });
  it('writes valid GeoJSON with exact coordinates and properties', async () => {
    const file = JSON.parse((await collect('geojson', 2)).toString());
    expect(file.features).toHaveLength(2);
    expect(file.features[0]).toMatchObject({ type: 'Feature', id: row.id,
      geometry: { type: 'Point', coordinates: [-4, 32] }, properties: { confidence_raw: '=1+1' } });
  });
  it('writes a readable Parquet file across multiple row groups', async () => {
    const file = await collect('parquet', 2200);
    expect(file.subarray(0, 4).toString()).toBe('PAR1');
    expect(file.subarray(-4).toString()).toBe('PAR1');
    const reader = await parquet.ParquetReader.openBuffer(file);
    try {
      const cursor = reader.getCursor();
      expect(await cursor.next()).toMatchObject({ id: row.id, longitude: -4, latitude: 32, frp_mw: 12.5 });
      let count = 1;
      while (await cursor.next()) count++;
      expect(count).toBe(2200);
    } finally { await reader.close(); }
  });
  it.each(['csv', 'geojson', 'parquet'] as const)('writes a valid empty %s', async (format) => {
    const file = await collect(format, 0);
    if (format === 'csv') expect(file.toString().split('\r\n')).toHaveLength(2);
    if (format === 'geojson') expect(JSON.parse(file.toString()).features).toEqual([]);
    if (format === 'parquet') {
      const reader = await parquet.ParquetReader.openBuffer(file);
      expect(await reader.getCursor().next()).toBeNull();
      await reader.close();
    }
  });
  it('keeps a large CSV stream bounded when its destination applies backpressure', async () => {
    let produced = 0;
    let consumed = 0;
    let maximumAhead = 0;
    let peakRss = process.memoryUsage().rss;
    const baseline = peakRss;
    async function* source() {
      for await (const value of rows(50000)) {
        produced++;
        maximumAhead = Math.max(maximumAhead, produced - consumed);
        if (produced % 1000 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
        yield value;
      }
    }
    const output = new Writable({ highWaterMark: 1024, write(_chunk, _encoding, callback) {
      consumed++;
      setImmediate(callback);
    } });
    await writeExport('csv', source(), output);
    expect(produced).toBe(50000);
    expect(maximumAhead).toBeLessThan(3000);
    console.info(JSON.stringify({ benchmark: 'CSV 50000 rows / slow sink', maximumAhead, rssDeltaBytes: peakRss - baseline }));
  }, 30000);
  it.each(['csv', 'geojson', 'parquet'] as const)('propagates storage failures for %s', async (format) => {
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('DISK_FAILURE')); } });
    output.on('error', () => undefined);
    await expect(writeExport(format, rows(300), output)).rejects.toBeDefined();
  });
});
