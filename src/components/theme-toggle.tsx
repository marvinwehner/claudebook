"use client";

import { Moon, Sun } from "@gravity-ui/icons";
import { Button } from "@heroui/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * The mount guard is not optional: the server cannot know the visitor's theme,
 * so rendering the resolved icon before hydration guarantees a mismatch.
 *
 * `useSyncExternalStore` with a server snapshot of `false` is the guard without
 * a setState-in-effect — it is false during SSR and the first render, true
 * after hydration, and it never schedules a cascading render.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      aria-label={mounted ? (isDark ? "Switch to light theme" : "Switch to dark theme") : "Theme"}
      onPress={() => setTheme(isDark ? "light" : "dark")}
    >
      {/* Reserve the space before mount so the nav does not jump. */}
      {mounted ? (
        isDark ? (
          <Sun aria-hidden />
        ) : (
          <Moon aria-hidden />
        )
      ) : (
        <span aria-hidden className="size-4" />
      )}
    </Button>
  );
}
