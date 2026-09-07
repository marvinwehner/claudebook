import "server-only";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { normalizeEmail } from "@/lib/auth/access";
import { adminDb } from "@/lib/firebase/admin";

/**
 * The addresses an admin has invited. Admins themselves are not in here — they
 * come from `ADMIN_EMAILS` and cannot be revoked from the UI.
 *
 * The normalised email IS the document id. That makes the hot path — the
 * membership check the DAL runs on every request — a point read rather than a
 * query, and makes duplicates impossible by construction. Every function here
 * re-normalises its own input rather than trusting the caller, because a write
 * path and a read path that disagree on the key is a silent lockout with no
 * error anywhere.
 */
export interface AllowedUser {
  email: string;
  invitedByEmail: string;
  invitedByUid: string;
  createdAt: string;
}

const COLLECTION = "allowedUsers";

/** Guards against a query returning the whole world if this ever grows. */
const LIST_LIMIT = 500;

function collection() {
  return adminDb().collection(COLLECTION);
}

function fromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): AllowedUser {
  const data = snapshot.data();
  return {
    email: data.email ?? snapshot.id,
    invitedByEmail: data.invitedByEmail ?? "",
    invitedByUid: data.invitedByUid ?? "",
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : new Date(0).toISOString(),
  };
}

export async function isEmailAllowed(email: string | null | undefined): Promise<boolean> {
  const id = normalizeEmail(email);
  if (!id) return false;

  const snapshot = await collection().doc(id).get();
  return snapshot.exists;
}

export async function listAllowedUsers(): Promise<AllowedUser[]> {
  // No `where`, so the automatic single-field index covers this and
  // firestore.indexes.json stays empty of it.
  const snapshot = await collection().orderBy("createdAt", "desc").limit(LIST_LIMIT).get();
  return snapshot.docs.map(fromSnapshot);
}

export interface CreateAllowedUserInput {
  email: string;
  invitedByEmail: string;
  invitedByUid: string;
}

/**
 * Throws gRPC ALREADY_EXISTS (`code === 6`) if the address is already invited.
 * `create()` rather than `set()` on purpose: with the email as the id, a set()
 * would silently overwrite the invitedBy/createdAt provenance this record
 * exists to show.
 */
export async function addAllowedUser(input: CreateAllowedUserInput): Promise<AllowedUser> {
  const id = normalizeEmail(input.email);
  if (!id) throw new Error(`Refusing to write an unusable document id for ${input.email}`);

  const ref = collection().doc(id);
  await ref.create({
    email: id,
    invitedByEmail: input.invitedByEmail,
    invitedByUid: input.invitedByUid,
    createdAt: FieldValue.serverTimestamp(),
  });

  // serverTimestamp() resolves server-side, so the written value is only
  // readable after a round trip.
  const snapshot = await ref.get();
  return fromSnapshot(snapshot as QueryDocumentSnapshot<DocumentData>);
}

/** False if there was nothing to remove, so the caller can 404. */
export async function removeAllowedUser(email: string | null | undefined): Promise<boolean> {
  const id = normalizeEmail(email);
  if (!id) return false;

  const ref = collection().doc(id);
  if (!(await ref.get()).exists) return false;

  await ref.delete();
  return true;
}
