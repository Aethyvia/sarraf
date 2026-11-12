import { leftoverToYou } from '../splits';


describe('leftover goes to your share (Owner, Nov 12)', () => {
  it('adds what is left to assign to your share', () => {
    expect(leftoverToYou(['30', '40', '15'], 0, '90')).toEqual(['35', '40', '15']);
  });
  it('works for percents, with you anywhere in the list', () => {
    expect(leftoverToYou(['50', '30'], 1, '100')).toEqual(['50', '50']);
  });
  it('leaves an exact split alone and refuses more than the total', () => {
    expect(leftoverToYou(['45', '45'], 0, '90')).toEqual(['45', '45']);
    expect(leftoverToYou(['50', '45'], 0, '90')).toBeNull();
  });
  it('treats empty shares as zero', () => {
    expect(leftoverToYou(['', '20.50'], 0, '90')).toEqual(['69.5', '20.50']);
  });
});
