import "server-only";

import { downloadArtifact, listArtifacts, type Artifact } from "@/lib/anthropic/files";
import { liveSession, type Notebook } from "@/lib/notebooks/notebook-service";
import { NotFoundError } from "@/lib/notebooks/errors";

export type { Artifact };

/**
 * Artifacts are read live from the session rather than mirrored into Firestore.
 * That means one less thing to keep in sync, and it means a rehydrated session
 * legitimately shows an empty list — the old container's outputs are gone.
 */
export async function listNotebookArtifacts(notebook: Notebook): Promise<Artifact[]> {
  if (!notebook.sessionId) return [];
  const { session } = await liveSession(notebook);
  return listArtifacts(session.id);
}

/**
 * Downloads are proxied through us so no Anthropic credential reaches the
 * browser — and, more importantly, so the file id is checked against this
 * notebook's own session first. Anthropic files are workspace-scoped; a raw
 * client-supplied id would read another user's artifact.
 */
export async function downloadNotebookArtifact(
  notebook: Notebook,
  fileId: string,
): Promise<{ body: ReadableStream<Uint8Array> | null; filename: string; mimeType: string }> {
  const artifacts = await listNotebookArtifacts(notebook);
  const artifact = artifacts.find((candidate) => candidate.fileId === fileId);
  if (!artifact) throw new NotFoundError("Artifact not found.");

  const response = await downloadArtifact(fileId);
  return { body: response.body, filename: artifact.filename, mimeType: artifact.mimeType };
}
