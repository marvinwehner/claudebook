import "server-only";

import { NotFoundError } from "@anthropic-ai/sdk";

import { anthropic } from "@/lib/anthropic/client";
import { encodeCursor, normalizeEvent, type UiEvent } from "@/lib/anthropic/events";
import type { Notebook } from "@/lib/notebooks/notebook-service";

export interface Transcript {
  events: UiEvent[];
  /** Where a stream should resume from. Null when there is nothing yet. */
  cursor: string | null;
}

/** How many rendered events the first paint carries. */
const MAX_EVENTS = 500;

/**
 * The conversation so far.
 *
 * Deliberately does not rehydrate: rendering a notebook should not silently
 * spend money creating a container. A notebook with no session simply has no
 * transcript, and the first message is what brings one up.
 *
 * Shared by the server component that paints the page and the route the client
 * re-fetches from, so a replayed event and a live one are the same shape.
 */
export async function loadTranscript(notebook: Notebook): Promise<Transcript> {
  if (!notebook.sessionId) return { events: [], cursor: null };

  const events: UiEvent[] = [];
  let cursor: string | null = null;

  try {
    // Newest first, so a long conversation keeps its most recent turns instead
    // of its first ones.
    for await (const raw of anthropic().beta.sessions.events.list(notebook.sessionId, {
      order: "desc",
    })) {
      // The cursor tracks every event, not just rendered ones, so a resume does
      // not re-deliver the ones we chose to drop.
      if (!cursor && raw.processed_at) {
        cursor = encodeCursor({ timestamp: raw.processed_at, eventId: raw.id });
      }

      const event = normalizeEvent(raw);
      if (event) events.push(event);
      if (events.length >= MAX_EVENTS) break;
    }
  } catch (error) {
    // The session expired out from under us; the next stream connect rehydrates
    // it. Anything else is a real failure and belongs to the error boundary.
    if (!(error instanceof NotFoundError)) throw error;
    return { events: [], cursor: null };
  }

  events.reverse();
  return { events, cursor };
}
