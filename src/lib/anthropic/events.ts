import type { Anthropic } from "@anthropic-ai/sdk";

import type { Artifact } from "@/lib/anthropic/files";

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
  | {
      kind: "usage";
      id: string;
      at: string;
      inputTokens: number;
      outputTokens: number;
    }
  | { kind: "error"; id: string; at: string; message: string };

/**
 * Synthesised by the relay after a turn rather than normalised from an Anthropic
 * event, so it carries no id and never enters the transcript.
 */
export type ArtifactsEvent = { kind: "artifacts"; artifacts: Artifact[] };

/** Everything the SSE relay sends: the transcript events plus the synthesised one. */
export type StreamEvent = UiEvent | ArtifactsEvent;

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

    case "session.usage":
      return {
        kind: "usage",
        id: event.id,
        at: event.processed_at,
        inputTokens: event.usage.input_tokens ?? 0,
        outputTokens: event.usage.output_tokens ?? 0,
      };

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
