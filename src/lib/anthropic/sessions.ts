import "server-only";

import type { Anthropic } from "@anthropic-ai/sdk";

import { containerPathFor, mountPathFor, type NotebookModel } from "@/lib/anthropic/agent";
import { agentId, anthropic, environmentId } from "@/lib/anthropic/client";

type Session = Anthropic.Beta.Sessions.BetaManagedAgentsSession;

/** Everything ensureSession needs to rebuild a notebook's session from scratch. */
export interface SessionSpec {
  notebookId: string;
  title: string;
  model: NotebookModel;
  customInstructions?: string;
  /** The Firestore source index — the durable record of what should be mounted. */
  sources: Array<{
    sourceId: string;
    filename: string;
    anthropicFileId: string;
  }>;
}

export interface EnsureSessionResult {
  session: Session;
  /** True when the old session was gone and this one was built from the index. */
  rehydrated: boolean;
  /** Set when rehydrated: `sourceId` → new session resource id, to write back. */
  resourceIds?: Record<string, string>;
  /**
   * Set when rehydrated: the note to attach to the next user message.
   *
   * It cannot be sent on its own — the API rejects a lone `system.message`
   * with "must immediately follow a `user.message`, `user.tool_result`, or
   * `user.custom_tool_result` event in the same request" — so the caller
   * hands it to `sendUserMessage` and it rides along. If rehydration happened
   * on an upload rather than a message, persist it until the next message.
   */
  seedNote?: string;
}

/**
 * A session is unusable once it terminates — terminated is irreversible, on
 * completion or on error alike.
 */
function isUsable(session: Session): boolean {
  return session.status !== "terminated" && !session.archived_at;
}

async function retrieve(sessionId: string): Promise<Session | null> {
  try {
    return await anthropic().beta.sessions.retrieve(sessionId);
  } catch {
    // Deleted, expired, or never existed. All mean "build a new one".
    return null;
  }
}

/**
 * Creates a session for a notebook and mounts every source it already has.
 *
 * The per-notebook model and custom instructions ride on `agent_with_overrides`
 * rather than on a per-notebook agent: session-local, and it creates no new
 * agent version. Overrides replace in full and never merge, so only the fields
 * that actually vary are sent.
 */
export async function createSession(spec: SessionSpec): Promise<{
  session: Session;
  resourceIds: Record<string, string>;
}> {
  const overrides: Anthropic.Beta.Sessions.BetaManagedAgentsAgentWithOverridesParams = {
    type: "agent_with_overrides",
    id: agentId(),
    model: spec.model,
    // Overrides replace in full and never merge, so send `system` only when the
    // notebook actually has custom instructions — otherwise the agent's own
    // prompt is inherited.
    ...(spec.customInstructions?.trim() ? { system: spec.customInstructions.trim() } : {}),
  };

  const session = await anthropic().beta.sessions.create({
    // A plain string or {type:"agent"} would ignore the model; the override
    // form is what makes "Opus for this notebook" work at all.
    agent: overrides,
    environment_id: environmentId(),
    title: spec.title,
    resources: spec.sources.map((source) => ({
      type: "file" as const,
      file_id: source.anthropicFileId,
      mount_path: mountPathFor(source.filename),
    })),
    metadata: { notebook_id: spec.notebookId },
  });

  // Sessions list resources in the order they were attached, so this lines up
  // with `spec.sources` — but match on file_id rather than trusting position.
  const resourceIds: Record<string, string> = {};
  for (const source of spec.sources) {
    const resource = session.resources?.find(
      (candidate): candidate is Anthropic.Beta.Sessions.BetaManagedAgentsFileResource =>
        candidate.type === "file" && candidate.file_id === source.anthropicFileId,
    );
    if (resource) resourceIds[source.sourceId] = resource.id;
  }

  return { session, resourceIds };
}

/**
 * The single choke point every chat, source and artifact call goes through.
 *
 * Anthropic publishes no session TTL, so a notebook's session *will* disappear
 * eventually. Rehydration is therefore built in rather than bolted on: if the
 * stored session is missing or terminated, rebuild it from the Firestore source
 * index, hand back the new IDs for the caller to persist, and seed the fresh
 * transcript with a note so the agent does not act as if it remembers a
 * conversation it cannot see.
 *
 * It also implements "change this notebook's model", since a session's model is
 * fixed at create time — pass a different `spec.model` with no `sessionId`.
 */
export async function ensureSession(
  sessionId: string | null | undefined,
  spec: SessionSpec,
): Promise<EnsureSessionResult> {
  if (sessionId) {
    const existing = await retrieve(sessionId);
    if (existing && isUsable(existing)) {
      return { session: existing, rehydrated: false };
    }
  }

  const { session, resourceIds } = await createSession(spec);

  const mounted = spec.sources.map((source) => containerPathFor(source.filename));
  const seedNote =
    `This session was restarted, so the earlier conversation in this notebook is ` +
    `not visible to you. The user can still see it — do not claim it never ` +
    `happened, and ask them to restate anything you need. ` +
    (mounted.length > 0
      ? `The notebook's ${mounted.length} source(s) are mounted again at: ${mounted.join(", ")}.`
      : `This notebook has no sources yet.`);

  return { session, rehydrated: true, resourceIds, seedNote };
}

/**
 * `systemNote` is sent in the same request, immediately after the message — the
 * only placement the API accepts for a `system.message`. It applies to this turn
 * and every turn after it.
 */
export async function sendUserMessage(
  sessionId: string,
  text: string,
  systemNote?: string,
): Promise<void> {
  const events: Anthropic.Beta.Sessions.EventSendParams["events"] = [
    { type: "user.message", content: [{ type: "text", text }] },
  ];

  if (systemNote) {
    events.push({
      type: "system.message",
      content: [{ type: "text", text: systemNote }],
    });
  }

  await anthropic().beta.sessions.events.send(sessionId, { events });
}

export async function interrupt(sessionId: string): Promise<void> {
  await anthropic().beta.sessions.events.send(sessionId, {
    events: [{ type: "user.interrupt" }],
  });
}

/**
 * Archive rather than delete: archiving makes the session read-only and frees
 * its container, while delete would destroy the event history we may still want
 * for support. Both are irreversible.
 */
export async function archiveSession(sessionId: string): Promise<void> {
  await anthropic().beta.sessions.archive(sessionId);
}
