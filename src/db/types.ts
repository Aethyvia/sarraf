import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/**
 * Any synchronous Drizzle SQLite database with Sarraf's schema: expo-sqlite on
 * the phone, sql.js in unit tests. Data-layer code takes this so business rules
 * are tested without a device.
 *
 * Transactions on these drivers are synchronous. Inside db.transaction(), use
 * .get() / .all() / .run() and never await: an async callback would commit
 * after its first statement.
 */
export type AppDb = BaseSQLiteDatabase<'sync', any, typeof schema>;
