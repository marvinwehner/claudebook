import type { Anthropic } from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/core/streaming";

import { anthropic } from "@/lib/anthropic/client";
import { decodeCursor, encodeCursor, normalizeEvent, type UiEvent } from "@/lib/anthropic/events";
import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { liveSession, requireNotebook } from "@/lib/notebooks/notebook-service";

/**
 * SSE relay: Anthropic's session stream, normalised and re-emitted to the
 * browser's native EventSource.
 *
 * EventSource rather than fetch+ReadableStream because it gives us the three
 * things this needs for free: it is a GET (so it carries the session cookie),
 * it reconnects on its own, and it resends the last `id:` it saw as
 * `Last-Event-ID`.
 *
 * The hard constraint is App Hosting's 5-minute request cap, which is not
 * configurable. Being cut at 5 minutes mid-frame would be silent corruption, so
 * this closes itself cleanly at 4 and lets the client reconnect — the cursor
 * makes that seam lossless.
 */

const SELF_CLOSE_MS = 4 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;

function frame(event: UiEvent, cursor: string): string {
  return `id: ${cursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request, ctx: RouteContext<"/api/notebooks/[id]/stream">) {
  let sessionId: string;

  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);
    sessionId = (await liveSession(notebook)).session.id;
  } catch (error) {
    // Auth and ownership failures must be ordinary JSON responses — an
    // EventSource that gets a 401 stops retrying, which is what we want.
    return toErrorResponse(error);
  }

  const cursor = decodeCursor(request.headers.get("last-event-id"));
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const seen = new Set<string>();
      let closed = false;

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      const emit = (raw: { id: string; processed_at?: string | null }, event: UiEvent | null) => {
        if (!event || seen.has(raw.id)) return;
        seen.add(raw.id);
        send(frame(event, encodeCursor({ timestamp: raw.processed_at ?? "", eventId: raw.id })));
      };

      // Intermediaries drop connections that go quiet; a comment frame is the
      // cheapest thing that counts as traffic.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      const selfClose = setTimeout(() => finish(), SELF_CLOSE_MS);

      let stream: Stream<Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents> | null = null;

      function finish() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(selfClose);
        stream?.controller.abort();
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      }

      request.signal.addEventListener("abort", finish);

      try {
        // Open the stream BEFORE replaying history. The stream carries only
        // what happens after it connects, so opening second would leave a hole
        // exactly the width of the history fetch.
        stream = await anthropic().beta.sessions.events.stream(sessionId, {
          event_deltas: ["agent.message"],
        });

        if (cursor) {
          // `created_at[gt]` is the filter's name; results are ordered by
          // processed_at, which is the only timestamp an event carries. The
          // `seen` set is what actually makes the seam exact.
          const history = await anthropic().beta.sessions.events.list(sessionId, {
            "created_at[gt]": cursor.timestamp,
            order: "asc",
            limit: 1000,
          });
          seen.add(cursor.eventId);
          for (const raw of history.data) {
            emit(raw, normalizeEvent(raw));
          }
        }

        for await (const raw of stream!) {
          if (closed) break;

          // event_start / event_delta are preview-only: never persisted, no id
          // of their own, and nothing to dedupe against. Forward them straight
          // through rather than putting them in `seen`.
          if (raw.type === "event_start" || raw.type === "event_delta") {
            const event = normalizeEvent(raw);
            if (event) send(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
            continue;
          }

          emit(raw, normalizeEvent(raw));
        }
      } catch (error) {
        if (!closed) {
          console.error("Stream relay failed:", error);
          send(
            `event: error\ndata: ${JSON.stringify({
              kind: "error",
              id: "relay",
              at: new Date().toISOString(),
              message: "The connection to the agent dropped. Reconnecting…",
            })}\n\n`,
          );
        }
      } finally {
        finish();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform matters as much as no-store: a compressing proxy would
      // buffer the whole response and defeat streaming entirely.
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
