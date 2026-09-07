import type { Anthropic } from "@anthropic-ai/sdk";

import type { Artifact } from "@/lib/anthropic/files";
import { ZERO_USAGE, type UsageTotals } from "@/lib/usage";

/**
 * Anthropic session events → the small set of things the UI actually renders,
 * plus the SSE cursor codec.
 *
 * Deliberately free of I/O and of `server-only`: the stream route and the
 * history route both normalise through here, the client imports `UiEvent` as a
 * type, and the unit tests import it directly.
 */

type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents;

export type UiEvent =
  | {
      kind: "message";
      id: string;
      at: string;
      role: "user" | "agent";
      text: string;
    }
  /** Best-effort live preview. Superseded by the `message` with the same id. */
  | { kind: "delta"; id: string; index: number; text: string }
  | { kind: "thinking"; id: string; at: string }
  | {
      kind: "tool";
      id: string;
      at: string;
      phase: "start" | "end";
      name?: string;
      toolUseId?: string;
      isError?: boolean;
    }
  | {
      kind: "status";
      id: string;
      at: string;
      status: "running" | "idle" | "terminated" | "rescheduling";
      stopReason?: string;
    }
  | { kind: "error"; id: string; at: string; message: string };

/**
 * Synthesised by the relay after a turn rather than normalised from an Anthropic
 * event, so it carries no id and never enters the transcript.
 */
export type ArtifactsEvent = { kind: "artifacts"; artifacts: Artifact[] };

/**
 * Also synthesised, and always the notebook lifetime total rather than the live
 * session's own — a session is rebuilt on rehydration and on a model change, so
 * what Anthropic reports would drop back to zero. The relay is the only producer
 * of this frame, which is what keeps the frame meaning one thing on the client.
 */
export type UsageEvent = { kind: "usage"; usage: UsageTotals };

/** Everything the SSE relay sends: the transcript events plus the synthesised ones. */
export type StreamEvent = UiEvent | ArtifactsEvent | UsageEvent;

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/**
 * Returns null for events we do not render — thread bookkeeping, model-request
 * spans, outcome evaluation. Dropping them here keeps the SSE frame budget for
 * things the UI reacts to.
 */
export function normalizeEvent(event: SessionEvent): UiEvent | null {
  switch (event.type) {
    case "agent.message":
      return {
        kind: "message",
        id: event.id,
        at: event.processed_at,
        role: "agent",
        text: textOf(event.content),
      };

    // The stream echoes back what we sent. Rendering it is what makes a reload
    // show the conversation rather than a monologue — we do not keep a second
    // copy of the transcript anywhere.
    case "user.message":
      return {
        kind: "message",
        id: event.id,
        at: event.processed_at ?? "",
        role: "user",
        text: textOf(event.content),
      };

    // Preview events carry only the id of the event they preview — no id or
    // processed_at of their own.
    case "event_delta":
      return {
        kind: "delta",
        id: event.event_id,
        index: event.delta.index ?? 0,
        text: event.delta.content.text,
      };

    // agent.thinking is start-only and carries no content; both the preview and
    // the buffered event mean the same thing to us: "it is thinking".
    case "event_start":
      return event.event.type === "agent.thinking"
        ? { kind: "thinking", id: event.event.id, at: "" }
        : null;

    case "agent.thinking":
      return { kind: "thinking", id: event.id, at: event.processed_at };

    case "agent.tool_use":
      return {
        kind: "tool",
        id: event.id,
        at: event.processed_at,
        phase: "start",
        name: event.name,
        toolUseId: event.id,
      };

    case "agent.tool_result":
      return {
        kind: "tool",
        id: event.id,
        at: event.processed_at,
        phase: "end",
        toolUseId: event.tool_use_id,
        isError: event.is_error ?? false,
      };

    case "session.status_running":
      return {
        kind: "status",
        id: event.id,
        at: event.processed_at,
        status: "running",
      };

    case "session.status_idle":
      return {
        kind: "status",
        id: event.id,
        at: event.processed_at,
        status: "idle",
        stopReason: event.stop_reason.type,
      };

    case "session.status_terminated":
      return {
        kind: "status",
        id: event.id,
        at: event.processed_at,
        status: "terminated",
      };

    case "session.status_rescheduled":
      return {
        kind: "status",
        id: event.id,
        at: event.processed_at,
        status: "rescheduling",
      };

    // Not a transcript event: the relay reads the snapshot off it directly and
    // emits a lifetime total instead. Normalising it here would also spend one
    // of loadTranscript's capped event slots to render nothing.
    case "session.usage":
      return null;

    case "session.error":
      return {
        kind: "error",
        id: event.id,
        at: event.processed_at,
        message: event.error.message,
      };

    default:
      return null;
  }
}

/**
 * The session's own cumulative usage — off the session object, or off the
 * snapshot carried by a `session.usage` event. The two are the same shape.
 *
 * Every field is optional on the wire and every one of them is money, but a
 * missing one reads as zero rather than throwing: a readout that is behind is
 * better than a stream that dies.
 */
export function usageFromSession(
  usage:
    | Anthropic.Beta.Sessions.BetaManagedAgentsSessionUsage
    | Anthropic.Beta.Sessions.BetaManagedAgentsSessionUsageSnapshot
    | undefined,
): UsageTotals {
  if (!usage) return ZERO_USAGE;

  const cacheCreation = usage.cache_creation;

  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens:
      (cacheCreation?.ephemeral_1h_input_tokens ?? 0) +
      (cacheCreation?.ephemeral_5m_input_tokens ?? 0),
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    activeSeconds: usage.active_seconds ?? 0,
    // An integer string in minor units. Number() would also accept "1e3" and
    // decimal forms; parseInt keeps this to what the API documents it sends.
    costCents: usage.list_cost ? parseInt(usage.list_cost.amount, 10) || 0 : 0,
  };
}

/** A turn is over only when the agent is idle and not waiting on us. */
export function isTurnComplete(event: UiEvent): boolean {
  return (
    event.kind === "status" && event.status === "idle" && event.stopReason !== "requires_action"
  );
}

// --- SSE cursor -----------------------------------------------------------
//
// EventSource resends the last `id:` it saw as `Last-Event-ID` on reconnect.
// We put both halves of what a resume needs in it: a timestamp to re-query
// from, and the event id to dedupe the boundary event the `gt` filter may or
// may not exclude.
//
// The timestamp is the event's `processed_at` — the only one an event carries.
// The list filter is spelled `created_at[gt]`, and results are ordered by
// `processed_at`, so the two line up in practice; the id-based dedupe is what
// makes the seam lossless either way.

export interface Cursor {
  timestamp: string;
  eventId: string;
}

const SEPARATOR = "|";

export function encodeCursor(cursor: Cursor): string {
  // An SSE id: field is terminated by a newline, so one must never appear in it.
  return `${cursor.timestamp}${SEPARATOR}${cursor.eventId}`.replace(/[\r\n]/g, "");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;

  const separatorAt = raw.indexOf(SEPARATOR);
  if (separatorAt <= 0) return null;

  const timestamp = raw.slice(0, separatorAt);
  const eventId = raw.slice(separatorAt + 1);
  if (!eventId) return null;
  if (Number.isNaN(Date.parse(timestamp))) return null;

  return { timestamp, eventId };
}
