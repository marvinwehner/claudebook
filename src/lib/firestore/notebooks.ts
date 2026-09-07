import "server-only";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import type { NotebookModel } from "@/lib/anthropic/agent";
import { adminDb } from "@/lib/firebase/admin";
import { DEFAULT_NOTEBOOK_ICON } from "@/lib/notebook-icons";
import {
  addUsage,
  EMPTY_NOTEBOOK_USAGE,
  maxUsage,
  notebookUsageFrom,
  rollUp,
  sameUsage,
  type NotebookUsage,
  type UsageTotals,
} from "@/lib/usage";

/**
 * The ownership record for a notebook.
 *
 * Firestore is the index Anthropic cannot be: `GET /v1/sessions` has no
 * metadata filter, and Anthropic files are workspace-scoped rather than
 * user-scoped. So `ownerId` here is the *only* boundary between two users, and
 * every read path below takes it as an argument rather than as an afterthought.
 */
export interface Notebook {
  id: string;
  ownerId: string;
  title: string;
  icon: string;
  model: NotebookModel;
  customInstructions?: string;
  sessionId: string | null;
  agentVersion: number | null;
  sessionStatus: string | null;
  /**
   * Set when a session was rehydrated outside a message request. A lone
   * `system.message` is rejected by the API, so the note waits here until it
   * can ride along with the next user message.
   */
  pendingSeedNote?: string;
  usage: NotebookUsage;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

const COLLECTION = "notebooks";

function iso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function fromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Notebook {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ownerId: data.ownerId,
    title: data.title,
    icon: data.icon ?? DEFAULT_NOTEBOOK_ICON,
    model: data.model,
    customInstructions: data.customInstructions || undefined,
    sessionId: data.sessionId ?? null,
    agentVersion: data.agentVersion ?? null,
    sessionStatus: data.sessionStatus ?? null,
    pendingSeedNote: data.pendingSeedNote || undefined,
    usage: notebookUsageFrom(data.usage),
    createdAt: iso(data.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(data.updatedAt) ?? new Date(0).toISOString(),
    lastMessageAt: iso(data.lastMessageAt),
  };
}

function collection() {
  return adminDb().collection(COLLECTION);
}

export interface CreateNotebookInput {
  ownerId: string;
  title: string;
  icon: string;
  model: NotebookModel;
  customInstructions?: string;
}

export async function createNotebook(input: CreateNotebookInput): Promise<Notebook> {
  const ref = collection().doc();
  await ref.set({
    ownerId: input.ownerId,
    title: input.title,
    icon: input.icon,
    model: input.model,
    ...(input.customInstructions ? { customInstructions: input.customInstructions } : {}),
    sessionId: null,
    agentVersion: null,
    sessionStatus: null,
    usage: EMPTY_NOTEBOOK_USAGE,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessageAt: null,
  });

  const snapshot = await ref.get();
  return fromSnapshot(snapshot as QueryDocumentSnapshot<DocumentData>);
}

/** Null when the notebook is missing *or* owned by somebody else — callers
 *  must not be able to tell those apart. */
export async function getNotebook(id: string, ownerId: string): Promise<Notebook | null> {
  const snapshot = await collection().doc(id).get();
  if (!snapshot.exists) return null;

  const notebook = fromSnapshot(snapshot as QueryDocumentSnapshot<DocumentData>);
  return notebook.ownerId === ownerId ? notebook : null;
}

export async function listNotebooks(ownerId: string): Promise<Notebook[]> {
  // Backed by the (ownerId ASC, updatedAt DESC) composite index.
  const snapshot = await collection()
    .where("ownerId", "==", ownerId)
    .orderBy("updatedAt", "desc")
    .get();

  return snapshot.docs.map(fromSnapshot);
}

export type NotebookPatch = Partial<
  Pick<
    Notebook,
    | "title"
    | "icon"
    | "model"
    | "customInstructions"
    | "sessionId"
    | "agentVersion"
    | "sessionStatus"
  >
> & {
  pendingSeedNote?: string | null;
  touchLastMessage?: boolean;
};

export async function updateNotebook(id: string, patch: NotebookPatch): Promise<void> {
  const { touchLastMessage, pendingSeedNote, ...fields } = patch;

  const update: Record<string, unknown> = {
    ...fields,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (pendingSeedNote !== undefined) {
    // Explicit null clears it — the note has been delivered.
    update.pendingSeedNote = pendingSeedNote === null ? FieldValue.delete() : pendingSeedNote;
  }

  if (touchLastMessage) {
    update.lastMessageAt = FieldValue.serverTimestamp();
  }

  await collection().doc(id).update(update);
}

/**
 * Records the live session's cumulative usage.
 *
 * Written through dotted paths so `usage.retired` is untouchable from here —
 * the roll-up owns that field, and a replace of the whole map would race it.
 * The session-id guard covers the other direction: a snapshot that arrives
 * after the notebook has already moved to a new session would otherwise
 * double-count, since the roll-up has by then banked those same totals.
 *
 * Deliberately does not touch `updatedAt` — that orders the notebook list, and
 * merely opening a notebook writes usage on connect.
 *
 * Returns the notebook lifetime total as of this write, read inside the same
 * transaction; null when the guard rejected it. Computing it here rather than
 * letting the caller add its own `retired` matters, because a relay holds one
 * notebook snapshot for the life of a connection and a rebuild moves `retired`
 * underneath it.
 */
export async function recordSessionUsage(
  id: string,
  sessionId: string,
  totals: UsageTotals,
): Promise<UsageTotals | null> {
  const ref = collection().doc(id);

  return adminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return null;
    if ((snapshot.get("sessionId") ?? null) !== sessionId) return null;

    const usage = notebookUsageFrom(snapshot.get("usage"));

    // Nothing orders the three producers of a snapshot, so an older read can
    // arrive after a newer one. A session's usage only grows, so merging by
    // field makes the loser of that race a no-op rather than a regression —
    // which matters because a roll-up would otherwise bank the lower figure
    // and lose the difference for good.
    const merged = usage.currentSessionId === sessionId ? maxUsage(usage.current, totals) : totals;

    const lifetime = addUsage(usage.retired, merged);

    // A relay re-reads usage on every connect, and it reconnects every four
    // minutes for as long as a tab is open. On an idle notebook that is the
    // same numbers over and over, so do not spend a write on them.
    if (usage.currentSessionId === sessionId && sameUsage(usage.current, merged)) {
      return lifetime;
    }

    transaction.update(ref, {
      "usage.current": merged,
      "usage.currentSessionId": sessionId,
    });
    return lifetime;
  });
}

