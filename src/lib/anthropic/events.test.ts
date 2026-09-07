import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  encodeCursor,
  isTurnComplete,
  normalizeEvent,
  usageFromSession,
  type UiEvent,
} from "./events";
import { ZERO_USAGE } from "@/lib/usage";

// The SDK's event union is wide and mostly irrelevant here; each test builds the
// few fields normalizeEvent actually reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asEvent = (value: unknown) => value as any;

const AT = "2026-09-06T12:00:00.000Z";

describe("normalizeEvent", () => {
  it("joins the text blocks of an agent.message and drops redacted ones", () => {
    const result = normalizeEvent(
      asEvent({
        type: "agent.message",
        id: "sevt_1",
        processed_at: AT,
        content: [
          { type: "text", text: "Hello " },
          { type: "redacted" },
          { type: "text", text: "world" },
        ],
      }),
    );

    expect(result).toEqual({
      kind: "message",
      id: "sevt_1",
      at: AT,
      role: "agent",
      text: "Hello world",
    });
  });

  it("keys a delta by the previewed event's id, not its own", () => {
    const result = normalizeEvent(
      asEvent({
        type: "event_delta",
        event_id: "sevt_1",
        delta: {
          type: "content_delta",
          index: 2,
          content: { type: "text", text: "chunk" },
        },
      }),
    );

    expect(result).toEqual({
      kind: "delta",
      id: "sevt_1",
      index: 2,
      text: "chunk",
    });
  });

  it("defaults a delta's index to 0 when the server omits it", () => {
    const result = normalizeEvent(
      asEvent({
        type: "event_delta",
        event_id: "sevt_1",
        delta: { type: "content_delta", content: { type: "text", text: "x" } },
      }),
    );

    expect(result).toMatchObject({ index: 0 });
  });

  it("treats an agent.thinking preview as the thinking signal", () => {
    // agent.thinking is start-only: no deltas follow and the buffered event
    // carries no content either.
    expect(
      normalizeEvent(
        asEvent({
          type: "event_start",
          event: { type: "agent.thinking", id: "sevt_2" },
        }),
      ),
    ).toEqual({ kind: "thinking", id: "sevt_2", at: "" });
  });

  it("ignores an agent.message preview start — the first delta opens the buffer", () => {
    expect(
      normalizeEvent(
        asEvent({
          type: "event_start",
          event: { type: "agent.message", id: "sevt_1" },
        }),
      ),
    ).toBeNull();
  });

  it("maps tool use and tool result to the two phases of one tool", () => {
    expect(
      normalizeEvent(
        asEvent({
          type: "agent.tool_use",
          id: "sevt_3",
          processed_at: AT,
          name: "read",
          input: {},
        }),
      ),
    ).toEqual({
      kind: "tool",
      id: "sevt_3",
      at: AT,
      phase: "start",
      name: "read",
      toolUseId: "sevt_3",
    });

    expect(
      normalizeEvent(
        asEvent({
          type: "agent.tool_result",
          id: "sevt_4",
          processed_at: AT,
          tool_use_id: "sevt_3",
          is_error: true,
        }),
      ),
    ).toEqual({
      kind: "tool",
      id: "sevt_4",
      at: AT,
      phase: "end",
      toolUseId: "sevt_3",
      isError: true,
    });
  });

  it("carries the stop reason on idle", () => {
    expect(
      normalizeEvent(
        asEvent({
          type: "session.status_idle",
          id: "sevt_5",
          processed_at: AT,
          stop_reason: { type: "requires_action", event_ids: ["sevt_3"] },
        }),
      ),
    ).toEqual({
      kind: "status",
      id: "sevt_5",
      at: AT,
      status: "idle",
      stopReason: "requires_action",
    });
  });

  it("surfaces a session error's message", () => {
    expect(
      normalizeEvent(
        asEvent({
          type: "session.error",
          id: "sevt_6",
          processed_at: AT,
          error: { type: "model_overloaded", message: "Overloaded" },
        }),
      ),
    ).toEqual({ kind: "error", id: "sevt_6", at: AT, message: "Overloaded" });
  });

  it("renders an echoed user.message so a reload shows both sides", () => {
    expect(
      normalizeEvent(
        asEvent({
          type: "user.message",
          id: "sevt_0",
          processed_at: AT,
          content: [{ type: "text", text: "What does it say?" }],
        }),
      ),
    ).toEqual({
      kind: "message",
      id: "sevt_0",
      at: AT,
      role: "user",
      text: "What does it say?",
    });
  });

  it("returns null for events the UI does not render", () => {
    for (const type of [
      "session.thread_created",
      "span.model_request_start",
      "agent.thread_message_sent",
      // Read out-of-band by the relay, which emits a lifetime total instead.
      // Keeping it out of the transcript also stops it eating an event slot.
      "session.usage",
    ]) {
      expect(normalizeEvent(asEvent({ type, id: "sevt_x", processed_at: AT }))).toBeNull();
    }
  });
});

