import "server-only";

import { adminEmails, normalizeEmail } from "@/lib/auth/access";
import type { SessionUser } from "@/lib/auth/dal";
import * as allowedUsers from "@/lib/firestore/allowed-users";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/notebooks/errors";

/**
 * Managing who may sign in.
 *
 * This lives under `auth/` rather than `notebooks/` because it touches
 * Firestore only — and because `dal.ts` has to import the repository for its
 * per-request check anyway, so this directory owns that dependency either way.
 *
 * It takes the acting user as an argument and never imports the DAL at runtime,
 * the same shape as `createNotebook(ownerId, input)`. Callers do the
 * `requireAdmin()`.
 */

export type AllowedUser = allowedUsers.AllowedUser;

export interface Access {
  /** From ADMIN_EMAILS. Shown so the dialog is not a half-truth, never removable. */
  admins: string[];
  invited: AllowedUser[];
}

export async function listAccess(): Promise<Access> {
  return { admins: adminEmails(), invited: await allowedUsers.listAllowedUsers() };
}

/** Firestore's ALREADY_EXISTS. `create()` throws this when the doc id is taken. */
function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 6;
}

export async function invite(actor: SessionUser, rawEmail: string): Promise<AllowedUser> {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    throw new ValidationError("That does not look like an email address.");
  }

  // An admin is already allowed by ADMIN_EMAILS, and the row would claim to be
  // revocable when removing it changes nothing.
  if (adminEmails().includes(email)) {
    throw new ValidationError("That address is already an admin.");
  }

  try {
    return await allowedUsers.addAllowedUser({
      email,
      invitedByEmail: actor.email,
      invitedByUid: actor.uid,
    });
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new ConflictError("That address is already invited.");
    }
    throw error;
  }
}

export async function revoke(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  // An admin address is never in the collection, so it lands here too.
  if (!email || !(await allowedUsers.removeAllowedUser(email))) {
    throw new NotFoundError("That address is not on the allowlist.");
  }
}
