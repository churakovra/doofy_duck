import { readdir, readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';

export async function migrationFiles(): Promise<string[]> {
  const directory = new URL('../../backend/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!files.length || files.some(name => !/^\d+_.+\.sql$/.test(name))) throw Error('invalid migration files');
  return files;
}

export async function migrationsReady(pool: Pool | PoolClient): Promise<boolean> {
  const versions = (await migrationFiles()).map(name => Number(name.split('_')[0]));
  const result = await pool.query<{ count: string }>('SELECT count(DISTINCT version) AS count FROM core_schema_migrations WHERE version = ANY($1::int[])', [versions]);
  return Number(result.rows[0]?.count) === versions.length;
}

export async function migrate(pool: Pool): Promise<void> {
  const directory = new URL('../../backend/migrations/', import.meta.url);
  const files = await migrationFiles();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(731044210302)');
    await client.query('CREATE TABLE IF NOT EXISTS core_schema_migrations(version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of files) {
      const version = Number(name.split('_')[0]);
      const existing = await client.query('SELECT 1 FROM core_schema_migrations WHERE version=$1', [version]);
      if (existing.rowCount) continue;
      await client.query(await readFile(new URL(name, directory), 'utf8'));
      await client.query('INSERT INTO core_schema_migrations(version,name) VALUES($1,$2)', [version, name]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
