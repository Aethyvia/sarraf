import { dec, toDecimalString, type DecimalString } from '@/lib/money';

/**
 * The lines of a transaction's receipt (owner, Nov 13, council "statement
 * style"): one place for the Charges page and the transaction page.
 *
 * - Money out (expense, transfer) starts with "Left X": the base amount plus
 *   charges paid separately from X. Then the Base amount, then those charges (+).
 * - Money in (income, and the To side of a transfer) ends with "Arrives in Y":
 *   exactly what landed, as on the bank statement. Charges taken separately
 *   from Y follow (−), then a bold "Y went up by" with what's left.
 * - Charges taken before it arrived come between the base and Arrives (−).
 * - A charge paid separately from any other account is its own line with its
 *   own currency: never added into a total in another currency.
 * - One sign per line; the label carries none.
 */
export type ReceiptKind = 'expense' | 'income' | 'transfer';

export interface ReceiptAccount {
  id: string;
  name: string;
  currency: string;
}

export interface ReceiptCharge {
  /** Passed back on the charge's line (to open it for editing). */
  key: string;
  deduction: 'already_deducted' | 'charged_separately';
  /** Charged separately: the account it came out of. */
  accountId?: string | null;
  amount: DecimalString | null;
  currency: string;
}

export interface ReceiptInput {
  kind: ReceiptKind;
  /** Where money left (expense, transfer). */
  from?: ReceiptAccount | null;
  /** Where money landed (income, transfer). */
  to?: ReceiptAccount | null;
  /** The base amount and its currency. */
  amount: DecimalString | null;
  currency: string;
  /** What left `from`, in its currency (before separate charges). */
  accountAmount?: DecimalString | null;
  /** What landed in `to`, in its currency (before separate charges taken there). */
  arrives?: DecimalString | null;
  /** A conversion between the base currency and `to`'s: the amount converted and the rate. */
  conversion?: { amount: DecimalString; rate: DecimalString; from: string; to: string } | null;
  charges: ReceiptCharge[];
}

export type ReceiptLineKind = 'left' | 'base' | 'charge' | 'converted' | 'arrives' | 'wentUp';

export interface ReceiptRow {
  key: string;
  kind: ReceiptLineKind;
  /** The account named on left / arrives / wentUp lines. */
  account?: ReceiptAccount;
  /** The charge on a charge line. */
  chargeKey?: string;
  /** Where a charge was taken: before it arrived, or separately from an account (named by id). */
  chargeWhere?: { kind: 'before' } | { kind: 'separately'; accountId: string | null };
  conversion?: ReceiptInput['conversion'];
  value?: DecimalString | null;
  currency?: string;
  sign?: '+' | '-' | null;
  bold?: boolean;
}

const sum = (xs: (DecimalString | null)[]) => xs.reduce((s, x) => (x ? s.plus(dec(x)) : s), dec('0'));

export function buildReceipt(input: ReceiptInput): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  const { from, to } = input;
  const outside = input.charges.filter((c) => c.deduction === 'charged_separately');
  const before = input.charges.filter((c) => c.deduction === 'already_deducted');
  const fromHere = from && input.kind !== 'income' ? outside.filter((c) => c.accountId === from.id) : [];
  const toHere = to && input.kind !== 'expense' ? outside.filter((c) => c.accountId === to.id && !fromHere.includes(c)) : [];
  const elsewhere = outside.filter((c) => !fromHere.includes(c) && !toHere.includes(c));
  const chargeRow = (c: ReceiptCharge, sign: '+' | '-' | null): ReceiptRow => ({
    key: `c-${c.key}`,
    kind: 'charge',
    chargeKey: c.key,
    chargeWhere: c.deduction === 'already_deducted' ? { kind: 'before' } : { kind: 'separately', accountId: c.accountId ?? null },
    value: c.amount,
    currency: c.currency,
    sign,
  });

  // Money out: what left first.
  if (from && input.kind !== 'income' && input.accountAmount) {
    rows.push({
      key: 'left',
      kind: 'left',
      account: from,
      value: toDecimalString(dec(input.accountAmount).plus(sum(fromHere.map((c) => c.amount)))),
      currency: from.currency,
      bold: true,
    });
  }
  rows.push({ key: 'base', kind: 'base', value: input.amount, currency: input.currency });
  for (const c of fromHere) rows.push(chargeRow(c, '+'));

  // Charges taken before it arrived: those in the base currency before the conversion, the rest after.
  const beforeConv = input.conversion ? before.filter((c) => c.currency !== input.conversion!.to) : before;
  const afterConv = input.conversion ? before.filter((c) => c.currency === input.conversion!.to) : [];
  for (const c of beforeConv) rows.push(chargeRow(c, '-'));
  if (input.conversion && input.kind !== 'expense') rows.push({ key: 'conv', kind: 'converted', conversion: input.conversion });
  for (const c of afterConv) rows.push(chargeRow(c, '-'));

  // Money in: what landed, then charges taken there, then what the account went up by.
  if (to && input.kind !== 'expense' && input.arrives) {
    rows.push({ key: 'arrives', kind: 'arrives', account: to, value: input.arrives, currency: to.currency, bold: toHere.length === 0 });
    for (const c of toHere) rows.push(chargeRow(c, '-'));
    if (toHere.length) {
      rows.push({
        key: 'wentUp',
        kind: 'wentUp',
        account: to,
        value: toDecimalString(dec(input.arrives).minus(sum(toHere.map((c) => c.amount)))),
        currency: to.currency,
        bold: true,
      });
    }
  }
  for (const c of elsewhere) rows.push(chargeRow(c, null));
  return rows;
}
