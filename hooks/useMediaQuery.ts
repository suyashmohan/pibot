"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe media query: always `false` on the first render (matching SSR),
 * then syncs to the real value after mount. Reading `matchMedia` in the
 * initializer would hydrate-mismatch on mobile.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
