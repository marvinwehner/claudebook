import type { Anthropic } from "@anthropic-ai/sdk";
import type { Stream } from "@anthropic-ai/sdk/core/streaming";

import { anthropic } from "@/lib/anthropic/client";
import { decodeCursor, encodeCursor, normalizeEvent, type UiEvent } from "@/lib/anthropic/events";
import { requireUser } from "@/lib/auth/dal";
import { ConflictError, toErrorResponse } from "@/lib/notebooks/errors";
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

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // no-transform matters as much as no-store: a compressing proxy would buffer
  // the whole response and defeat streaming entirely.
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const BLANK = "\n\n";

const SELF_CLOSE_MS = 4 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;

/**
 * `id:` is omitted for an event with no `processed_at`, because there is no
 * timestamp to resume from. Per the SSE spec the browser then keeps the last id
 * it saw, so an unresumable cursor can never displace a usable one.
 */
function frame(event: UiEvent, cursor: string | null): string {
  return `${cursor ? `id: ${cursor}\n` : ""}event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(request: Request, ctx: RouteContext<"/api/notebooks/[id]/stream">) {
  let sessionId: string;

  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);
    sessionId = (await liveSession(notebook)).session.id;
  } catch (error) {
    // A conflict means another request is mid-rebuild. Closing a valid stream
    // lets EventSource reconnect; a non-2xx would stop it for good.
    if (error instanceof ConflictError) {
      return new Response("retry: 2000" + BLANK, { headers: SSE_HEADERS });
    }
    // Auth and ownership failures must be ordinary JSON responses — an
    // EventSource that gets a 401 stops retrying, which is what we want.
    return toErrorResponse(error);
  }

  // The header only exists on an automatic reconnect. The query param carries
  // the cursor the server component already computed, so the first connect
  // resumes from the rendered transcript instead of from nothing.
  const cursor = decodeCursor(
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("cursor"),
  );
  const encoder = new TextEncoder();

  let cancelRelay = () => {};

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const seen = new Set<string>();
      let closed = false;
      let stream: Stream<Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents> | null =
        null;

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The peer is gone; tear the whole relay down rather than leaving the
          // heartbeat and the upstream stream running.
          finish();
        }
      };

      const emit = (raw: { id: string; processed_at?: string | null }, event: UiEvent | null) => {
        if (!event || seen.has(raw.id)) return;
        seen.add(raw.id);
        send(
          frame(
            event,
            raw.processed_at
              ? encodeCursor({ timestamp: raw.processed_at, eventId: raw.id })
              : null,
          ),
        );
      };

      // Intermediaries drop connections that go quiet; a comment frame is the
      // cheapest thing that counts as traffic.
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      const selfClose = setTimeout(() => finish(), SELF_CLOSE_MS);

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
      cancelRelay = finish;

      // We close ourselves every 4 minutes, so EventSource's 3s default retry
      // would leave a visible gap after every one. Ask for a shorter one.
      send("retry: 750\n\n");

      request.signal.addEventListener("abort", () => finish());

      try {
        // Open the stream BEFORE replaying history. The stream carries only
        // what happens after it connects, so opening second would leave a hole
        // exactly the width of the history fetch.
        stream = await anthropic().beta.sessions.events.stream(sessionId, {
          event_deltas: ["agent.message"],
        });

        if (cursor) {
          // `created_at[gt]` filters on, and `order` sorts by, the event's
          // `processed_at`. The `seen` set is what makes the seam exact.
          seen.add(cursor.eventId);
          for await (const raw of anthropic().beta.sessions.events.list(sessionId, {
            "created_at[gt]": cursor.timestamp,
            order: "asc",
          })) {
            if (closed) break;
            emit(raw, normalizeEvent(raw));
          }
        }

        for await (const raw of stream) {
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

    // Fired when the response body is discarded without `request.signal`
    // aborting — a proxy teardown, or the tab going away at the wrong moment.
    cancel() {
      cancelRelay();
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
}
