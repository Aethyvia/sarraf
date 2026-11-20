/**
 * Design tokens from the canvas "Style guide" and "Style guide (dark)" boards.
 * Dark keeps the same structure: surfaces and ink invert, the accent brightens,
 * and money-direction red/green stay legible.
 */
export interface Palette {
  bg: string;
  surface: string;
  /** Bottom sheets and the tab bar. */
  sheet: string;
  /** Filled inputs, icon buttons, keypad keys, segmented track. */
  filled: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  line: string;
  border: string;
  /** Light outlines: tags, outlined cards and the Add bar's top edge. */
  outline: string;
  accent: string;
  /** Text and icons placed on the accent colour. */
  onAccent: string;
  accentSoft: string;
  income: string;
  /** The balance trend line on Home's default-currency card (owner, Nov 20: green in light, mint in dark). */
  trend: string;
  /** Savings F: the soft panel behind a growing plant, and the warm one behind a seed or harvest. */
  plantPanel: string;
  plantPanelWarm: string;
  expense: string;
  /** Soft background behind a destructive icon (bulk Delete). */
  expenseSoft: string;
  /** "Dips into savings" warning. */
  warning: string;
  warningSoft: string;
  /** Background of a card that's over (an over budget). */
  warningTint: string;
  /** Outline of warning boxes and the OVER tag. */
  warningLine: string;
  /** Bar of an over budget. */
  overBar: string;
  scrim: string;
  /** The dark "EXACT" bubble behind a tapped short amount. */
  tooltip: string;
  onTooltip: string;
}

export const light: Palette = {
  bg: '#FAF7F2',
  surface: '#FFFFFF',
  sheet: '#FFFCF7',
  filled: '#F1ECE3',
  ink: '#211D17',
  inkSecondary: '#6B6355',
  inkMuted: '#948C7C',
  line: '#EFE9DC',
  border: '#D9D2C2',
  outline: '#E8E1D3',
  accent: '#1F5A52',
  onAccent: '#FFFFFF',
  accentSoft: '#DCEAE6',
  income: '#1E7A4C',
  trend: '#1F5A52',
  plantPanel: '#EEF5F2',
  plantPanelWarm: '#F6F1E8',
  expense: '#B3261E',
  expenseSoft: '#FDF1F0',
  warning: '#8A5A00',
  warningSoft: '#F6EDD6',
  warningTint: '#FFFDF6',
  warningLine: '#E8D9B0',
  overBar: '#C66510',
  scrim: 'rgba(33,29,23,0.45)',
  tooltip: '#211D17',
  onTooltip: '#FFFFFF',
};

export const dark: Palette = {
  bg: '#17140F',
  surface: '#221E18',
  sheet: '#221E18',
  filled: '#2C2620',
  ink: '#F5F1E8',
  inkSecondary: '#B8AF9E',
  inkMuted: '#8A8172',
  line: '#332D25',
  border: '#4A4236',
  outline: '#3A332A',
  accent: '#2F7A6D',
  onAccent: '#0E1512',
  accentSoft: '#1D3B35',
  income: '#4CAF7A',
  trend: '#5CC7AE',
  plantPanel: '#1C2925',
  plantPanelWarm: '#2A241C',
  expense: '#E0655C',
  expenseSoft: '#3A201D',
  warning: '#D9A73D',
  warningSoft: '#3A2F1A',
  warningTint: '#2A2418',
  warningLine: '#5A4A26',
  overBar: '#E0913D',
  scrim: 'rgba(0,0,0,0.55)',
  tooltip: '#F5F1E8',
  onTooltip: '#17140F',
};

/**
 * Icon colours for accounts, categories and ledgers, stored by key so they
 * follow the theme. Each has a foreground and a soft background.
 */
export const SWATCH_KEYS = ['teal', 'orange', 'gold', 'blue', 'cyan', 'purple', 'pink', 'neutral'] as const;
export type SwatchKey = (typeof SWATCH_KEYS)[number];

export const swatches: Record<'light' | 'dark', Record<SwatchKey, { fg: string; bg: string }>> = {
  light: {
    teal: { fg: '#1F5A52', bg: '#DCEAE6' },
    orange: { fg: '#C66510', bg: '#F7E9DA' },
    gold: { fg: '#B37D00', bg: '#F6EDD6' },
    blue: { fg: '#2A78D6', bg: '#E1EDFA' },
    cyan: { fg: '#1388AE', bg: '#DFF1F7' },
    purple: { fg: '#4A3AA7', bg: '#E9E5F7' },
    pink: { fg: '#C5537F', bg: '#F8E3EC' },
    neutral: { fg: '#6B6355', bg: '#F1ECE3' },
  },
  dark: {
    teal: { fg: '#4CAF9A', bg: '#1D3B35' },
    orange: { fg: '#E0913D', bg: '#3A2A1A' },
    gold: { fg: '#D9A73D', bg: '#3A2F1A' },
    blue: { fg: '#5B9FE8', bg: '#1C2A3B' },
    cyan: { fg: '#4DBBD9', bg: '#183139' },
    purple: { fg: '#8B7BD9', bg: '#29243F' },
    pink: { fg: '#E07EA3', bg: '#3B2230' },
    neutral: { fg: '#B8AF9E', bg: '#2C2620' },
  },
};

export const fonts = {
  /** Fraunces: screen titles and sheet titles. */
  serif: 'Fraunces_600SemiBold',
  serifBold: 'Fraunces_700Bold',
  /** Manrope: everything else. */
  sans: 'Manrope_400Regular',
  sansMedium: 'Manrope_500Medium',
  sansSemiBold: 'Manrope_600SemiBold',
  sansBold: 'Manrope_700Bold',
  sansExtraBold: 'Manrope_800ExtraBold',
  /** IBM Plex Mono with tabular digits: every amount. */
  mono: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const;

export const radius = { field: 12, card: 16, sheet: 24, pill: 999 } as const;

/** Every button, full-width, inline or icon-only, is this tall (44dp tap target). */
export const BUTTON_HEIGHT = 44;
