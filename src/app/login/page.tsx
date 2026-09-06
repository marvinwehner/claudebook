"use client";

import { Button } from "@heroui/react";
import { FirebaseError } from "firebase/app";
import { signInWithPopup, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { clientAuth, googleProvider } from "@/lib/firebase/client";

/** Popup, not redirect: `signInWithRedirect` needs a third-party-cookie iframe. */
function messageForFirebaseError(error: FirebaseError): string | null {
  switch (error.code) {
    // The user shut the window or clicked again. Not worth an error message.
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return null;
    case "auth/popup-blocked":
      return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
    case "auth/unauthorized-domain":
      return "This domain is not in the Firebase Auth authorized-domains list.";
    case "auth/network-request-failed":
      return "Could not reach Google. Check your connection and try again.";
    default:
      return `Sign-in failed (${error.code}).`;
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);

    const auth = clientAuth();
    try {
      const credential = await signInWithPopup(auth, googleProvider());
      const idToken = await credential.user.getIdToken();

      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        // The server refused and deleted the account it just saw. Drop the
        // client-side session too, or the UI claims to be signed in.
        await signOut(auth).catch(() => {});
        setError(body.error ?? "Sign-in was refused.");
        return;
      }

      // Full navigation, not router.push: the gate is a server component and
      // has to re-run with the new cookie.
      router.replace("/");
      router.refresh();
    } catch (cause) {
      if (cause instanceof FirebaseError) {
        setError(messageForFirebaseError(cause));
      } else {
        setError("Sign-in failed unexpectedly.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Claudebook</h1>
        <p className="text-muted mt-2 text-sm">
          A private notebook that reads your sources. Invite only.
        </p>

        <Button className="mt-8 w-full" variant="primary" isPending={busy} onPress={signIn}>
          Continue with Google
        </Button>

        {error ? (
          <p role="alert" className="text-danger mt-4 text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
