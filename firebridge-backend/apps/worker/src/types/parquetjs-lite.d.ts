declare module 'parquetjs-lite' {
  import type { Writable } from 'node:stream';
  export class ParquetSchema {
    constructor(fields: Record<string, { type: 'UTF8' | 'DOUBLE'; optional?: boolean }>);
  }
  export class ParquetWriter {
    constructor(schema: ParquetSchema, envelope: ParquetEnvelopeWriter, options: Record<string, unknown>);
    static openStream(schema: ParquetSchema, stream: Writable): Promise<ParquetWriter>;
    setRowGroupSize(size: number): void;
    appendRow(row: Record<string, unknown>): Promise<void>;
    close(): Promise<void>;
  }
  export class ParquetEnvelopeWriter {
    static openStream(schema: ParquetSchema, stream: Writable, options: Record<string, unknown>): Promise<ParquetEnvelopeWriter>;
    writeHeader(): Promise<void>;
  }
  export class ParquetReader {
    static openBuffer(buffer: Buffer): Promise<ParquetReader>;
    getCursor(): { next(): Promise<Record<string, unknown> | null> };
    close(): Promise<void>;
  }
}
