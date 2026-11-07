import { addDays, monthRange, pinToday, today } from '../dates';

describe('dates', () => {
  afterEach(() => pinToday(null));
  it('pins today for the sample data, without touching explicit dates', () => {
    pinToday('2026-09-30');
    expect(today()).toBe('2026-09-30');
    expect(today(new Date(2026, 0, 2))).toBe('2026-01-02');
  });
  it('works out month ranges and adds days across months', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
