"use client";

import { Button } from "@heroui/react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { clientAuth } from "@/lib/firebase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    // Server first: it revokes refresh tokens and clears the cookie. Clearing
    // only the client would leave a working cookie behind.
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    await signOut(clientAuth()).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button className="mt-6" variant="tertiary" isPending={busy} onPress={handleSignOut}>
      Sign out
    </Button>
  );
}
