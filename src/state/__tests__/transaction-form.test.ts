import { applyKey, draftFromForm, initialForm, switchKind } from '../transaction-form';

const base = () => initialForm({ date: '2026-09-28', ledgerId: 'personal', accountId: 'alfalah' });

describe('switching kind', () => {
  it('carries over only ledger, charges, notes and attachments, across any number of switches', () => {
    const filled = {
      ...base(),
      expression: '1563.50',
      categoryId: 'groceries',
      referencePersonId: 'john',
      status: 'pending' as const,
      reimbursable: true,
      ledgerId: 'business',
      notes: 'monthly',
      attachments: { picked: [{ uri: 'file://r.jpg', name: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }], removeIds: [] },
      charges: [{ type: 'bank_charge' as const, amount: '130', currency: 'PKR', deduction: 'charged_separately' as const, accountId: 'alfalah' }],
    };
    const defaults = { date: '2026-09-30', accountId: 'payoneer' };
    const savings = switchKind(filled, 'savings', defaults);
    const income = switchKind(savings, 'income', defaults);
    expect(income).toMatchObject({
      kind: 'income',
      ledgerId: 'business',
      notes: 'monthly',
      attachments: { picked: [{ uri: 'file://r.jpg', name: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 1 }], removeIds: [] },
      charges: filled.charges,
      expression: '',
      categoryId: null,
      referencePersonId: null,
      status: 'cleared',
      reimbursable: false,
      from: { type: 'account', id: 'payoneer' },
    });
  });

  it('does nothing when the kind is the same', () => {
    const s = base();
    expect(switchKind(s, 'expense', { date: 'x', accountId: null })).toBe(s);
  });
});

describe('keypad target', () => {
  it('types into the main amount or the known amount', () => {
    let s = applyKey(base(), '1', 2);
    s = applyKey({ ...s, target: 'known' }, '9', 2);
    expect([s.expression, s.knownExpression]).toEqual(['1', '9']);
  });
});

describe('draft', () => {
  it('maps sides: a person in From on an expense is "Paid from → Person"', () => {
    const d = draftFromForm({ ...base(), from: { type: 'person', id: 'john' } }, { amount: '20', knownAmount: null, rate: null, mainCurrency: 'PKR' });
    expect(d).toMatchObject({ kind: 'expense', accountId: null, fromPersonId: 'john', currency: 'PKR' });
  });

  it('keeps the rate or the known amount by mode, and drops reimbursable fields off expenses', () => {
    const t = { ...base(), kind: 'transfer' as const, to: { type: 'account' as const, id: 'pkr' }, reimbursable: true, rateMode: 'amount_known' as const };
    expect(draftFromForm(t, { amount: '49.46', knownAmount: '13725', rate: '277.5', mainCurrency: 'USD' })).toMatchObject({
      toAccountId: 'pkr',
      rate: null,
      knownAmount: '13725',
      reimbursable: false,
      categoryId: null,
    });
  });
});
