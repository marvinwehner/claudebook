import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/dal";

/**
 * The auth gate for every signed-in route.
 *
 * App Hosting supports neither Next 16's Proxy (`proxy.ts`) nor Cache
 * Components, so gating happens here — which is where Next's own docs want it
 * anyway, since Server Functions bypass proxy matchers regardless. Every route
 * handler repeats the check independently; this layout only protects rendering.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return <>{children}</>;
}
