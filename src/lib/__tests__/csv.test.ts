import { parseCsv, toCsv } from '../csv';

describe('csv', () => {
  it('parses quotes, commas, newlines and blank lines', () => {
    expect(parseCsv('a,b,c\r\n1,"two, 2","say ""hi"""\n\n3,"multi\nline",\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'two, 2', 'say "hi"'],
      ['3', 'multi\nline', ''],
    ]);
  });
  it('reads semicolon files', () => {
    expect(parseCsv('Date;Amount;Memo\n28.09.2026;-15,00;ADOBE')).toEqual([
      ['Date', 'Amount', 'Memo'],
      ['28.09.2026', '-15,00', 'ADOBE'],
    ]);
  });
  it('round-trips what it writes', () => {
    const text = toCsv(['x', 'y'], [['a,b', 'c"d'], [null, 'e\nf']]);
    expect(parseCsv(text)).toEqual([
      ['x', 'y'],
      ['a,b', 'c"d'],
      ['', 'e\nf'],
    ]);
  });
});
