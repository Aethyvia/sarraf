import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';

import { db } from '@/db/client';
import type { AppDb } from '@/db/types';

/**
 * Runs a data-layer function and re-runs it whenever the database changes.
 * For derived values (balances, usage counts) that a single Drizzle query can't express.
 */
export function useLive<T>(compute: (db: AppDb) => T, deps: readonly unknown[] = []): T {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const sub = addDatabaseChangeListener(() => setVersion((v) => v + 1));
    return () => sub.remove();
  }, []);
  // `compute` is a new closure every render; it re-runs only when the database or `deps` change.
  const key = JSON.stringify(deps);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => compute(db), [version, key]);
}
