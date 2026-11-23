/**
 * Design tokens, mirrored from the web app (apps/web/src/index.css) so both
 * clients share one look: the /color.png retro palette on an industrial layout.
 * Keep the two in sync when either changes.
 */

/** Source palette (color.png). */
export const palette = {
  harvestGold: "#d8c774",
  avocadoGreen: "#73956f",
  burntOrange: "#cc5500",
  rustRed: "#a14f3a",
  chocolateBrown: "#6b4f34",
  harvestOrange: "#e57200",
  mustardYellow: "#e3a83c",
  tealBlue: "#4a8c9f",
} as const;

export interface Colors {
  background: string;
  foreground: string;
  card: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
}

export const light: Colors = {
  background: "#f3eee3",
  foreground: "#2e2117",
  card: "#fbf8f1",
  primary: palette.harvestOrange,
  primaryForeground: "#24180f",
  secondary: "#ece2bd",
  secondaryForeground: "#3d2c1d",
  muted: "#e9e1d0",
  mutedForeground: palette.chocolateBrown,
  accent: "#e8dcc0",
  destructive: palette.rustRed,
  border: "#dbcfb6",
  input: "#d3c5a8",
  ring: palette.harvestOrange,
};

export const dark: Colors = {
  background: "#1d1510",
  foreground: "#f3eee3",
  card: "#271d16",
  primary: palette.harvestOrange,
  primaryForeground: "#1d1510",
  secondary: "#3a2c20",
  secondaryForeground: "#f3eee3",
  muted: "#31251c",
  mutedForeground: "#c2b096",
  accent: "#3a2c20",
  destructive: "#c9654b",
  border: "rgba(243, 238, 227, 0.10)",
  input: "rgba(243, 238, 227, 0.15)",
  ring: palette.harvestOrange,
};

/** Font family names as registered by useFonts in theme/ThemeProvider. */
export const fonts = {
  sans: "Inter_400Regular",
  sansMedium: "Inter_500Medium",
  sansSemiBold: "Inter_600SemiBold",
  sansBold: "Inter_700Bold",
  mono: "JetBrainsMono_500Medium",
  monoSemiBold: "JetBrainsMono_600SemiBold",
} as const;

/** Web uses --radius: 0.25rem (4px); cards are radius + 4. */
export const radius = { sm: 2, md: 4, lg: 8 } as const;

/** The four retro stripe bands, top to bottom. */
export const stripe = [
  palette.harvestOrange,
  palette.mustardYellow,
  palette.rustRed,
  palette.chocolateBrown,
] as const;
