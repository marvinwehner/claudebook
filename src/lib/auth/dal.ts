import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { type DecodedIdToken } from "firebase-admin/auth";

import { isAdminEmail } from "@/lib/auth/access";
import { adminAuth } from "@/lib/firebase/admin";
import { isEmailAllowed } from "@/lib/firestore/allowed-users";

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
  /**
   * From `ADMIN_EMAILS`, not from a custom claim. Safe to pass to a client
   * component — it drives rendering only. Authorisation is `requireAdmin()` in
   * the route handler, every time.
   */
  isAdmin: boolean;
}

export class UnauthorizedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Signed in, but not allowed to do this. Admin endpoints only — see the note in
 * `notebooks/errors.ts` about why a notebook path returns 404 instead.
 */
export class ForbiddenError extends Error {
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
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

  let claims: DecodedIdToken;
  try {
    // checkRevoked: a signed-out or disabled user must stop working
    // immediately, not in five days.
    claims = await adminAuth().verifySessionCookie(token, true);
  } catch {
    // Expired, revoked, malformed, or signed for another project — all of them
    // mean "not signed in".
    return null;
  }

  if (typeof claims.email !== "string") return null;

  const identity = {
    uid: claims.uid,
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : undefined,
    picture: typeof claims.picture === "string" ? claims.picture : undefined,
  };

  // Deliberately OUTSIDE the try above. That catch turns everything into "not
  // signed in", which is right for a bad cookie and very wrong for a Firestore
  // outage: it would bounce the user to /login, where sign-in hits the same
  // failure, and tell them they are not on the allowlist. Out here an infra
  // error propagates to the error boundary and says so.
  //
  // Admins short-circuit before the read, so an admin never pays for it and a
  // Firestore outage cannot lock out the person who would fix it.
  if (isAdminEmail(identity.email)) return { ...identity, isAdmin: true };

  // Access is re-checked on every request, not just at sign-in, so revoking
  // someone takes effect on their next request rather than whenever their
  // cookie happens to expire. One point read, deduped per request by cache().
  //
  // The exception is an open SSE stream: it authenticates once at connect and
  // runs until the relay self-closes, so a revoked user can keep receiving that
  // one turn for up to SELF_CLOSE_MS before the reconnect denies them.
  if (await isEmailAllowed(identity.email)) return { ...identity, isAdmin: false };

  return null;
});

/** For route handlers: throws, and the handler's error mapper turns it into 401. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** For admin route handlers. Never use this on a notebook path — see errors.ts. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ForbiddenError("Admin access required.");
  return user;
}
