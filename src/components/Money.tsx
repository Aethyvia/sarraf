import * as Clipboard from 'expo-clipboard';
import { useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { strings } from '@/i18n/strings';
import { formatAmount, formatExact, type DecimalString } from '@/lib/money';
import { useSettings } from '@/state/settings';
import { fonts, useTheme } from '@/theme';

export interface MoneyProps {
  value: DecimalString;
  currency: string;
  /** 'auto': "−" on negatives. 'always': "+" on positives too. 'never': no sign. */
  sign?: 'auto' | 'always' | 'never';
  /**
   * Allow M / B / T when Settings → compact numbers is on. Pass false where an
   * amount must always be exact: typing, transaction details, rate maths.
   */
  allowCompact?: boolean;
  showCurrency?: boolean;
  style?: StyleProp<TextStyle>;
}

/**
 * The one component for showing an amount. Every amount on screen goes through
 * it, so number format, compact numbers and Hide amounts behave the same everywhere.
 */
export function Money({
  value,
  currency,
  sign = 'auto',
  allowCompact = true,
  showCurrency = true,
  style,
}: MoneyProps) {
  const settings = useSettings();
  const { colors } = useTheme();
  const [revealed, setRevealed] = useState(false);
  const [bubble, setBubble] = useState<Anchor | null>(null);
  const textRef = useRef<Text>(null);

  const options = { numberFormat: settings.numberFormat, sign, showCurrency };
  const { text, isCompact } = formatAmount(value, currency, {
    ...options,
    compact: allowCompact && settings.compactNumbers,
  });
  const textStyle = [styles.amount, { color: colors.ink }, style];

  if (settings.hideAmounts && !revealed) {
    return (
      <Text
        style={textStyle}
        onPress={() => setRevealed(true)}
        accessibilityRole="button"
        accessibilityLabel={strings.money.hiddenLabel}
      >
        {strings.money.hidden}
      </Text>
    );
  }

  if (!isCompact) {
    return <Text style={textStyle}>{text}</Text>;
  }

  const exact = formatExact(value, currency, options);
  const openBubble = () => {
    textRef.current?.measureInWindow((x, y, width) => setBubble({ x, y, width }));
  };

  return (
    <>
      <Pressable
        onPress={openBubble}
        onLongPress={openBubble}
        accessibilityRole="button"
        accessibilityLabel={strings.money.shortLabel(exact)}
        style={styles.compactWrap}
      >
        <Text ref={textRef} style={textStyle}>
          {text}
        </Text>
        <DashedUnderline color={colors.border} />
      </Pressable>
      {bubble && <ExactBubble exact={exact} at={bubble} onClose={() => setBubble(null)} />}
    </>
  );
}

/** A faint dashed line under a shortened amount (Android can't dash a single border side). */
function DashedUnderline({ color }: { color: string }) {
  const [width, setWidth] = useState(0);
  const DASH = 3;
  const GAP = 2;
  const n = Math.floor((width + GAP) / (DASH + GAP));
  return (
    <View style={styles.underline} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={{ width: DASH, height: 1, backgroundColor: color, marginEnd: GAP }} />
      ))}
    </View>
  );
}

/** Where the tapped amount sits on screen, in window coordinates. */
interface Anchor {
  x: number;
  y: number;
  width: number;
}

const EDGE = 8;

/**
 * The dark "EXACT" bubble with a copy button, shown above a tapped short amount.
 * It is measured first (invisible), then placed: over the amount's start edge,
 * shifted left as needed so it never runs off the screen.
 */
function ExactBubble({ exact, at, onClose }: { exact: string; at: Anchor; onClose: () => void }) {
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const [bubbleWidth, setBubbleWidth] = useState<number | null>(null);

  const left =
    bubbleWidth === null
      ? 0
      : Math.max(EDGE, Math.min(at.x, at.x + at.width - bubbleWidth, screenWidth - bubbleWidth - EDGE));

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <View
          onLayout={(e) => setBubbleWidth(e.nativeEvent.layout.width)}
          style={[
            styles.bubble,
            {
              backgroundColor: colors.tooltip,
              top: Math.max(EDGE, at.y - 52),
              left,
              maxWidth: screenWidth - 2 * EDGE,
              opacity: bubbleWidth === null ? 0 : 1,
            },
          ]}
        >
          <Text style={[styles.bubbleLabel, { color: colors.inkMuted }]}>{strings.money.exact}</Text>
          <Text style={[styles.bubbleAmount, { color: colors.onTooltip }]} selectable numberOfLines={1} adjustsFontSizeToFit>
            {exact}
          </Text>
          <Pressable
            hitSlop={10}
            onPress={async () => {
              await Clipboard.setStringAsync(exact);
              setCopied(true);
            }}
            accessibilityRole="button"
          >
            <Text style={[styles.bubbleCopy, { color: colors.onTooltip }]}>
              {copied ? strings.common.copied : strings.common.copy}
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  amount: {
    fontFamily: fonts.mono,
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  compactWrap: {
    alignSelf: 'flex-start',
  },
  underline: {
    flexDirection: 'row',
    overflow: 'hidden',
    marginTop: 1,
  },
  bubble: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  bubbleLabel: {
    fontFamily: fonts.sansBold,
    fontSize: 10.5,
  },
  bubbleAmount: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontVariant: ['tabular-nums', 'lining-nums'],
  },
  bubbleCopy: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
