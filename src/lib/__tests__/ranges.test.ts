import { hasFiscalYear, rangeFor, rangeKeys, thisFiscalYearRange } from '../ranges';

describe('This year and This fiscal year (owner, Nov 20)', () => {
  it('offers both when the fiscal year starts after January', () => {
    expect(rangeKeys(7)).toEqual(['month', 'last', 'three', 'year', 'fiscal']);
    expect(rangeFor('year', '2026-09-30', 7)).toEqual({ from: '2026-01-01', to: '2026-09-30' });
    expect(rangeFor('fiscal', '2026-09-30', 7)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('a fiscal year that started last calendar year', () => {
    expect(thisFiscalYearRange('2026-03-15', 7)).toEqual({ from: '2025-07-01', to: '2026-03-15' });
    expect(thisFiscalYearRange('2026-07-01', 7)).toEqual({ from: '2026-07-01', to: '2026-07-01' });
  });

  it('shows only This year when the fiscal year is Jan – Dec', () => {
    expect(hasFiscalYear(1)).toBe(false);
    expect(rangeKeys(1)).toEqual(['month', 'last', 'three', 'year']);
    expect(thisFiscalYearRange('2026-09-30', 1)).toEqual({ from: '2026-01-01', to: '2026-09-30' });
  });

  it('keeps the other presets', () => {
    expect(rangeFor('month', '2026-09-30', 7)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(rangeFor('last', '2026-01-10', 7)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(rangeFor('three', '2026-02-10', 7)).toEqual({ from: '2025-12-01', to: '2026-02-10' });
  });
});
