import { eq } from 'drizzle-orm';

import { ledgers, settings } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { nowIso } from '@/lib/dates';
import { defaultAccountLook, createAccount } from './accounts';
import { createLedger } from './ledgers';
import { FREE_LIMITS, type Plan } from './limits';
import { moveCurrency } from './currency-order';
import { addDefaultCategories } from './default-categories';

/** Setup step 1's chips: common currencies for people paid from abroad. */
export const ALSO_CHOICES = ['USD', 'EUR', 'AED', 'SAR', 'GBP'] as const;

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
 * Setup step 2 (owner, Nov 12 — replaces the Payoneer templates): plain
 * defaults, a Bank and a Cash account for each chosen currency, no
 * institution. Everyday currency ticked; the others unticked. Anything else
 * (Payoneer, Wise, institutions, opening balances) is added on the Accounts
 * screen, where setup ends. E.g. PKR + USD → Bank PKR, Cash PKR (ticked),
 * Bank USD, Cash USD.
 */
export function suggestedAccounts(everyday: string, also: string[]): SuggestedAccount[] {
  const out: SuggestedAccount[] = [];
  const add = (name: string, currency: string, ticked: boolean, renameHint = false) => {
    const look = defaultAccountLook(name, null);
    out.push({ key: name, name, currency, institution: null, ...look, ticked, renameHint });
  };
  for (const c of [everyday, ...also.filter((x) => x !== everyday)]) {
    add(`Bank ${c}`, c, c === everyday, true);
    add(`Cash ${c}`, c, c === everyday);
  }
  // Never more ticked than Free covers.
  let n = 0;
  for (const a of out) if (a.ticked && ++n > FREE_LIMITS.accounts) a.ticked = false;
  return out;
}

/**
 * Finishes setup: the everyday currency, the Personal ledger (default), the
 * chosen accounts (checked against the plan), the default categories, Home's
 * currency order, and the onboarding date. Balances are entered later.
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
    addDefaultCategories(tx);
    const order = [input.everyday, ...input.also.filter((c) => c !== input.everyday)];
    order.forEach((c, i) => moveCurrency(tx, order.slice(0, i), c, i));
    tx.update(settings).set({ onboardingCompletedAt: nowIso() }).where(eq(settings.id, 1)).run();
  });
  return { accountIds: ids };
}
