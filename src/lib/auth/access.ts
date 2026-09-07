import { z } from "zod";

import { serverEnv } from "@/lib/config/env";

/**
 * Who may sign in, in two parts.
 *
 * Admins come from `ADMIN_EMAILS` and are the bootstrap: they survive an empty
 * database and cannot be locked out by a bad write. Everyone else is invited by
 * an admin into the `allowedUsers` collection at runtime.
 *
 * Nothing here touches Firestore — this file stays pure so it can be unit
 * tested under `environment: node` with no emulator, which is the only kind of
 * test this repo has.
 */

/** Splits `a@b.com, c@d.com` into a normalised list. Blanks are dropped. */
export function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const emailSchema = z.email();

/** RFC 5321 caps a path at 256 and an address at 254. Firestore allows 1500. */
const MAX_EMAIL_LENGTH = 254;

/**
 * The single gate for anything that becomes an `allowedUsers` document id.
 * Returns null rather than throwing, so every caller has to decide what an
 * unusable address means for it.
 *
 * Zod 4's email pattern is stricter than the RFC and does most of the work: it
 * is ASCII-only, so `é` cannot arrive as NFC in one write and NFD in another
 * and land in two different documents; and it rejects quoted local parts, a
 * leading dot and any `..`, which is what would otherwise let `"a/b"@x.test`
 * through as an illegal document path. The two rules it does not cover are the
 * length bound and Firestore's reserved `__…__` ids.
 *
 * Deliberately NOT canonicalised: `+` aliases and Gmail's optional dots. That
 * is a security property, not tidiness — folding `victim+x@gmail.com` into
 * `victim@gmail.com` would let an admin grant access to an address they never
 * typed. Leaving them distinct fails closed and is merely surprising.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const normalised = raw.trim().toLowerCase();
  if (normalised.length > MAX_EMAIL_LENGTH) return null;
  if (normalised.startsWith("__")) return null;
  if (!emailSchema.safeParse(normalised).success) return null;

  return normalised;
}

/**
 * Fails closed in every direction: an unusable address and an empty admin list
 * both return false. `ADMIN_EMAILS` unset means "no admins", not "everyone".
 */
export function isAdmin(email: string | null | undefined, admins: string[]): boolean {
  const normalised = normalizeEmail(email);
  if (!normalised) return false;
  return admins.includes(normalised);
}

export function adminEmails(): string[] {
  return parseList(serverEnv().ADMIN_EMAILS);
}

/**
 * The env-reading wrapper. Tests drive `isAdmin` directly instead, because
 * `serverEnv()` memoises the first `process.env` it sees and a test cannot
 * vary the list through it.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  return isAdmin(email, adminEmails());
}
