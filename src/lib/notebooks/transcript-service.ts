import "server-only";

import { anthropic } from "@/lib/anthropic/client";
import { encodeCursor, normalizeEvent, type UiEvent } from "@/lib/anthropic/events";
import type { Notebook } from "@/lib/notebooks/notebook-service";

export interface Transcript {
  events: UiEvent[];
  /** Where a stream should resume from. Null when there is nothing yet. */
  cursor: string | null;
}

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

  const page = await anthropic().beta.sessions.events.list(notebook.sessionId, {
    order: "asc",
    limit: 1000,
  });

  const events: UiEvent[] = [];
  let cursor: string | null = null;

  for (const raw of page.data) {
    const event = normalizeEvent(raw);
    if (event) events.push(event);

    // The cursor tracks every event, not just rendered ones, so a resume does
    // not re-deliver the ones we chose to drop.
    if (raw.processed_at) {
      cursor = encodeCursor({ timestamp: raw.processed_at, eventId: raw.id });
    }
  }

  return { events, cursor };
}
