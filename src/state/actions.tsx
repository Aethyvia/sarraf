import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LimitSheet } from '@/components/sheets/LimitSheet';
import { DataError } from '@/data/errors';
import { LimitReachedError, type LimitedKind } from '@/data/limits';
import { AmountError } from '@/data/amounts';
import { errorMessage, strings } from '@/i18n/strings';
import { fonts, radius, useTheme } from '@/theme';

/**
 * Runs a data-layer write and turns refusals into UI: the free-limit sheet for
 * LimitReachedError, a short message for any other DataError.
 * Render `ui` once in the screen.
 */
export function useAction(options: { itemName?: string | null; onArchiveForLimit?: () => void } = {}) {
  const [limit, setLimit] = useState<LimitedKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(<T,>(write: () => T): T | undefined => {
    setMessage(null);
    try {
      return write();
    } catch (e) {
      if (e instanceof LimitReachedError) setLimit(e.kind);
      else if (e instanceof AmountError) setMessage(strings.add.errors[e.code]);
      else setMessage(errorMessage(e instanceof DataError ? e.code : undefined));
      if (!(e instanceof DataError) && !(e instanceof AmountError)) console.error(e);
      return undefined;
    }
  }, []);

  /** The same, for writes that first do async work (e.g. storing attachment files). */
  const runAsync = useCallback(async <T,>(write: () => Promise<T>): Promise<T | undefined> => {
    setMessage(null);
    try {
      return await write();
    } catch (e) {
      if (e instanceof LimitReachedError) setLimit(e.kind);
      else if (e instanceof AmountError) setMessage(strings.add.errors[e.code]);
      else setMessage(errorMessage(e instanceof DataError ? e.code : undefined));
      if (!(e instanceof DataError) && !(e instanceof AmountError)) console.error(e);
      return undefined;
    }
  }, []);

  const ui: ReactNode = (
    <>
      {message ? <ErrorBanner message={message} /> : null}
      <LimitSheet
        kind={limit}
        itemName={options.itemName}
        onClose={() => setLimit(null)}
        onArchive={
          options.onArchiveForLimit
            ? () => {
                setLimit(null);
                options.onArchiveForLimit?.();
              }
            : undefined
        }
      />
    </>
  );

  return { run, runAsync, ui, error: message, clearError: () => setMessage(null) };
}

function ErrorBanner({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.expense + '1A' }]} accessibilityRole="alert">
      <Text style={[styles.bannerText, { color: colors.expense }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: radius.field, paddingHorizontal: 14, paddingVertical: 10 },
  bannerText: { fontFamily: fonts.sansSemiBold, fontSize: 13 },
});
