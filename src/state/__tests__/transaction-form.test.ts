import { applyKey, arrivedApplies, draftFromForm, focusConversion, formFromDraft, initialForm, setEnterArrived, switchKind, type FormState } from '../transaction-form';

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

describe('money in another currency (option D)', () => {
  const base = () => initialForm({ date: '2026-11-12', ledgerId: 'l', accountId: 'a', kind: 'income' });

  it('types the rate on the keypad, as an expression', () => {
    let f = focusConversion(base(), 'rate');
    expect(f.target).toBe('rate');
    for (const k of ['2', '6', '7', '.', '4'] as const) f = applyKey(f, k, 2);
    expect(f.rateText).toBe('267.4');
    expect(f.rateMode).toBe('rate_known');
  });

  it('tapping what arrived makes it the typed number and the rate worked out', () => {
    let f = { ...base(), rateText: '267' };
    f = focusConversion(f, 'known');
    expect(f).toMatchObject({ rateMode: 'amount_known', target: 'known', knownExpression: '' });
    f = applyKey(f, '9', 2);
    expect(f.knownExpression).toBe('9');
  });

  it('tapping the worked-out rate starts it empty and switches back', () => {
    const f = focusConversion({ ...base(), rateMode: 'amount_known', knownExpression: '141000', rateText: '1' }, 'rate');
    expect(f).toMatchObject({ rateMode: 'rate_known', rateText: '', target: 'rate', knownExpression: '141000' });
  });

  it('tapping the typed one keeps what is typed', () => {
    const f = focusConversion({ ...base(), rateMode: 'rate_known', rateText: '267' }, 'rate');
    expect(f.rateText).toBe('267');
    expect(focusConversion(f, 'amount').target).toBe('amount');
  });

  it('caps a typed rate at 10 decimal places', () => {
    let f = focusConversion({ ...base(), rateText: '0.0035971223' }, 'rate');
    f = applyKey(f, '7', 2);
    expect(f.rateText).toBe('0.0035971223');
  });
});

describe('Before fees | What arrived (owner, Nov 15)', () => {
  const income = (patch: Partial<FormState> = {}): FormState => ({
    ...initialForm({ date: '2026-09-30', ledgerId: null, accountId: 'usd', kind: 'income' }),
    ...patch,
  });

  it('applies to income into an account and to transfers between your accounts only', () => {
    expect(arrivedApplies(income())).toBe(true);
    expect(arrivedApplies({ kind: 'expense', from: { type: 'account', id: 'a' }, to: null })).toBe(false);
    expect(arrivedApplies({ kind: 'transfer', from: { type: 'account', id: 'a' }, to: { type: 'person', id: 'p' } })).toBe(false);
    expect(arrivedApplies({ kind: 'transfer', from: { type: 'account', id: 'a' }, to: { type: 'account', id: 'b' } })).toBe(true);
  });

  it('in one currency, the typed number becomes what arrived', () => {
    const f = setEnterArrived(income({ expression: '980' }), true, false);
    expect(f).toMatchObject({ enterArrived: true, expression: '980' });
    expect(draftFromForm(f, { amount: '980', knownAmount: null, rate: null, mainCurrency: 'USD', converts: false })).toMatchObject({
      enteredAs: 'arrived',
      knownAmount: '980',
      rate: null,
    });
  });

  it('across currencies, the keypad moves to what arrived and the rate is typed', () => {
    const f = setEnterArrived(income({ rateMode: 'amount_known', knownExpression: '272440' }), true, true);
    expect(f).toMatchObject({ enterArrived: true, target: 'known', rateMode: 'rate_known', knownExpression: '272440' });
    expect(focusConversion(f, 'amount')).toBe(f);
    expect(focusConversion(f, 'rate').target).toBe('rate');
    expect(draftFromForm(f, { amount: '0', knownAmount: '272440', rate: '278', mainCurrency: 'USD', converts: true })).toMatchObject({
      enteredAs: 'arrived',
      knownAmount: '272440',
      rate: '278',
    });
    expect(setEnterArrived(f, false, true)).toMatchObject({ enterArrived: false, target: 'amount' });
  });

  it('Edit opens typed as what arrived', () => {
    const f = formFromDraft({ kind: 'income', date: '2026-09-30', status: 'cleared', accountId: 'usd', amount: '1000', currency: 'USD', enteredAs: 'arrived', knownAmount: '980' });
    expect(f).toMatchObject({ enterArrived: true, expression: '980', knownExpression: '980' });
  });
});
