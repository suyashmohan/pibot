"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BUILT_IN_THEMES,
  DEFAULT_THEME_ID,
  applyTheme,
  listThemes,
  nextThemeId,
  readStoredTheme,
  writeStoredTheme,
  type ThemeDefinition,
} from "@/lib/themes";

export interface ThemeContextValue {
  /** Active theme id (a `ThemeDefinition.id`). */
  theme: string;
  themes: readonly ThemeDefinition[];
  setTheme: (id: string) => void;
  /** Cycle through `themes` (one-click toggle). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Safe outside-provider default so isolated component tests still render. */
const FALLBACK: ThemeContextValue = {
  theme: DEFAULT_THEME_ID,
  themes: BUILT_IN_THEMES,
  setTheme: () => {},
  toggleTheme: () => {},
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<string>(DEFAULT_THEME_ID);
  const themeRef = useRef(theme);

  // SSR/first client render use the default theme (hydration-safe). The
  // persisted theme is applied after mount; the inline boot script already
  // painted it via `data-theme`, so this reconciles state, not visuals.
  useEffect(() => {
    const stored = readStoredTheme();
    themeRef.current = stored;
    setThemeState(stored);
    applyTheme(stored);
  }, []);

  const setTheme = useCallback((id: string) => {
    themeRef.current = id;
    setThemeState(id);
    writeStoredTheme(id);
    applyTheme(id);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(nextThemeId(themeRef.current));
  }, [setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themes: listThemes(), setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK;
}
