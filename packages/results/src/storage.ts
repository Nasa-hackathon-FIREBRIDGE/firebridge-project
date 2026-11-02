import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Transform, type Readable, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resultsConfig } from './config.js';

const keyPattern = /^[0-9a-f-]{36}\.[0-9a-f-]{36}\.(csv|geojson|parquet)$/;
export function storagePath(key: string): string {
  if (!keyPattern.test(key)) throw new Error('Invalid storage key.');
  return resolve(resultsConfig.EXPORT_STORAGE_DIR, key);
}

export interface StoredFile { key: string; bytes: number; sha256: string }
export interface ExportStorage {
  create(key: string): ReturnType<typeof createStoredFile>;
  openDownload(key: string): Promise<{ bytes: number; stream: Readable }>;
  remove(key: string): Promise<void>;
}

class FileMeter extends Transform {
  bytes = 0;
  readonly hash = createHash('sha256');
  override _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.bytes += chunk.length;
    if (this.bytes > resultsConfig.EXPORT_MAX_BYTES) {
      callback(new Error('EXPORT_SIZE_LIMIT'));
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }
}

export async function createStoredFile(key: string) {
  const target = storagePath(key);
  await mkdir(resultsConfig.EXPORT_STORAGE_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${target}.part`;
  const output = new FileMeter();
  const destination = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
  const completed = pipeline(output, destination);
  // A storage error may happen before the producer starts awaiting completion.
  void completed.catch(() => undefined);
  return {
    output,
    async commit(): Promise<StoredFile> {
      await completed;
      await rename(temporary, target);
      return { key, bytes: output.bytes, sha256: output.hash.digest('hex') };
    },
    async abort(): Promise<void> {
      output.destroy(new Error('EXPORT_ABORTED'));
      await completed.catch(() => undefined);
      await unlink(temporary).catch((error: { code?: string }) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  };
}

async function openDownload(key: string) {
  const filename = storagePath(key);
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Invalid export file.');
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('Invalid export file.');
    return { bytes: stat.size, stream: handle.createReadStream({ autoClose: true }) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export const localExportStorage: ExportStorage = {
  create: createStoredFile,
  openDownload,
  async remove(key: string): Promise<void> {
    await unlink(storagePath(key)).catch((error: { code?: string }) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
};
