import { getSessionUser } from "@/lib/auth/dal";

import { SignOutButton } from "./sign-out-button";

// Placeholder shell — phase 6 replaces this with the notebook grid.
export default async function Home() {
  const user = await getSessionUser();

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Claudebook</h1>
        <p className="text-muted mt-2 text-sm">Signed in as {user?.email}</p>
        <SignOutButton />
      </div>
    </main>
  );
}
