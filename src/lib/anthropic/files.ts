import "server-only";

import { toFile } from "@anthropic-ai/sdk";

import { mountPathFor } from "@/lib/anthropic/agent";
import { anthropic } from "@/lib/anthropic/client";

/**
 * Files: sources in, artifacts out.
 *
 * Two things about this API that shape everything here:
 *
 * 1. Files are **workspace**-scoped, not user-scoped, and Anthropic's own
 *    guidance is "never accept file_id values from end users". Ownership is
 *    ours to enforce in Firestore, server-side, on every request — nothing in
 *    this module checks it, so nothing in this module may be reached with a
 *    client-supplied id.
 * 2. Uploaded files come back `downloadable: false`. Only what the agent writes
 *    to /mnt/session/outputs is retrievable, which is why there is no in-app
 *    source viewer.
 */

const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";

export interface UploadedSource {
  anthropicFileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export async function uploadSource(file: File): Promise<UploadedSource> {
  // The Files API is out of beta and takes no `purpose` — docs that mention
  // purpose: "agent" predate that.
  const uploaded = await anthropic().files.upload({
    file: await toFile(file, file.name, {
      type: file.type || "application/octet-stream",
    }),
  });

  return {
    anthropicFileId: uploaded.id,
    filename: uploaded.filename,
    mimeType: uploaded.mime_type,
    sizeBytes: uploaded.size_bytes,
  };
}

/**
 * Mounts an already-uploaded file into a *running* session. Sources can be
 * added and removed without restarting the notebook.
 */
export async function mountSource(
  sessionId: string,
  anthropicFileId: string,
  filename: string,
): Promise<string> {
  const resource = await anthropic().beta.sessions.resources.add(sessionId, {
    type: "file",
    file_id: anthropicFileId,
    mount_path: mountPathFor(filename),
  });
  return resource.id;
}

export async function unmountSource(sessionId: string, resourceId: string): Promise<void> {
  await anthropic().beta.sessions.resources.delete(resourceId, {
    session_id: sessionId,
  });
}

export async function deleteFile(anthropicFileId: string): Promise<void> {
  await anthropic().files.delete(anthropicFileId);
}

export interface Artifact {
  fileId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

/**
 * Artifacts are listed live rather than mirrored into Firestore — one less
 * thing to keep in sync.
 *
 * `scope_id` is a Managed Agents parameter on a Files endpoint, so this one
 * call needs the managed-agents beta header passed explicitly; the SDK only
 * adds the Files one.
 *
 * Two things `scope_id` does not do, both found the hard way:
 *
 * - It does not mean "outputs". A session's scope includes the sources mounted
 *   into it, so the list has to be filtered. `downloadable` is the reliable
 *   discriminator: uploads come back false, agent-written outputs true.
 * - It is not immediate. Indexing lags `session.status_idle` by a second or
 *   two, so we retry — on the *filtered* count, because the mounted sources
 *   are already there and would otherwise satisfy the retry straight away.
 */
export async function listArtifacts(sessionId: string, retries = 2): Promise<Artifact[]> {
  for (let attempt = 0; ; attempt++) {
    const page = await anthropic().beta.files.list({
      scope_id: sessionId,
      betas: [MANAGED_AGENTS_BETA],
    });

    const artifacts = page.data
      .filter((file) => file.downloadable === true)
      .map((file) => ({
        fileId: file.id,
        filename: file.filename,
        sizeBytes: file.size_bytes,
        mimeType: file.mime_type,
        createdAt: file.created_at,
      }));

    if (artifacts.length > 0 || attempt >= retries) return artifacts;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** Proxied through the server so no Anthropic credential reaches the browser. */
export async function downloadArtifact(fileId: string): Promise<Response> {
  return anthropic().beta.files.download(fileId);
}
