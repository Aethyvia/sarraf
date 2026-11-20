import { eq } from 'drizzle-orm';
import { createContext, useContext, type ReactNode } from 'react';

import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { useLive } from './live';

export type Settings = typeof settings.$inferSelect;

const SettingsContext = createContext<Settings | null>(null);

/** Live settings row; children render once it has loaded. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  // useLive reads whichever file is open (data saved per account, owner Nov 14).
  const row = useLive((d) => d.select().from(settings).where(eq(settings.id, 1)).get(), []);
  if (!row) return null;
  return <SettingsContext.Provider value={row}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('useSettings must be used inside SettingsProvider');
  return value;
}

/** Hide amounts on or off everywhere (the header eye and the Settings switch do the same). */
export function setHideAmounts(on: boolean): void {
  db.update(settings).set({ hideAmounts: on, updatedAt: new Date().toISOString() }).where(eq(settings.id, 1)).run();
}
