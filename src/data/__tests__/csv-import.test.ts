import { eq } from 'drizzle-orm';

import { transactions } from '@/db/schema';
import { parseCsv } from '@/lib/csv';
import { setup } from '@/test/factories';
import { accountBalance } from '../balances';
import { commitImport, dateFormatsFor, guessMapping, openingShift, parseAmount, parseDate, previewImport, savedMapping } from '../csv-import';

describe('parsing', () => {
  it('amounts in the usual shapes', () => {
    expect(parseAmount('-15.00')).toBe('-15');
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('(42.00)')).toBe('-42');
    expect(parseAmount('$1,250.00')).toBe('1250');
    expect(parseAmount('15,5')).toBe('15.5');
    expect(parseAmount('500.00 DR')).toBe('-500');
    expect(parseAmount('1,04,231.75')).toBe('104231.75');
    expect(parseAmount('abc')).toBeNull();
  });

  it('dates, and which formats fit a column', () => {
    expect(parseDate('2026-09-28', 'ymd')).toBe('2026-09-28');
    expect(parseDate('28/09/2026', 'dmy')).toBe('2026-09-28');
    expect(parseDate('09/28/2026', 'mdy')).toBe('2026-09-28');
    expect(parseDate('Sep 28, 2026', 'text')).toBe('2026-09-28');
    expect(parseDate('28-Sep-2026', 'text')).toBe('2026-09-28');
    expect(parseDate('31/02/2026', 'dmy')).toBeNull();
    expect(dateFormatsFor(['28/09/2026', '01/10/2026'])).toEqual(['dmy']);
    expect(dateFormatsFor(['01/10/2026', '02/10/2026'])).toEqual(['dmy', 'mdy']);
  });

  it('guesses columns from headers', () => {
    expect(guessMapping(['Txn Date', 'Amount', 'Memo'])).toEqual(['date', 'amount', 'notes']);
    expect(guessMapping(['Date', 'Description', 'Debit', 'Credit', 'Balance'])).toEqual(['date', 'notes', 'debit', 'credit', 'ignore']);
  });
});

const FILE = `Txn Date,Amount,Memo
"Sep 28, 2026",-15.00,ADOBE *CREATIVE CL
"Sep 27, 2026",-42.00,AMAZON.COM
"Sep 24, 2026",-10.00,GOOGLE *WORKSPACE
"Aug 20, 2026",300.00,Retainer
"Aug 05, 2026",-20.00,ADOBE *CREATIVE CL
bad,-1,x`;

async function world() {
  const s = await setup();
  const usd = s.account('Payoneer USD', 'USD');
  s.tx({ kind: 'opening_balance', accountId: usd, amount: '1000', accountAmount: '1000', date: '2026-09-01', ledgerId: s.personal });
  const software = s.category('Software & Subscriptions');
  const office = s.category('Office & Utilities');
  s.tx({ kind: 'expense', accountId: usd, amount: '20', accountAmount: '20', date: '2026-09-02', categoryId: software, notes: 'Adobe Creative Cloud', ledgerId: s.personal });
  s.tx({ kind: 'expense', accountId: usd, amount: '10', accountAmount: '10', date: '2026-09-24', categoryId: office, notes: 'Google Workspace', ledgerId: s.personal });
  const [header, ...rows] = parseCsv(FILE);
  const mapping = { columns: guessMapping(header), dateFormat: 'text' as const };
  return { ...s, usd, software, office, header, rows, mapping };
}

describe('CSV import', () => {
  it('previews: categories from past entries, duplicates, bad rows', async () => {
    const w = await world();
    const p = previewImport(w.db, { accountId: w.usd, rows: w.rows, mapping: w.mapping });
    expect(p[0]).toMatchObject({ date: '2026-09-28', amount: '-15', categoryId: w.software, categoryFrom: 'history', duplicateOf: null });
    expect(p[1]).toMatchObject({ categoryId: null });
    expect(p[2].duplicateOf).not.toBeNull();
    expect(p[3]).toMatchObject({ amount: '300', categoryId: null });
    expect(p[5].error).toBe('date');
  });

  it('older rows move the opening balance so today’s balance stays as typed', async () => {
    const w = await world();
    const before = accountBalance(w.db, w.usd, '2026-09-30');
    const p = previewImport(w.db, { accountId: w.usd, rows: w.rows, mapping: w.mapping });
    const keep = p.filter((r) => !r.duplicateOf);
    expect(openingShift(w.db, w.usd, keep)).toMatchObject({ from: { date: '2026-09-01', amount: '1000' }, to: { date: '2026-08-04', amount: '720' } });
    const r = commitImport(w.db, { accountId: w.usd, rows: keep, header: w.header, mapping: w.mapping, presetName: 'Payoneer statement', today: '2026-09-30' });
    expect(r.added).toBe(4);
    // The two September rows are new spending; the August history doesn't change today's balance.
    expect(accountBalance(w.db, w.usd, '2026-09-30')).toBe(String(Number(before) - 15 - 42));
    expect(w.db.select().from(transactions).where(eq(transactions.importBatchId, r.batchId)).all()).toHaveLength(4);
  });

  it('remembers the mapping for files with the same headers', async () => {
    const w = await world();
    expect(savedMapping(w.db, w.header)).toBeNull();
    commitImport(w.db, { accountId: w.usd, rows: [], header: w.header, mapping: w.mapping, presetName: 'Payoneer statement' });
    expect(savedMapping(w.db, [' txn date', 'AMOUNT', 'memo'])).toEqual({ name: 'Payoneer statement', mapping: w.mapping });
  });
});
