import { strFromU8, unzipSync } from 'fflate';

import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { parseCsv } from '@/lib/csv';
import { createTestDb } from '@/test/db';
import { accountCsvs, buildTaxZip, conversionsCsv, exportedPeriodFor, fiscalYearOf, recordTaxExport, taxSummary, taxTransactionsCsv } from '../tax-export';

async function sample() {
  const db = await createTestDb();
  ensureBaseData(db);
  db.transaction((tx) => buildSampleData(tx));
  return db;
}
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

describe('tax export', () => {
  it('fiscal years', () => {
    expect(fiscalYearOf('2026-09-30', 7)).toEqual({ from: '2026-07-01', to: '2027-06-30' });
    expect(fiscalYearOf('2026-03-01', 7)).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    expect(fiscalYearOf('2026-09-30', 1)).toEqual(YEAR);
  });

  it('totals per currency, never combined, all ledgers', async () => {
    const db = await sample();
    const byCur = Object.fromEntries(taxSummary(db, YEAR).map((r) => [r.currency, r]));
    expect(byCur.USD).toEqual({ currency: 'USD', grossIncome: '1650', expenses: '1013', taxWithheld: '0' });
    expect(byCur.EUR.grossIncome).toBe('340');
    expect(byCur.AED.expenses).toBe('310');
    expect(byCur.SAR).toBeUndefined();
  });

  it('all-transactions.csv leaves transfers out; conversions.csv has both amounts', async () => {
    const db = await sample();
    const rows = parseCsv(taxTransactionsCsv(db, YEAR, null)).slice(1);
    expect(rows.every((r) => r[2] === 'income' || r[2] === 'expense')).toBe(true);
    expect(rows.every((r) => r[3] === 'cleared')).toBe(true);
    const conv = parseCsv(conversionsCsv(db, YEAR));
    expect(conv.slice(1)).toEqual([['2026-09-15', 'Payoneer USD', '200', 'USD', 'Alfalah PKR', '55000', 'PKR', '275', '278.10', '']]);
  });

  it('one CSV per account, ending at the account’s balance', async () => {
    const db = await sample();
    const files = accountCsvs(db, YEAR);
    const alfalah = files.find((f) => f.name === 'Alfalah PKR.csv')!;
    const last = parseCsv(alfalah.csv).at(-1)!;
    expect(last[5]).toBe('104231.75');
    const zip = unzipSync(buildTaxZip(db, YEAR, null, new Uint8Array([1, 2, 3])));
    expect(Object.keys(zip).sort()).toEqual(expect.arrayContaining(['summary.pdf', 'all-transactions.csv', 'conversions.csv', 'accounts/Payoneer USD.csv']));
    expect(strFromU8(zip['conversions.csv'])).toContain('55000');
  });

  it('remembers exported years for the editing warning', async () => {
    const db = await sample();
    expect(exportedPeriodFor(db, '2026-10-05')).toBeNull();
    recordTaxExport(db, YEAR, '2026-11-08T00:00:00Z');
    expect(exportedPeriodFor(db, '2026-10-05')).toBe('October');
    expect(exportedPeriodFor(db, '2027-01-05')).toBeNull();
  });
});
