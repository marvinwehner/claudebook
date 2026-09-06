import { NextResponse } from "next/server";

import { anthropic } from "@/lib/anthropic/client";
import { encodeCursor, normalizeEvent, type UiEvent } from "@/lib/anthropic/events";
import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";

/**
 * The transcript for first paint.
 *
 * The stream only carries events from the moment it connects, so the page has
 * to fetch history separately. Both go through `normalizeEvent`, so a replayed
 * message and a live one are the same shape to the client.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/notebooks/[id]/events">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    // Deliberately no rehydration here: a first paint should show what the
    // notebook has, not silently spend money creating a container.
    if (!notebook.sessionId) {
      return NextResponse.json({ events: [], cursor: null });
    }

    const page = await anthropic().beta.sessions.events.list(notebook.sessionId, {
      order: "asc",
      limit: 1000,
    });

    const events: UiEvent[] = [];
    let cursor: string | null = null;

    for (const raw of page.data) {
      const event = normalizeEvent(raw);
      if (event) events.push(event);
      // Cursor tracks every event, not just rendered ones, so a resume does not
      // re-deliver events we chose to drop.
      if ("id" in raw && "processed_at" in raw && raw.processed_at) {
        cursor = encodeCursor({ timestamp: raw.processed_at, eventId: raw.id });
      }
    }

    return NextResponse.json({ events, cursor, sessionId: notebook.sessionId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
