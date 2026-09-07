"use client";

import { ArrowRightFromSquare, Persons } from "@gravity-ui/icons";
import { Avatar, buttonVariants, Dropdown, useOverlayState } from "@heroui/react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";

import { AllowedUsersDialog } from "@/components/allowed-users-dialog";
import { clientAuth } from "@/lib/firebase/client";

/**
 * The header's account menu.
 *
 * `AllowedUsersDialog` is a SIBLING of the Dropdown, not a child. React Aria's
 * Popover renders null when closed and a menu item's onAction closes the menu,
 * so a dialog nested inside would mount and unmount in the same tick. Nesting it
 * in `Dropdown.Menu` is worse still: that is a collection, which gathers its
 * children rather than rendering them.
 */
export function UserMenu({
  email,
  picture,
  isAdmin,
}: {
  email: string;
  picture?: string;
  /** Rendering only. Every /api/admin/* handler re-checks with requireAdmin(). */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const access = useOverlayState();

  async function handleSignOut() {
    // Server first: it revokes refresh tokens and clears the cookie. Clearing
    // only the client would leave a working cookie behind.
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    await signOut(clientAuth()).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger
          aria-label="Account"
          // Dropdown.Trigger is React Aria's Button, not HeroUI's, so it has no
          // variant props — it wears the shape through buttonVariants instead.
          className={buttonVariants({ isIconOnly: true, size: "sm", variant: "ghost" })}
        >
          <Avatar size="sm">
            <Avatar.Image src={picture} alt="" />
            <Avatar.Fallback>{email.slice(0, 1).toUpperCase()}</Avatar.Fallback>
          </Avatar>
        </Dropdown.Trigger>

        <Dropdown.Popover placement="bottom end">
          {/* Popover children are not a collection — only Dropdown.Menu is — so
              this plain row is fine here and would not be inside the menu. */}
          <p className="text-muted max-w-56 truncate px-3 py-2 text-xs">{email}</p>

          <Dropdown.Menu>
            {isAdmin ? (
              <Dropdown.Item id="access" onAction={access.open}>
                <Persons aria-hidden />
                Allowed users
              </Dropdown.Item>
            ) : null}
            <Dropdown.Item id="sign-out" onAction={handleSignOut}>
              <ArrowRightFromSquare aria-hidden />
              Sign out
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <AllowedUsersDialog isOpen={access.isOpen} onOpenChange={access.setOpen} />
    </>
  );
}
