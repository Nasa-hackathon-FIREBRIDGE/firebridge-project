import pg from 'pg';
import { ApiError } from '../utils/response.js';

export interface SqlReader {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface SnapshotDatabase {
  snapshot<T>(read: (db: SqlReader) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function createDatabase(connectionString: string): SnapshotDatabase {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    idle_in_transaction_session_timeout: 10000
  });
  pool.on('error', () => {
    /* Requests report a sanitized 503 while the pool reconnects. */
  });
  return {
    async snapshot<T>(read: (db: SqlReader) => Promise<T>) {
      const client = await pool.connect().catch(() => {
        throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.');
      });
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await read({
          async query<R>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          }
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof ApiError) throw error;
        throw new ApiError(503, 'SNAPSHOT_UNAVAILABLE', 'No usable service snapshot is available.');
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
}
