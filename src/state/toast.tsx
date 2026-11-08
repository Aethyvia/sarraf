import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, radius, useTheme } from '@/theme';

interface Toast {
  message: string;
  action?: { label: string; onPress: () => void };
}

const ToastContext = createContext<(toast: Toast) => void>(() => {});
/** Sets how much bottom chrome (the tab bar and Add bar) the toast should sit above. */
const InsetContext = createContext<(inset: number) => void>(() => {});

/** A short message at the bottom (e.g. "Saved to Upcoming · counts on Oct 1 · View"), with an optional action. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [inset, setInset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      <InsetContext.Provider value={setInset}>
        {children}
        {toast ? <ToastView toast={toast} inset={inset} onDone={() => setToast(null)} /> : null}
      </InsetContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function useSetToastInset() {
  return useContext(InsetContext);
}

function ToastView({ toast, inset, onDone }: { toast: Toast; inset: number; onDone: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fade]);
  return (
    <Animated.View pointerEvents="box-none" style={[styles.wrap, { bottom: inset > 0 ? inset + 12 : 24 + insets.bottom, opacity: fade }]}>
      <View style={[styles.toast, { backgroundColor: colors.tooltip }]} accessibilityLiveRegion="polite">
        <Text style={[styles.text, { color: colors.onTooltip }]}>{toast.message}</Text>
        {toast.action ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              onDone();
              toast.action!.onPress();
            }}
          >
            <Text style={[styles.action, { color: colors.onTooltip }]}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: radius.field, paddingHorizontal: 16, paddingVertical: 12, maxWidth: '100%' },
  text: { fontFamily: fonts.sansSemiBold, fontSize: 13, flexShrink: 1 },
  action: { fontFamily: fonts.sansExtraBold, fontSize: 13, textDecorationLine: 'underline' },
});
