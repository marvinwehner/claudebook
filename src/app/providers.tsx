"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * HeroUI v3 needs no provider of its own — it is CSS-first. This exists only
 * for next-themes, which must be a client component.
 *
 * `attribute="class"` because HeroUI's dark variables key off `.dark`.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}
