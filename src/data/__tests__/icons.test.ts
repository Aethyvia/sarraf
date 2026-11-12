import { ICON_GROUPS, ICON_SHAPES, PICKABLE_ICONS } from '@/components/icons/shapes';
import { DEFAULT_CATEGORIES } from '../default-categories';

describe('icons', () => {
  it('every pickable icon is drawn, and in exactly one group', () => {
    expect(new Set(PICKABLE_ICONS).size).toBe(PICKABLE_ICONS.length);
    for (const name of PICKABLE_ICONS) expect(ICON_SHAPES[name as keyof typeof ICON_SHAPES]).toBeDefined();
    expect(ICON_GROUPS.length).toBeGreaterThan(5);
  });

  it('default categories only use pickable icons', () => {
    for (const c of DEFAULT_CATEGORIES) {
      expect(PICKABLE_ICONS).toContain(c.icon);
      for (const [, icon] of c.subs ?? []) expect(PICKABLE_ICONS).toContain(icon);
    }
  });
});
