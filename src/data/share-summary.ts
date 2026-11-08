import { strings } from '@/i18n/strings';
import { formatShortDate } from '@/lib/format-date';
import { dec, formatExact, type NumberFormat } from '@/lib/money';

export interface ShareLine {
  title: string;
  detail: string;
  counts: boolean;
  entry: { amount: string; currency: string };
}

/** The plain-text summary sent to a person (made on the phone; nothing is stored or uploaded). */
export function shareSummaryText(
  name: string,
  balances: { currency: string; balance: string }[],
  lines: ShareLine[],
  options: { date: string; numberFormat: NumberFormat; includeLast: boolean; hidden?: boolean },
): string {
  const s = strings.shareSummary;
  const money = (v: string, c: string, sign: 'auto' | 'always' = 'auto') =>
    options.hidden ? strings.money.hidden : formatExact(v, c, { numberFormat: options.numberFormat, sign });
  const out = [s.hi(name, formatShortDate(options.date))];
  for (const b of balances) {
    const v = dec(b.balance);
    out.push(v.isZero() ? s.even : v.isPositive() ? s.owesMe(money(b.balance, b.currency)) : s.iOwe(money(v.abs().toFixed(), b.currency)));
  }
  if (options.includeLast) {
    out.push('');
    for (const l of lines.filter((x) => x.counts).slice(0, 5)) out.push(`${l.detail.split(' · ')[0]} · ${l.title} · ${money(l.entry.amount, l.entry.currency, 'always')}`);
  }
  return out.join('\n');
}

