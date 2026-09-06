import "server-only";

import type { Anthropic } from "@anthropic-ai/sdk";

import { isNotebookModel, type NotebookModel } from "@/lib/anthropic/agent";
import { deleteFile } from "@/lib/anthropic/files";
import { archiveSession, ensureSession, type SessionSpec } from "@/lib/anthropic/sessions";
import * as notebooks from "@/lib/firestore/notebooks";
import * as sources from "@/lib/firestore/sources";
import { NotFoundError, ValidationError } from "@/lib/notebooks/errors";

export type Notebook = notebooks.Notebook;

/**
 * The layer where Firestore and Anthropic meet — deliberately the only one.
 * Repositories know nothing about Anthropic; the Anthropic gateway knows
 * nothing about Firestore.
 */

export async function listNotebooks(ownerId: string): Promise<Notebook[]> {
  return notebooks.listNotebooks(ownerId);
}

/** Throws NotFoundError for both "missing" and "someone else's". */
export async function requireNotebook(id: string, ownerId: string): Promise<Notebook> {
  const notebook = await notebooks.getNotebook(id, ownerId);
  if (!notebook) throw new NotFoundError("Notebook not found.");
  return notebook;
}

export async function createNotebook(
  ownerId: string,
  input: {
    title: string;
    icon?: string;
    model?: string;
    customInstructions?: string;
  },
): Promise<Notebook> {
  const title = input.title.trim();
  if (!title) throw new ValidationError("A notebook needs a title.");

  const model = input.model ?? "claude-sonnet-5";
  if (!isNotebookModel(model)) {
    throw new ValidationError(`Unsupported model: ${model}.`);
  }

  const notebook = await notebooks.createNotebook({
    ownerId,
    title,
    icon: input.icon?.trim() || "📓",
    model,
    customInstructions: input.customInstructions?.trim() || undefined,
  });

  // The session is provisioned eagerly so the first message is not the thing
  // that pays for container start-up. It costs nothing while idle.
  const { session } = await ensureSession(null, specFor(notebook, []));
  await notebooks.updateNotebook(notebook.id, {
    sessionId: session.id,
    sessionStatus: session.status,
    agentVersion: session.agent?.version ?? null,
  });

  return { ...notebook, sessionId: session.id, sessionStatus: session.status };
}

function specFor(notebook: Notebook, notebookSources: sources.Source[]): SessionSpec {
  return {
    notebookId: notebook.id,
    title: notebook.title,
    model: notebook.model,
    customInstructions: notebook.customInstructions,
    sources: notebookSources.map((source) => ({
      sourceId: source.id,
      filename: source.filename,
      anthropicFileId: source.anthropicFileId,
    })),
  };
}

export interface LiveSession {
  session: Anthropic.Beta.Sessions.BetaManagedAgentsSession;
  /** Pending rehydration note, if any. Deliver it with the next user message. */
  seedNote?: string;
}

/**
 * The choke point every chat / source / artifact call goes through.
 *
 * Rehydration side effects — the new session id, the new resource ids, and the
 * seed note — are persisted here rather than in the Anthropic gateway, so the
 * gateway stays free of Firestore.
 */
export async function liveSession(notebook: Notebook): Promise<LiveSession> {
  const notebookSources = await sources.listSources(notebook.id);
  const result = await ensureSession(notebook.sessionId, specFor(notebook, notebookSources));

  if (!result.rehydrated) {
    return { session: result.session, seedNote: notebook.pendingSeedNote };
  }

  await notebooks.updateNotebook(notebook.id, {
    sessionId: result.session.id,
    sessionStatus: result.session.status,
    agentVersion: result.session.agent?.version ?? null,
    pendingSeedNote: result.seedNote,
  });

  if (result.resourceIds) {
    await sources.setSessionResourceIds(notebook.id, result.resourceIds);
  }

  return { session: result.session, seedNote: result.seedNote };
}

/** Called once the seed note has actually been sent. */
export async function clearSeedNote(notebookId: string): Promise<void> {
  await notebooks.updateNotebook(notebookId, { pendingSeedNote: null });
}

export async function markMessageSent(notebookId: string): Promise<void> {
  await notebooks.updateNotebook(notebookId, { touchLastMessage: true });
}

export interface UpdateNotebookInput {
  title?: string;
  icon?: string;
  model?: string;
  customInstructions?: string;
}

/**
 * A model change cannot be applied to a running session — a session's model is
 * fixed at create time. Clearing `sessionId` makes the next `liveSession()`
 * rehydrate onto the new model, re-mounting every source. The transcript does
 * not survive, which is why the UI puts this behind a confirm.
 */
export async function updateNotebook(
  notebook: Notebook,
  input: UpdateNotebookInput,
): Promise<{ notebook: Notebook; conversationReset: boolean }> {
  const patch: notebooks.NotebookPatch = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new ValidationError("A notebook needs a title.");
    patch.title = title;
  }

  if (input.icon !== undefined) patch.icon = input.icon.trim() || "📓";

  if (input.customInstructions !== undefined) {
    patch.customInstructions = input.customInstructions.trim();
  }

  let conversationReset = false;
  let model: NotebookModel = notebook.model;

  if (input.model !== undefined && input.model !== notebook.model) {
    if (!isNotebookModel(input.model)) {
      throw new ValidationError(`Unsupported model: ${input.model}.`);
    }
    model = input.model;
    patch.model = model;
    patch.sessionId = null;
    patch.sessionStatus = null;
    conversationReset = true;

    if (notebook.sessionId) {
      await archiveSession(notebook.sessionId).catch(() => {
        // Already gone or already archived; the notebook still moves on.
      });
    }
  }

  await notebooks.updateNotebook(notebook.id, patch);

  return {
    notebook: {
      ...notebook,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.customInstructions !== undefined
        ? { customInstructions: patch.customInstructions }
        : {}),
      model,
      sessionId: conversationReset ? null : notebook.sessionId,
      sessionStatus: conversationReset ? null : notebook.sessionStatus,
    },
    conversationReset,
  };
}

/**
 * Deleting a notebook must also delete its Anthropic files — they are
 * workspace-scoped, so leaving them behind leaves another user's workspace
 * holding this user's documents.
 */
export async function deleteNotebook(notebook: Notebook): Promise<void> {
  const notebookSources = await sources.listSources(notebook.id);

  if (notebook.sessionId) {
    await archiveSession(notebook.sessionId).catch(() => {});
  }

  await Promise.all(
    notebookSources.map((source) =>
      deleteFile(source.anthropicFileId).catch((error: unknown) => {
        // Log and continue: a leaked file is bad, but a half-deleted notebook
        // the user cannot retry deleting is worse.
        console.error(`Failed to delete Anthropic file ${source.anthropicFileId}:`, error);
      }),
    ),
  );

  await notebooks.deleteNotebook(notebook.id);
}