describe("isTurnComplete", () => {
  const idle = (stopReason: string): UiEvent => ({
    kind: "status",
    id: "sevt_1",
    at: AT,
    status: "idle",
    stopReason,
  });

  it("is true only for an idle that is not waiting on us", () => {
    expect(isTurnComplete(idle("end_turn"))).toBe(true);
    expect(isTurnComplete(idle("budget_reached"))).toBe(true);
    expect(isTurnComplete(idle("requires_action"))).toBe(false);
  });

  it("is false for every other event", () => {
    expect(isTurnComplete({ kind: "status", id: "a", at: AT, status: "running" })).toBe(false);
    expect(
      isTurnComplete({
        kind: "message",
        id: "a",
        at: AT,
        role: "agent",
        text: "hi",
      }),
    ).toBe(false);
  });
});

describe("cursor codec", () => {
  it("round-trips", () => {
    const cursor = { timestamp: AT, eventId: "sevt_01ABC" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("splits on the first separator so an id containing one survives", () => {
    expect(decodeCursor(`${AT}|sevt_a|b`)).toEqual({
      timestamp: AT,
      eventId: "sevt_a|b",
    });
  });

  it("strips newlines, which would terminate the SSE id field early", () => {
    expect(encodeCursor({ timestamp: AT, eventId: "sevt_a\nid: forged" })).toBe(
      `${AT}|sevt_aid: forged`,
    );
  });

  it("rejects anything it cannot resume from", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("no-separator")).toBeNull();
    expect(decodeCursor(`${AT}|`)).toBeNull(); // no event id
    expect(decodeCursor("|sevt_1")).toBeNull(); // no timestamp
    expect(decodeCursor("not-a-date|sevt_1")).toBeNull();
  });
});

describe("usageFromSession", () => {
  it("maps a full snapshot, summing both cache-creation lifetimes", () => {
    expect(
      usageFromSession({
        input_tokens: 12_400,
        output_tokens: 3100,
        cache_read_input_tokens: 148_000,
        cache_creation: { ephemeral_1h_input_tokens: 900, ephemeral_5m_input_tokens: 100 },
        server_tool_use: { web_search_requests: 2, web_fetch_requests: 7 },
        active_seconds: 252,
        list_cost: { amount: "83", currency: "USD" },
      }),
    ).toEqual({
      inputTokens: 12_400,
      outputTokens: 3100,
      cacheReadTokens: 148_000,
      cacheCreationTokens: 1000,
      // web_fetch is not metered, so it is not carried.
      webSearches: 2,
      activeSeconds: 252,
      costCents: 83,
    });
  });

  it("reads every absent field as zero rather than throwing", () => {
    expect(usageFromSession({})).toEqual(ZERO_USAGE);
    expect(usageFromSession(undefined)).toEqual(ZERO_USAGE);
    expect(usageFromSession({ list_cost: null, server_tool_use: null })).toEqual(ZERO_USAGE);
  });

  // The amount is a string in minor units precisely so no float rounding is
  // ever applied to money — parsing it as a float would undo that.
  it("keeps money in integer cents", () => {
    expect(usageFromSession({ list_cost: { amount: "5000", currency: "USD" } }).costCents).toBe(
      5000,
    );
    expect(usageFromSession({ list_cost: { amount: "0", currency: "USD" } }).costCents).toBe(0);
  });

  // The reason for the `|| 0`: NaN cents would render as "$NaN" and, worse,
  // poison every total it was added to.
  it("falls back to zero on an amount it cannot parse", () => {
    expect(usageFromSession({ list_cost: { amount: "abc", currency: "USD" } }).costCents).toBe(0);
    expect(usageFromSession({ list_cost: { amount: "", currency: "USD" } }).costCents).toBe(0);
  });
});
