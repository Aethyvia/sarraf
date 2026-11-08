import { ensureBaseData } from '@/db/base-data';
import { buildSampleData } from '@/db/sample';
import { accounts, ledgers, transactions } from '@/db/schema';
import { parseCsv } from '@/lib/csv';
import { createTestDb } from '@/test/db';
import { snapshot } from '../backup-file';
import { CSV_HEADER, importSarrafJson, ImportFileError, sarrafJson, transactionsCsv } from '../export';

async function sample() {
  const db = await createTestDb();
  ensureBaseData(db);
  db.transaction((tx) => buildSampleData(tx));
  return db;
}

describe('export', () => {
  it('CSV: one row per transaction as stored, with names and charges', async () => {
    const db = await sample();
    const rows = parseCsv(transactionsCsv(db));
    expect(rows[0]).toEqual(CSV_HEADER);
    expect(rows.length - 1).toBe(db.select().from(transactions).all().length);
    const transit = rows.find((r) => r[2] === 'transfer' && r[3] === 'in_transit')!;
    expect(transit.slice(5, 7)).toEqual(['Payoneer USD', 'Alfalah PKR']);
    expect(transit[18]).toContain('150 PKR on top');
    const refund = rows.find((r) => r[17] === 'reimbursement')!;
    expect(refund[1]).toBe('2026-09-29');
  });

  it('CSV filters by ledger and range', async () => {
    const db = await sample();
    const business = db.select().from(ledgers).all().find((l) => l.name === 'Business')!;
    const rows = parseCsv(transactionsCsv(db, { ledgerId: business.id, from: '2026-09-10', to: '2026-09-30' })).slice(1);
    expect(rows.map((r) => r[4]).every((l) => l === 'Business')).toBe(true);
    expect(rows.map((r) => r[1]).every((d) => d >= '2026-09-10')).toBe(true);
    expect(rows.map((r) => r[15])).toEqual(["Hosting", "Client workshop trip"]);
  });
});

describe('Sarraf JSON import', () => {
  it('into an empty phone: everything arrives', async () => {
    const from = await sample();
    const to = await createTestDb();
    ensureBaseData(to);
    const r = importSarrafJson(to, sarrafJson(from));
    expect(r.added).toBeGreaterThan(50);
    expect(snapshot(to).transactions).toEqual(snapshot(from).transactions);
  });

  it('adds only rows whose id is missing; never overwrites', async () => {
    const db = await sample();
    const text = sarrafJson(db);
    const acc = db.select().from(accounts).get()!;
    db.update(accounts).set({ name: 'Renamed here' }).run();
    const r = importSarrafJson(db, text);
    expect(r.added).toBe(0);
    expect(r.skipped).toBeGreaterThan(0);
    expect(db.select().from(accounts).all().find((a) => a.id === acc.id)!.name).toBe('Renamed here');
  });

  it('refuses other files and newer versions; broken links change nothing', async () => {
    const db = await sample();
    expect(() => importSarrafJson(db, 'hello')).toThrow(ImportFileError);
    const file = JSON.parse(sarrafJson(db));
    expect(() => importSarrafJson(db, JSON.stringify({ ...file, format: 999 }))).toThrow(/newer Sarraf/);
    const to = await createTestDb();
    ensureBaseData(to);
    const onlyTx = { ...file, data: { transactions: file.data.transactions } };
    expect(() => importSarrafJson(to, JSON.stringify(onlyTx))).toThrow(ImportFileError);
    expect(to.select().from(transactions).all()).toHaveLength(0);
  });
});
