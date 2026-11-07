import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { createContext, useContext, type ReactNode } from 'react';

import { db } from '@/db/client';
import { settings } from '@/db/schema';

export type Settings = typeof settings.$inferSelect;

const SettingsContext = createContext<Settings | null>(null);

/** Live settings row; children render once it has loaded. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data } = useLiveQuery(db.select().from(settings).where(eq(settings.id, 1)));
  const row = data[0];
  if (!row) return null;
  return <SettingsContext.Provider value={row}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}
