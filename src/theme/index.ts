import { useColorScheme } from 'react-native';

import { useSettings } from '@/state/settings';
import { dark, light, swatches, type Palette, type SwatchKey } from './tokens';

export * from './tokens';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: Palette;
  swatch: (key: string) => { fg: string; bg: string };
}

/** The active theme: Settings → Theme, or the phone's setting when that is "system". */
export function useTheme(): Theme {
  const { theme } = useSettings();
  const system = useColorScheme();
  const scheme = theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : theme;
  const set = swatches[scheme];
  return {
    scheme,
    colors: scheme === 'dark' ? dark : light,
    swatch: (key) => set[key as SwatchKey] ?? set.neutral,
  };
}
