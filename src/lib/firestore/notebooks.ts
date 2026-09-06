import "server-only";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import type { NotebookModel } from "@/lib/anthropic/agent";
import { adminDb } from "@/lib/firebase/admin";

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
    icon: data.icon ?? "📓",
    model: data.model,
    customInstructions: data.customInstructions || undefined,
    sessionId: data.sessionId ?? null,
    agentVersion: data.agentVersion ?? null,
    sessionStatus: data.sessionStatus ?? null,
    pendingSeedNote: data.pendingSeedNote || undefined,
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

export async function deleteNotebook(id: string): Promise<void> {
  // Deletes the document and its `sources` subcollection.
  await adminDb().recursiveDelete(collection().doc(id));
}
