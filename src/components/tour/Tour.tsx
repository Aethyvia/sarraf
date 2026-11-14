import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { markTourSeen, tourSeen } from '@/data/tours';
import { db } from '@/db/client';
import { strings } from '@/i18n/strings';
import { isLockedNow } from '@/state/lock-state';
import { fonts } from '@/theme';

/** The tour showing now, if any: only one at a time. */
let activeTour: string | null = null;

/** Every TourTarget on screen, by id, so a tour can find and measure it. */
const targets = new Map<string, View>();

/** Lets the next tour show (this one finished or was put away). */
function releaseTour(id: string): void {
  if (activeTour === id) activeTour = null;
}

/** Marks a part of a screen a tour can point at. */
export function TourTarget({ id, children, style }: { id: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) targets.set(id, node);
    return () => {
      if (targets.get(id) === node) targets.delete(id);
    };
  }, [id]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

type Rect = { x: number; y: number; w: number; h: number };

const measure = (v: View) => new Promise<Rect | null>((resolve) => v.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x, y, w, h } : null)));

// The tip is dark in both themes, as on the FieldTips board.
const TIP = { bg: '#211D17', title: '#FFFFFF', body: '#C9C1B0', muted: '#8A8172', accent: '#2F7A6D', on: '#7ED0BC', dot: '#4A4236', dim: 'rgba(20,16,10,0.55)' };

/**
 * A first-visit tour (FieldTips board; owner Nov 12: "a step-by-step
 * tutorial"): the screen dims except the part being explained, with a tip
 * under (or over) it — Skip tour, dots, Next. Shown once per screen; steps
 * whose part isn't on screen are left out.
 */
export function Tour({ id, steps, delay = 600, enabled = true }: { id: string; steps: readonly TourStep[]; delay?: number; enabled?: boolean }) {
  const s = strings.tour;
  const win = useWindowDimensions();
  const [shown, setShown] = useState<{ step: TourStep; rect: Rect }[] | null>(null);
  const [i, setI] = useState(0);
  // Only the screen in front shows its tour (Home stays mounted under Accounts).
  const focused = useIsFocused();

  useEffect(() => {
    if (!enabled || !focused || tourSeen(db, id)) return;
    let t: ReturnType<typeof setTimeout>;
    const tryShow = async () => {
      // Never over the lock screen or another sheet's moment: wait until Sarraf is unlocked.
      if (isLockedNow() || (activeTour && activeTour !== id)) {
        t = setTimeout(tryShow, 800);
        return;
      }
      const found: { step: TourStep; rect: Rect }[] = [];
      for (const step of steps) {
        const v = targets.get(step.target);
        const rect = v ? await measure(v) : null;
        if (rect && rect.y < win.height - 40) found.push({ step, rect });
      }
      if (found.length && !activeTour) {
        activeTour = id;
        setI(0);
        setShown(found);
      }
    };
    t = setTimeout(tryShow, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled, focused]);

  // Leaving the screen mid-tour: put it away (it shows again next visit). Done while rendering, not in an effect.
  if (!focused && shown) {
    releaseTour(id);
    setShown(null);
  }

  if (!shown || !focused) return null;
  const finish = () => {
    if (activeTour === id) activeTour = null;
    markTourSeen(db, id);
    setShown(null);
  };
  const { step, rect } = shown[i];
  const pad = 6;
  const hole = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
  const below = hole.y + hole.h + 200 < win.height;
  const last = i === shown.length - 1;

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={finish}>
      <View style={StyleSheet.absoluteFill}>
        {/* Four dim panes around the part being explained. */}
        <View style={[styles.dim, { top: 0, left: 0, right: 0, height: Math.max(0, hole.y) }]} />
        <View style={[styles.dim, { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 }]} />
        <View style={[styles.dim, { top: hole.y, left: 0, width: Math.max(0, hole.x), height: hole.h }]} />
        <View style={[styles.dim, { top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h }]} />
        <View pointerEvents="none" style={[styles.ring, { top: hole.y, left: hole.x, width: hole.w, height: hole.h }]} />
        <View style={[styles.tip, below ? { top: hole.y + hole.h + 10 } : { bottom: win.height - hole.y + 10 }]}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={styles.bulb}>
              <Icon name="bulb" size={13} color="#F5F1E8" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{step.title}</Text>
              <Text style={styles.body}>{step.body}</Text>
            </View>
          </View>
          <View style={styles.footer}>
            <Pressable onPress={finish} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>{last ? '' : s.skip}</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {shown.length > 1 && shown.map((_, k) => (
                  <View key={k} style={[styles.dot, k === i && styles.dotOn]} />
                ))}
              </View>
              <Pressable onPress={() => (last ? finish() : setI(i + 1))} style={styles.next} accessibilityRole="button">
                <Text style={styles.nextText}>{last ? s.done : s.next}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: TIP.dim },
  ring: { position: 'absolute', borderRadius: 14, borderWidth: 3, borderColor: 'rgba(126,208,188,0.9)' },
  tip: { position: 'absolute', left: 16, right: 16, backgroundColor: TIP.bg, borderRadius: 14, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, elevation: 8 },
  bulb: { width: 26, height: 26, borderRadius: 999, backgroundColor: TIP.accent, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  title: { fontFamily: fonts.sansBold, fontSize: 13.5, color: TIP.title, lineHeight: 19 },
  body: { fontFamily: fonts.sans, fontSize: 12.5, color: TIP.body, lineHeight: 18, marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  skip: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: TIP.muted },
  dot: { width: 5, height: 5, borderRadius: 999, backgroundColor: TIP.dot },
  dotOn: { width: 12, borderRadius: 3, backgroundColor: TIP.on },
  next: { backgroundColor: TIP.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  nextText: { fontFamily: fonts.sansBold, fontSize: 12, color: '#F5F1E8' },
});
