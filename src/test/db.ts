/// <reference types="node" />
import fs from 'fs';
import path from 'path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';

import * as schema from '@/db/schema';
import type { AppDb } from '@/db/types';

let SQL: SqlJsStatic | null = null;

/**
 * A fresh in-memory database with every Drizzle migration applied, for unit
 * tests of the data layer. Same schema and SQL as the phone (SQLite via sql.js).
 */
export async function createTestDb(): Promise<AppDb> {
  SQL ??= await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON;');
  const dir = path.join(__dirname, '../../drizzle');
  const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
    for (const statement of fs.readFileSync(path.join(dir, `${tag}.sql`), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) sqlite.run(statement);
    }
  }
  return drizzle(sqlite, { schema }) as unknown as AppDb;
}
