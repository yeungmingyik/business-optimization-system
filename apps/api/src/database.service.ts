import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow, types } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

types.setTypeParser(1082, (value) => value);

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool = new Pool({ max: 12, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  readonly orm = drizzle(this.pool);
  constructor() {
    const logConnectionError = (error: Error) =>
      process.stderr.write(
        `${JSON.stringify({ event: 'database_connection_error', message: error.message })}\n`,
      );
    this.pool.on('error', logConnectionError);
    this.pool.on('connect', (client) => client.on('error', logConnectionError));
  }
  async query<T extends QueryResultRow = any>(
    sql: string,
    params: any[] = [],
    tx?: PoolClient,
  ): Promise<QueryResult<T>> {
    return (tx ?? this.pool).query<T>(sql, params);
  }
  async transaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    let discard = false;
    try {
      await tx.query('BEGIN');
      const result = await fn(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK').catch(() => {
        discard = true;
      });
      throw error;
    } finally {
      tx.release(discard);
    }
  }
  async migrate() {
    const root = process.env.BOS_ROOT ?? resolve(__dirname, '../../..');
    const dir = resolve(root, 'packages/database/migrations');
    await this.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(739201)');
      await tx.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const name of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
        if ((await tx.query('SELECT name FROM schema_migrations WHERE name=$1', [name])).rowCount)
          continue;
        await tx.query(await readFile(resolve(dir, name), 'utf8'));
        await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      }
    });
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
