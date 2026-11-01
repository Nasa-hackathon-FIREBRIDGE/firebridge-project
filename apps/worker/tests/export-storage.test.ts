import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { resultsConfig } from '@firebridge/results';
import { createStoredFile, localExportStorage, storagePath } from '@firebridge/results/storage';

const created: string[] = [];
function key() { const name = `${randomUUID()}.${randomUUID()}.csv`; created.push(name); return name; }
afterEach(async () => {
  for (const name of created.splice(0)) await localExportStorage.remove(name);
});

describe('Local export storage', () => {
  it.each(['../../secret.csv', 'C:\\secret.csv', '/tmp/file.csv', 'file.csv', '../' + randomUUID()])('rejects unsafe key %s', (value) => {
    expect(() => storagePath(value)).toThrow('Invalid storage key.');
  });
  it('atomically stores, hashes and streams a file from a validated key', async () => {
    const name = key();
    const staging = await createStoredFile(name);
    await pipeline(Readable.from(['hello', ' world']), staging.output);
    const file = await staging.commit();
    expect(file.bytes).toBe(11);
    expect(file.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    const download = await localExportStorage.openDownload(name);
    expect(download.bytes).toBe(11);
    expect(download.stream.readableHighWaterMark).toBeLessThanOrEqual(65536);
    let body = '';
    for await (const chunk of download.stream) body += chunk;
    expect(body).toBe('hello world');
  });
  it('does not expose an incomplete file and removes temporary files on abort', async () => {
    const name = key();
    const staging = await createStoredFile(name);
    staging.output.write('partial');
    await expect(localExportStorage.openDownload(name)).rejects.toMatchObject({ code: 'ENOENT' });
    await staging.abort();
    await expect(localExportStorage.openDownload(name)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('enforces the byte limit while streaming and cleans the partial output', async () => {
    const original = resultsConfig.EXPORT_MAX_BYTES;
    resultsConfig.EXPORT_MAX_BYTES = 1024;
    const staging = await createStoredFile(key());
    try {
      await expect(pipeline(Readable.from([Buffer.alloc(2048)]), staging.output)).rejects.toThrow('EXPORT_SIZE_LIMIT');
    } finally {
      resultsConfig.EXPORT_MAX_BYTES = original;
      await staging.abort();
    }
  });
  it('can close a download early without reading the whole artifact', async () => {
    const name = key();
    const staging = await createStoredFile(name);
    await pipeline(Readable.from([Buffer.alloc(200000)]), staging.output);
    await staging.commit();
    const download = await localExportStorage.openDownload(name);
    const closed = once(download.stream, 'close');
    download.stream.destroy();
    await closed;
    expect(download.stream.readableLength).toBeLessThan(200000);
    expect(download.stream.destroyed).toBe(true);
  });
});
