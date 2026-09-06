import "server-only";

import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

/**
 * The durable index of what a notebook's session should have mounted.
 *
 * This is what makes rehydration possible: the Anthropic session can vanish at
 * any time, and this subcollection is the record used to rebuild it. It is also
 * where `anthropicFileId` lives, so that no file id ever has to come from a
 * client — Anthropic's own guidance is never to accept one.
 */
export interface Source {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  mountPath: string;
  anthropicFileId: string;
  /** Null after a rehydration until the new session's resource id is written back. */
  sessionResourceId: string | null;
  status: "ready" | "failed";
  createdAt: string;
}

function subcollection(notebookId: string) {
  return adminDb().collection("notebooks").doc(notebookId).collection("sources");
}

function fromSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): Source {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    mountPath: data.mountPath,
    anthropicFileId: data.anthropicFileId,
    sessionResourceId: data.sessionResourceId ?? null,
    status: data.status ?? "ready",
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : new Date(0).toISOString(),
  };
}

export type CreateSourceInput = Omit<Source, "id" | "createdAt">;

export async function createSource(notebookId: string, input: CreateSourceInput): Promise<Source> {
  const ref = subcollection(notebookId).doc();
  await ref.set({ ...input, createdAt: FieldValue.serverTimestamp() });

  const snapshot = await ref.get();
  return fromSnapshot(snapshot as QueryDocumentSnapshot<DocumentData>);
}

export async function listSources(notebookId: string): Promise<Source[]> {
  const snapshot = await subcollection(notebookId).orderBy("createdAt", "asc").get();
  return snapshot.docs.map(fromSnapshot);
}

export async function getSource(notebookId: string, sourceId: string): Promise<Source | null> {
  const snapshot = await subcollection(notebookId).doc(sourceId).get();
  return snapshot.exists ? fromSnapshot(snapshot as QueryDocumentSnapshot<DocumentData>) : null;
}

export async function deleteSource(notebookId: string, sourceId: string): Promise<void> {
  await subcollection(notebookId).doc(sourceId).delete();
}

/** After a rehydration, point every source at its resource in the new session. */
export async function setSessionResourceIds(
  notebookId: string,
  resourceIds: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(resourceIds);
  if (entries.length === 0) return;

  const batch = adminDb().batch();
  for (const [sourceId, resourceId] of entries) {
    batch.update(subcollection(notebookId).doc(sourceId), {
      sessionResourceId: resourceId,
    });
  }
  await batch.commit();
}
