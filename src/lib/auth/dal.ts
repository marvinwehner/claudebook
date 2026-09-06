import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { isAllowedEmail } from "@/lib/auth/allowlist";
import { adminAuth } from "@/lib/firebase/admin";

/**
 * Firebase Hosting and App Hosting only forward a cookie literally named
 * `__session` through the CDN. Renaming it breaks production and nothing else.
 */
export const SESSION_COOKIE = "__session";

/** Five days, matching `createSessionCookie`'s max of 14. */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * The single place a request's identity is established. Returns null rather
 * than throwing so a layout can redirect and a handler can 401 off the same
 * call.
 *
 * `cache()` dedupes this per request: a page and the handlers it triggers
 * verify the cookie once, not once each.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    // checkRevoked: a signed-out or disabled user must stop working
    // immediately, not in five days.
    const claims = await adminAuth().verifySessionCookie(token, true);

    // The allowlist is re-checked on every request, not just at sign-in, so
    // removing an address from ALLOWED_EMAILS takes effect on the next
    // request instead of whenever the cookie happens to expire.
    if (!isAllowedEmail(claims.email)) return null;

    return {
      uid: claims.uid,
      email: claims.email as string,
      name: typeof claims.name === "string" ? claims.name : undefined,
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
    };
  } catch {
    // Expired, revoked, malformed, or signed for another project — all of them
    // mean "not signed in".
    return null;
  }
});

/** For route handlers: throws, and the handler's error mapper turns it into 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
