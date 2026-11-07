import { formatShortDate } from '../format-date';

describe('formatShortDate', () => {
  const now = new Date(2026, 8, 30);
  it('leaves out the year for this year', () => expect(formatShortDate('2026-08-03', now)).toBe('Aug 3'));
  it('adds the year otherwise', () => expect(formatShortDate('2025-12-31', now)).toBe('Dec 31, 2025'));
});
