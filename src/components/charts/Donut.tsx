import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

export interface DonutSlice {
  key: string;
  value: number;
  color: string;
}

/** A ring split by value. Tapping a slice selects it; the others fade (Analytics, Decided Nov 7). */
export function Donut({
  slices,
  size = 168,
  thickness = 26,
  selected,
  gapColor,
  onSelect,
  children,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  selected: string | null;
  gapColor: string;
  onSelect: (key: string) => void;
  children?: React.ReactNode;
}) {
  const r = size / 2;
  const arcs = arcPaths(slices, r, r - thickness);
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G>
          {arcs.map((a) => (
            <Path
              key={a.key}
              d={a.d}
              fill={a.color}
              stroke={gapColor}
              strokeWidth={2}
              opacity={selected && selected !== a.key ? 0.25 : 1}
              onPress={() => onSelect(a.key)}
            />
          ))}
        </G>
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', top: thickness, left: thickness, right: thickness, bottom: thickness, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}

/** SVG paths for each slice of a ring, clockwise from the top. */
function arcPaths(slices: DonutSlice[], r: number, inner: number): (DonutSlice & { d: string })[] {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const point = (rad: number, radius: number) => [r + radius * Math.cos(rad), r + radius * Math.sin(rad)];
  const out: (DonutSlice & { d: string })[] = [];
  let angle = -Math.PI / 2;
  for (const x of slices) {
    if (x.value <= 0 || total <= 0) continue;
    const sweep = (x.value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + Math.min(sweep, Math.PI * 2 - 0.0001);
    angle += sweep;
    const large = end - start > Math.PI ? 1 : 0;
    const [x1, y1] = point(start, r);
    const [x2, y2] = point(end, r);
    const [x3, y3] = point(end, inner);
    const [x4, y4] = point(start, inner);
    out.push({ ...x, d: `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 ${large} 0 ${x4},${y4} Z` });
  }
  return out;
}
