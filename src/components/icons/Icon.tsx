import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { ICON_SHAPES, type IconElement } from './shapes';

export type IconName = keyof typeof ICON_SHAPES;

const ELEMENTS = { path: Path, circle: Circle, rect: Rect } as const;

/** Older or unknown icon names (e.g. from an import) fall back to a plain circle. */
const ALIASES: Record<string, IconName> = { building: 'bank', plane: 'suitcase' };

export function isIconName(name: string): name is IconName {
  return name in ICON_SHAPES;
}

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 1.9,
}: {
  name: string;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  const key: IconName = isIconName(name) ? name : (ALIASES[name] ?? 'circle');
  const shapes = ICON_SHAPES[key] as IconElement[];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {shapes.map(([tag, props], i) => {
        const El = ELEMENTS[tag];
        return <El key={i} {...props} />;
      })}
    </Svg>
  );
}
