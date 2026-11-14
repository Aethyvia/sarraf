import { sql } from 'drizzle-orm';

import type { AppDb } from './types';

/**
 * Rewrites the database file so deleted rows don't linger in its free pages
 * (owner, Nov 14: no residue). Harmless where VACUUM isn't available (tests).
 */
export function compactDatabase(db: AppDb): void {
  try {
    db.run(sql`VACUUM`);
  } catch {
    // An in-memory test database, or a transaction is open: nothing left to compact.
  }
}
