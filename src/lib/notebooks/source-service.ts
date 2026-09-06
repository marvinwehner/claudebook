import "server-only";

import { mountPathFor } from "@/lib/anthropic/agent";
import { deleteFile, mountSource, unmountSource, uploadSource } from "@/lib/anthropic/files";
import * as sources from "@/lib/firestore/sources";
import { liveSession, type Notebook } from "@/lib/notebooks/notebook-service";
import { NotFoundError, ValidationError } from "@/lib/notebooks/errors";

export type Source = sources.Source;

/** Anthropic caps a session at 500 file resources. */
const MAX_SOURCES = 500;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILENAME_CHARS = 200;

/**
 * `file.name` is the multipart `filename=` parameter, so it is entirely
 * attacker-controlled, and it leaves this app twice: as a `mount_path`, where
 * `../outputs/x` would escape into the artifact directory, and interpolated
 * into the rehydration note, which is sent with system authority.
 *
 * Rejected rather than rewritten: a silently rewritten name would slip past the
 * duplicate check two lines below and let two sources collide on one mount path.
 */
function validFilename(raw: string): string {
  const name = raw.split(/[/\\]/).pop() ?? "";

  const usable =
    name === raw &&
    name.length > 0 &&
    name.length <= MAX_FILENAME_CHARS &&
    !name.startsWith(".") &&
    !/[\u0000-\u001f\u007f]/.test(name);

  if (!usable) {
    throw new ValidationError(
      `"${raw}" is not a usable filename. Use a plain name with no slashes or ` +
        `leading dot, at most ${MAX_FILENAME_CHARS} characters.`,
    );
  }
  return name;
}

export async function listSources(notebook: Notebook): Promise<Source[]> {
  return sources.listSources(notebook.id);
}

/**
 * Upload → mount into the running session → index in Firestore.
 *
 * That order matters: nothing is written to the index until the file exists and
 * is mounted, so the index never claims a source the session does not have.
 * Files can be added to a running session, so this does not interrupt a
 * conversation.
 */
export async function addSource(notebook: Notebook, file: File): Promise<Source> {
  // The one validated name, used for the dedupe check, the mount path and the
  // index row alike — anything else lets those three drift apart.
  const filename = validFilename(file.name);

  if (file.size === 0) throw new ValidationError(`${filename} is empty.`);
  if (file.size > MAX_BYTES) {
    throw new ValidationError(`${filename} is larger than the 32 MB limit.`);
  }

  const existing = await sources.listSources(notebook.id);
  if (existing.length >= MAX_SOURCES) {
    throw new ValidationError(`A notebook holds at most ${MAX_SOURCES} sources.`);
  }
  if (existing.some((source) => source.filename === filename)) {
    // Filenames are how the agent cites, and how mount paths are built. Two
    // sources with one name would make both ambiguous.
    throw new ValidationError(`This notebook already has a source called ${filename}.`);
  }

  const uploaded = await uploadSource(file, filename);
  const { session } = await liveSession(notebook);

  let sessionResourceId: string | null = null;
  try {
    sessionResourceId = await mountSource(session.id, uploaded.anthropicFileId, filename);
  } catch (error) {
    // Don't leave an unreferenced file behind in the workspace.
    await deleteFile(uploaded.anthropicFileId).catch(() => {});
    throw error;
  }

  return sources.createSource(notebook.id, {
    filename,
    mimeType: uploaded.mimeType,
    sizeBytes: uploaded.sizeBytes,
    mountPath: mountPathFor(filename),
    anthropicFileId: uploaded.anthropicFileId,
    sessionResourceId,
    status: "ready",
  });
}

/**
 * Unmount → delete the file → drop the index row.
 *
 * The index row goes last so a failure part-way leaves something to retry
 * against rather than an orphaned Anthropic file nothing points at.
 */
export async function removeSource(notebook: Notebook, sourceId: string): Promise<void> {
  const source = await sources.getSource(notebook.id, sourceId);
  if (!source) throw new NotFoundError("Source not found.");

  if (source.sessionResourceId && notebook.sessionId) {
    await unmountSource(notebook.sessionId, source.sessionResourceId).catch(() => {
      // The session may have been rebuilt or archived since; the file delete
      // below is what actually matters.
    });
  }

  await deleteFile(source.anthropicFileId).catch((error: unknown) => {
    console.error(`Failed to delete Anthropic file ${source.anthropicFileId}:`, error);
  });

  await sources.deleteSource(notebook.id, sourceId);
}
