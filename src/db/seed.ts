import { count, sql } from 'drizzle-orm';

import { ensureBaseData } from './base-data';
import { buildSampleData } from './sample';
import { accounts } from './schema';
import type { AppDb } from './types';

/**
 * Development sample data, matching the design canvas (as of Sep 30, 2026).
 * Only runs in dev builds, and only on an empty database.
 */
export function seedSampleData(db: AppDb): boolean {
  const n = db.select({ n: count() }).from(accounts).get()?.n ?? 0;
  if (n > 0) return false;
  db.transaction((tx) => buildSampleData(tx));
  return true;
}

/**
 * Development only: wipes every table and loads the sample data again, so a
 * dev build can go back to the state the canvas shows.
 */
export function resetSampleData(db: AppDb): void {
  const tables = db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'`)
    .map((t) => t.name);
  db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    db.transaction((tx) => {
      for (const name of tables) tx.run(sql.raw(`delete from "${name}"`));
    });
  } finally {
    db.run(sql`PRAGMA foreign_keys = ON`);
  }
  ensureBaseData(db);
  seedSampleData(db);
}
