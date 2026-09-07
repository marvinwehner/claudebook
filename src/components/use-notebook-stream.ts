"use client";

import { useCallback, useEffect, useState } from "react";

import type { StreamEvent, UiEvent } from "@/lib/anthropic/events";
import type { Artifact } from "@/lib/anthropic/files";

export interface ToolActivity {
  toolUseId: string;
  name: string;
}

export interface StreamState {
  events: UiEvent[];
  /** Live preview parts by delta index, keyed by the id of the message being generated. */
  previews: Map<string, string[]>;
  isRunning: boolean;
  isThinking: boolean;
  activeTools: ToolActivity[];
  connected: boolean;
}

/**
 * Subscribes to the notebook's SSE relay.
 *
 * EventSource does the reconnection: the server closes at ~4 minutes to stay
 * inside App Hosting's 5-minute cap, and the browser reconnects on its own with
 * `Last-Event-ID`. Nothing here needs to know that happened — the only thing
 * this side has to get right is deduping, because a resume replays the events
 * either side of the seam.
 */
export function useNotebookStream(
  notebookId: string,
  initialEvents: UiEvent[],
  onArtifacts?: (artifacts: Artifact[]) => void,
  initialCursor?: string | null,
): StreamState {
  const [events, setEvents] = useState<UiEvent[]>(initialEvents);
  const [previews, setPreviews] = useState<Map<string, string[]>>(new Map());
  const [isRunning, setRunning] = useState(false);
  const [isThinking, setThinking] = useState(false);
  const [activeTools, setActiveTools] = useState<ToolActivity[]>([]);
  const [connected, setConnected] = useState(false);

  // Not a ref: a ref written during render is exactly what React 19 warns
  // about, and `seen` only ever changes from inside an event callback.
  const [seen] = useState(() => new Set(initialEvents.map((event) => event.id)));

  const handle = useCallback(
    (event: StreamEvent) => {
      switch (event.kind) {
        case "delta":
          // Best-effort: deltas can be shed under load, so this is only ever a
          // prefix of what the buffered message will say. Stored by index so a
          // resume that replays deltas overwrites rather than concatenates.
          setPreviews((current) => {
            const parts = [...(current.get(event.id) ?? [])];
            parts[event.index] = event.text;
            const next = new Map(current);
            next.set(event.id, parts);
            return next;
          });
          setThinking(false);
          return;

        case "message":
          // The buffered message is authoritative. Drop the preview rather than
          // trying to reconcile it.
          setPreviews((current) => {
            if (!current.has(event.id)) return current;
            const next = new Map(current);
            next.delete(event.id);
            return next;
          });
          setThinking(false);
          break;

        case "thinking":
          setThinking(true);
          return;

        case "tool":
          setActiveTools((current) =>
            event.phase === "start"
              ? [
                  ...current,
                  {
                    toolUseId: event.toolUseId ?? event.id,
                    name: event.name ?? "tool",
                  },
                ]
              : current.filter((tool) => tool.toolUseId !== event.toolUseId),
          );
          setThinking(false);
          return;

        case "status":
          setRunning(event.status === "running");
          // A turn that ends without a buffered message — interrupted, errored,
          // terminated — would otherwise leave its preview stranded.
          if (event.status === "idle" || event.status === "terminated") {
            setPreviews((current) => (current.size === 0 ? current : new Map()));
          }
          if (event.status === "idle") {
            setThinking(false);
            setActiveTools([]);
          }
          return;

        case "artifacts":
          onArtifacts?.(event.artifacts);
          return;

        case "usage":
          return;
      }

      // Only `message` and `error` are worth putting in the transcript.
      if (seen.has(event.id)) return;
      seen.add(event.id);
      setEvents((current) => [...current, event]);
    },
    // onArtifacts comes from a useCallback in the caller, so this is stable
    // and the subscription below is not torn down on every render.
    [seen, onArtifacts],
  );

  useEffect(() => {
    // Last-Event-ID is sent only on a reconnect, so the first connect carries
    // the SSR snapshot's cursor in the query or the events since it are lost.
    const query = initialCursor ? `?cursor=${encodeURIComponent(initialCursor)}` : "";
    const source = new EventSource(`/api/notebooks/${notebookId}/stream${query}`);

    source.onopen = () => setConnected(true);
    source.onerror = () => {
      // Fired both on a real failure and on the server's own 4-minute close.
      // EventSource retries by itself; there is nothing to do but stop
      // claiming we are connected.
      setConnected(false);
    };

    const onMessage = (message: MessageEvent<string>) => {
      try {
        handle(JSON.parse(message.data) as StreamEvent);
      } catch {
        // A truncated frame is not worth tearing the stream down for.
      }
    };

    for (const kind of [
      "message",
      "delta",
      "thinking",
      "tool",
      "status",
      "usage",
      "error",
      "artifacts",
    ]) {
      source.addEventListener(kind, onMessage as EventListener);
    }

    return () => source.close();
    // initialCursor is a string from the server render, so it is stable by
    // value and does not tear the subscription down on every render.
  }, [notebookId, initialCursor, handle]);

  return { events, previews, isRunning, isThinking, activeTools, connected };
}
