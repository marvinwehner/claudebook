import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Hand-rolled: HeroUI v3 removed `Navbar`, and this is a header with three
 * things in it — a component library is not what was missing.
 */
export function AppNav({ email, children }: { email: string; children?: React.ReactNode }) {
  return (
    <header className="border-border bg-surface sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <span aria-hidden>📓</span>
        <span>Claudebook</span>
      </Link>

      {/* Slot for page-specific breadcrumbs and controls. */}
      <div className="min-w-0 flex-1">{children}</div>

      <span className="text-muted hidden text-xs sm:inline">{email}</span>
      <ThemeToggle />
      <SignOutButton />
    </header>
  );
}
