import { readFileSync } from 'node:fs';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from './db.js';

export async function runMigrations(db: Kysely<DB>, sqlFile: string): Promise<void> {
  const ddl = readFileSync(sqlFile, 'utf8');
  await sql.raw(ddl).execute(db);
}
