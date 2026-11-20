import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { stageRank, type PlantStage } from '@/data/plant';
import { strings } from '@/i18n/strings';
import { useTheme } from '@/theme';

/** Shared colours of the drawings (canvas "F · The six plant stages"). */
const C = { stem: '#2F7A6F', leafLight: '#5CC7AE', leafDark: '#1F5A52', leafMid: '#3FA58F', wood: '#8A6A3B', pot: '#C88A4A', rim: '#B5763A', fruit: '#E0A458', fruitLight: '#F0BC78' };

function Pot() {
  return (
    <>
      <Path d="M22 112 h66 l-8 30 h-50 z" fill={C.pot} />
      <Rect x={18} y={104} width={74} height={12} rx={4} fill={C.rim} />
    </>
  );
}

function Crown() {
  return (
    <>
      <Path d="M55 104 V66 M55 80 L42 68 M55 74 L68 62" stroke={C.wood} strokeWidth={6} strokeLinecap="round" fill="none" />
      <Circle cx={55} cy={44} r={25} fill={C.leafDark} />
      <Circle cx={33} cy={58} r={17} fill={C.leafMid} />
      <Circle cx={77} cy={56} r={17} fill={C.leafMid} />
      <Circle cx={55} cy={64} r={15} fill={C.leafLight} />
    </>
  );
}

function Drawing({ stage }: { stage: PlantStage }) {
  switch (stage) {
    case 'seed':
      return (
        <>
          <Ellipse cx={55} cy={102} rx={7} ry={5} fill={C.wood} />
          <Pot />
        </>
      );
    case 'sprout':
      return (
        <>
          <Path d="M55 104 V82" stroke={C.stem} strokeWidth={4} strokeLinecap="round" />
          <Path d="M55 92 C46 91 40 85 40 78 C48 78 54 83 55 92 Z" fill={C.leafLight} />
          <Path d="M55 87 C64 86 70 80 70 73 C62 73 56 78 55 87 Z" fill={C.leafDark} />
          <Pot />
        </>
      );
    case 'plant':
      return (
        <>
          <Path d="M55 104 C55 90 55 74 55 56" stroke={C.stem} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Path d="M55 96 C44 95 37 88 37 80 C47 80 54 86 55 96 Z" fill={C.leafLight} />
          <Path d="M55 84 C66 83 73 76 73 68 C63 68 56 74 55 84 Z" fill={C.leafDark} />
          <Path d="M55 72 C45 71 39 65 39 58 C48 58 54 63 55 72 Z" fill={C.leafMid} />
          <Path d="M55 60 C61 58 65 53 65 47 C59 48 55 53 55 60 Z" fill={C.leafLight} />
          <Pot />
        </>
      );
    case 'bush':
      return (
        <>
          <Path d="M55 104 V84" stroke={C.stem} strokeWidth={5} strokeLinecap="round" />
          <Circle cx={38} cy={80} r={17} fill={C.leafMid} />
          <Circle cx={72} cy={80} r={17} fill={C.leafMid} />
          <Circle cx={55} cy={62} r={21} fill={C.leafDark} />
          <Circle cx={55} cy={86} r={16} fill={C.leafLight} />
          <Circle cx={46} cy={58} r={5} fill={C.leafLight} opacity={0.8} />
          <Pot />
        </>
      );
    case 'tree':
      return (
        <>
          <Crown />
          <Pot />
        </>
      );
    case 'fruit':
      return (
        <>
          <Crown />
          {[
            [42, 40],
            [66, 34],
            [78, 58],
            [32, 62],
            [58, 58],
          ].map(([x, y]) => (
            <Circle key={`${x}-${y}`} cx={x} cy={y} r={5.5} fill={C.fruit} />
          ))}
          <Path d="M92 26 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill={C.fruit} />
          <Pot />
        </>
      );
    case 'harvest':
      return (
        <>
          <Path d="M20 94 h70 l-8 46 h-54 z" fill={C.pot} />
          <Path d="M30 94 C30 66 80 66 80 94" stroke={C.rim} strokeWidth={5} fill="none" />
          <Circle cx={40} cy={90} r={9} fill={C.fruit} />
          <Circle cx={58} cy={86} r={9} fill={C.fruit} />
          <Circle cx={74} cy={91} r={8} fill={C.fruit} />
          <Circle cx={49} cy={80} r={7} fill={C.fruitLight} />
        </>
      );
  }
}

/** Reduce motion (Android's "Remove animations"): the plant just changes, no grow animation. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/**
 * A goal's plant on its panel (Savings F, owner Nov 20). When it reaches a new
 * stage while on screen, it grows in with a short spring — unless Reduce motion is on.
 */
export function Plant({ stage, width, height, style }: { stage: PlantStage; width: number; height: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const [grow] = useState(() => new Animated.Value(1));
  const last = useRef(stage);
  useEffect(() => {
    const grew = stageRank(stage) > stageRank(last.current);
    last.current = stage;
    if (!grew || reduce) return;
    grow.setValue(0.6);
    Animated.spring(grow, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }).start();
  }, [stage, reduce, grow]);
  const warm = stage === 'seed' || stage === 'harvest';
  // The drawing keeps its proportions (110 × 130) and sits on the bottom of the panel.
  const drawH = height - 8;
  const drawW = Math.min(width, (drawH * 110) / 130);
  return (
    <View style={[{ width, height, borderRadius: 20, backgroundColor: warm ? colors.plantPanelWarm : colors.plantPanel, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' }, style]}>
      <Animated.View
        style={{ transform: [{ scale: grow }], transformOrigin: 'bottom' }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={strings.plant.stages[stage]}
      >
        <Svg width={drawW} height={drawH} viewBox={stage === 'harvest' ? '0 26 110 130' : '0 16 110 130'}>
          <Drawing stage={stage} />
        </Svg>
      </Animated.View>
    </View>
  );
}
