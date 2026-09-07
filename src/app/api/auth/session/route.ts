import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminEmail } from "@/lib/auth/access";
import { SESSION_COOKIE, SESSION_MAX_AGE_MS } from "@/lib/auth/dal";
import { adminAuth } from "@/lib/firebase/admin";
import { isEmailAllowed } from "@/lib/firestore/allowed-users";

const bodySchema = z.object({ idToken: z.string().min(1) });

/**
 * An ID token stays valid for an hour and is persisted client-side, while the
 * cookie it mints lasts five days. `createSessionCookie` does not check
 * recency, so we do.
 */
const MAX_AUTH_AGE_SECONDS = 5 * 60;

/**
 * Same-origin check. The session cookie is SameSite=Lax, which already blocks
 * cross-site POSTs, but this endpoint mints the cookie so it gets a second
 * lock: a request with no Origin, or an Origin whose host disagrees with the
 * Host we were reached on, is rejected.
 */
async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return false;

  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function POST(request: Request) {
  if (!(await isSameOrigin())) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { idToken }." }, { status: 400 });
  }

  let claims;
  try {
    claims = await adminAuth().verifyIdToken(parsed.data.idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid or expired sign-in token." }, { status: 401 });
  }

  if (Date.now() / 1000 - claims.auth_time > MAX_AUTH_AGE_SECONDS) {
    return NextResponse.json(
      { error: "This sign-in is too old. Please sign in again." },
      { status: 401 },
    );
  }

  // Google is the only configured provider; anything else means someone found
  // another way into the Identity Platform tenant.
  const provider = claims.firebase?.sign_in_provider;
  const authentic = provider === "google.com" && claims.email_verified === true;

  // Separate from the refusal below, and separate from the 403, because these
  // are different things that must not read the same to the person signing in.
  // An admin short-circuits the read, so a Firestore outage still lets the
  // person who would fix it in.
  let allowed = false;
  if (authentic) {
    try {
      allowed = isAdminEmail(claims.email) || (await isEmailAllowed(claims.email));
    } catch (error) {
      console.error("Allowlist lookup failed during sign-in:", error);
      return NextResponse.json(
        { error: "Could not verify access right now. Please try again." },
        { status: 503 },
      );
    }
  }

  if (!authentic || !allowed) {
    // The refused account is left in place deliberately. Refusing to mint a
    // cookie is the control — the DAL re-checks access on every request, so an
    // account that is not allowed can do nothing — and deleting the uid would
    // orphan the notebooks, sources and Anthropic files keyed to it.
    return NextResponse.json(
      { error: "This Google account is not on the Claudebook allowlist." },
      { status: 403 },
    );
  }

  const sessionCookie = await adminAuth().createSessionCookie(parsed.data.idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  (await cookies()).set(SESSION_COOKIE, sessionCookie, {
    ...cookieOptions(),
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  return NextResponse.json({ uid: claims.uid, email: claims.email });
}

export async function DELETE() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    // Revoke refresh tokens so every other session for this user dies too —
    // verifySessionCookie(_, true) in the DAL picks that up on the next request.
    await adminAuth()
      .verifySessionCookie(token, false)
      .then((claims) => adminAuth().revokeRefreshTokens(claims.sub))
      .catch(() => {
        /* already invalid; clearing the cookie is still the right outcome */
      });
  }

  store.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  return NextResponse.json({ ok: true });
}
