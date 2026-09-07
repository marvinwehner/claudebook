import Link from "next/link";

import { ClaudebookMark } from "@/components/claudebook-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import type { SessionUser } from "@/lib/auth/dal";

/**
 * Hand-rolled: HeroUI v3 removed `Navbar`, and this is a header with three
 * things in it — a component library is not what was missing.
 */
export function AppNav({ user, children }: { user: SessionUser; children?: React.ReactNode }) {
  return (
    <header className="bg-background sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <ClaudebookMark className="size-5" />
        <span>Claudebook</span>
      </Link>

      {/* Slot for page-specific breadcrumbs and controls. */}
      <div className="min-w-0 flex-1">{children}</div>

      <ThemeToggle />
      <UserMenu email={user.email} picture={user.picture} isAdmin={user.isAdmin} />
    </header>
  );
}
