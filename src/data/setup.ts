import { eq } from 'drizzle-orm';

import { ledgers, settings } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { defaultAccountLook, createAccount } from './accounts';
import { createLedger } from './ledgers';
import { FREE_LIMITS, type Plan } from './limits';
import { moveCurrency } from './currency-order';

/** Setup step 1's chips: common currencies for people paid from abroad. */
export const ALSO_CHOICES = ['USD', 'EUR', 'AED', 'SAR', 'GBP'] as const;
/** Currencies usually held in a Payoneer-style balance; others are suggested as cash. */
const WALLET_CURRENCIES = new Set(['USD', 'EUR', 'GBP']);

export interface SuggestedAccount {
  key: string;
  name: string;
  currency: string;
  institution: string | null;
  icon: string;
  color: string;
  ticked: boolean;
  /** Bank accounts are named generically; the hint suggests renaming. */
  renameHint: boolean;
}

/**
 * Setup step 2's templates (First run — Decided Nov 7): Payoneer for USD/EUR/GBP,
 * Bank and Cash for the everyday currency (ticked), cash for other currencies
 * (unticked). E.g. PKR + USD, EUR, AED → Payoneer USD, Payoneer EUR, Bank PKR,
 * Cash PKR, Cash AED (unticked).
 */
export function suggestedAccounts(everyday: string, also: string[]): SuggestedAccount[] {
  const out: SuggestedAccount[] = [];
  const add = (name: string, currency: string, institution: string | null, ticked: boolean, renameHint = false) => {
    const look = defaultAccountLook(name, institution);
    out.push({ key: `${name}`, name, currency, institution, ...look, ticked, renameHint });
  };
  const others = also.filter((c) => c !== everyday);
  for (const c of others) if (WALLET_CURRENCIES.has(c)) add(`Payoneer ${c}`, c, 'Payoneer', true);
  add(`Bank ${everyday}`, everyday, null, true, true);
  add(`Cash ${everyday}`, everyday, null, true);
  for (const c of others) if (!WALLET_CURRENCIES.has(c)) add(`Cash ${c}`, c, null, false);
  // Never more ticked than Free covers.
  let n = 0;
  for (const a of out) if (a.ticked && ++n > FREE_LIMITS.accounts) a.ticked = false;
  return out;
}

/**
 * Finishes setup: the everyday currency, the Personal ledger (default), the
 * chosen accounts (checked against the plan), Home's currency order, and the
 * onboarding date. Balances are entered later.
 */
export function finishSetup(
  db: AppDb,
  input: { everyday: string; also: string[]; accounts: Pick<SuggestedAccount, 'name' | 'currency' | 'institution' | 'icon' | 'color'>[] },
  plan: Plan,
): { accountIds: string[] } {
  const ids: string[] = [];
  db.transaction((tx) => {
    tx.update(settings).set({ defaultCurrency: input.everyday, updatedAt: nowIso() }).where(eq(settings.id, 1)).run();
    if (!tx.select({ id: ledgers.id }).from(ledgers).get()) createLedger(tx, { name: 'Personal' }, plan);
    for (const a of input.accounts) ids.push(createAccount(tx, a, plan));
    const order = [input.everyday, ...input.also.filter((c) => c !== input.everyday)];
    order.forEach((c, i) => moveCurrency(tx, order.slice(0, i), c, i));
    tx.update(settings).set({ onboardingCompletedAt: nowIso() }).where(eq(settings.id, 1)).run();
  });
  return { accountIds: ids };
}
