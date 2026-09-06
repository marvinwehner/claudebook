"use client";

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
      <span aria-hidden className="text-base leading-none">
        {mounted ? (isDark ? "☀" : "☾") : " "}
      </span>
    </Button>
  );
}
