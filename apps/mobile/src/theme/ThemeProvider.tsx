import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import { JetBrainsMono_500Medium, JetBrainsMono_600SemiBold } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import * as SecureStore from "expo-secure-store";
import { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import { type Colors, dark, light } from "./tokens.js";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "sonic.theme";

interface ThemeValue {
  colors: Colors;
  scheme: "light" | "dark";
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Light / Dark / System, like the web app's toggle. "System" follows the
 * phone's appearance (needs `userInterfaceStyle: "automatic"` in app.json).
 * The choice is persisted; fonts load here so children render with them.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>("system");
  const [prefLoaded, setPrefLoaded] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
  });

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((v) => {
        if (v === "light" || v === "dark" || v === "system") setPref(v);
      })
      .catch(() => {}) // non-fatal: fall back to system
      .finally(() => setPrefLoaded(true));
  }, []);

  const setPreference = (p: ThemePreference) => {
    setPref(p);
    SecureStore.setItemAsync(STORAGE_KEY, p).catch(() => {});
  };

  const scheme = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;

  // Render nothing until fonts + preference are ready, to avoid a flash of the
  // wrong font/theme. A font failure shouldn't block the app: fall back to system fonts.
  if (!prefLoaded || (!fontsLoaded && !fontError)) return null;

  return (
    <ThemeContext.Provider
      value={{ colors: scheme === "dark" ? dark : light, scheme, preference, setPreference }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
