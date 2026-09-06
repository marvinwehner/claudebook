"use client";

import { Button, Spinner, TextArea, TextField } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

import type { UiEvent } from "@/lib/anthropic/events";
import { api, ApiError } from "@/lib/api/client";
import type { StreamState } from "@/components/use-notebook-stream";

function Bubble({ role, children }: { role: "user" | "agent"; children: React.ReactNode }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-accent-soft text-foreground max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {children}
        </div>
      </div>
    );
  }

  return <div className="max-w-none text-sm">{children}</div>;
}

function Markdown({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  return (
    // claudebook-markdown maps streamdown's shadcn token names onto HeroUI's.
    // See globals.css.
    <Streamdown className="claudebook-markdown" isAnimating={isStreaming}>
      {text}
    </Streamdown>
  );
}

/** What the agent is doing between messages. */
function Activity({ stream }: { stream: StreamState }) {
  if (stream.activeTools.length > 0) {
    const names = [...new Set(stream.activeTools.map((tool) => tool.name))];
    return (
      <div className="text-muted flex items-center gap-2 text-xs">
        <Spinner size="sm" />
        <span>
          {names.join(", ")}
          {stream.activeTools.length > names.length ? ` ×${stream.activeTools.length}` : ""}
        </span>
      </div>
    );
  }

  if (stream.isThinking) {
    return (
      <div className="text-muted flex items-center gap-2 text-xs">
        <Spinner size="sm" />
        <span>Thinking…</span>
      </div>
    );
  }

  if (stream.isRunning) {
    return (
      <div className="text-muted flex items-center gap-2 text-xs">
        <Spinner size="sm" />
        <span>Working…</span>
      </div>
    );
  }

  return null;
}

export function ChatPane({
  notebookId,
  stream,
  hasSources,
}: {
  notebookId: string;
  stream: StreamState;
  hasSources: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const previewText = [...stream.previews.values()].join("");

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [stream.events.length, previewText]);

  async function send() {
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setError(null);
    try {
      await api.sendMessage(notebookId, text);
      // The message comes back on the stream as an echoed user.message, so
      // there is nothing to add optimistically — just clear the box.
      setDraft("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }

  const messages = stream.events.filter(
    (event): event is Extract<UiEvent, { kind: "message" }> => event.kind === "message",
  );
  const errors = stream.events.filter(
    (event): event is Extract<UiEvent, { kind: "error" }> => event.kind === "error",
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          {messages.length === 0 && !previewText ? (
            <div className="text-muted py-16 text-center text-sm">
              {hasSources
                ? "Ask a question about your sources."
                : "Add a source on the left, then ask a question about it."}
            </div>
          ) : null}

          {messages.map((message) => (
            <Bubble key={message.id} role={message.role}>
              {message.role === "agent" ? <Markdown text={message.text} /> : message.text}
            </Bubble>
          ))}

          {previewText ? (
            <Bubble role="agent">
              <Markdown text={previewText} isStreaming />
            </Bubble>
          ) : null}

          <Activity stream={stream} />

          {errors.map((event) => (
            <p key={event.id} role="alert" className="text-danger text-xs">
              {event.message}
            </p>
          ))}

          <div ref={bottom} />
        </div>
      </div>

      <div className="border-border bg-surface border-t px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          <TextField value={draft} onChange={setDraft} aria-label="Message">
            <TextArea
              rows={2}
              placeholder="Ask about your sources…"
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter is a newline — the convention every
                // chat UI has trained people into.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
          </TextField>

          <div className="flex items-center justify-between gap-3">
            <span className="text-muted text-xs">
              {stream.connected ? "" : "Reconnecting…"}
              {error ? <span className="text-danger">{error}</span> : null}
            </span>

            <div className="flex gap-2">
              {stream.isRunning ? (
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => void api.interrupt(notebookId).catch(() => {})}
                >
                  Stop
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                isDisabled={!draft.trim()}
                isPending={sending}
                onPress={send}
              >
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