/**
 * Banks the live session into `retired` and clears `current`, for the one case
 * a session is discarded deliberately rather than found missing: a model
 * change.
 *
 * Transactional and re-reading `usage` for the same reason `claimSessionId` is:
 * a relay may still be writing snapshots for the session being retired. The
 * caller must have already cleared `sessionId`, which is what makes those
 * writes start failing `recordSessionUsage`'s guard.
 */
export async function retireSessionUsage(id: string): Promise<NotebookUsage> {
  const ref = collection().doc(id);

  return adminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return EMPTY_NOTEBOOK_USAGE;

    const usage = rollUp(notebookUsageFrom(snapshot.get("usage")), null);
    transaction.update(ref, { usage });
    return usage;
  });
}

export interface SessionClaim {
  sessionId: string;
  sessionStatus: string | null;
  agentVersion: number | null;
  pendingSeedNote?: string;
}

/**
 * Takes the session fields only if `sessionId` is still `expected`. False means
 * another request got there first, and the caller's session is now unreferenced.
 *
 * A plain read-modify-write loses that race, and losing it costs real money:
 * both writers create a container with its own budget, only one id lands, and
 * `GET /v1/sessions` has no metadata filter, so the other can never be found.
 */
export async function claimSessionId(
  id: string,
  expected: string | null,
  claim: SessionClaim,
): Promise<boolean> {
  const ref = collection().doc(id);

  return adminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    if ((snapshot.get("sessionId") ?? null) !== expected) return false;

    // The outgoing session is already gone — that is why we are rebuilding —
    // so its last persisted snapshot is the most that can ever be known of it.
    // Banking it here, inside the transaction that swaps the session, is what
    // keeps the lifetime figure from resetting.
    const usage = notebookUsageFrom(snapshot.get("usage"));

    const update: Record<string, unknown> = {
      sessionId: claim.sessionId,
      sessionStatus: claim.sessionStatus,
      agentVersion: claim.agentVersion,
      usage: rollUp(usage, claim.sessionId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (claim.pendingSeedNote) update.pendingSeedNote = claim.pendingSeedNote;

    transaction.update(ref, update);
    return true;
  });
}

export async function deleteNotebook(id: string): Promise<void> {
  // Deletes the document and its `sources` subcollection.
  await adminDb().recursiveDelete(collection().doc(id));
}
