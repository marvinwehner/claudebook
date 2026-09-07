"use client";

import { ChevronRight } from "@gravity-ui/icons";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import type { UiEvent } from "@/lib/anthropic/events";
import type { Artifact } from "@/lib/anthropic/files";
import { api } from "@/lib/api/client";
import type { Notebook } from "@/lib/firestore/notebooks";
import type { Source } from "@/lib/firestore/sources";
import { ArtifactsRail } from "@/components/artifacts-rail";
import { ChatPane } from "@/components/chat-pane";
import { NotebookIcon } from "@/components/notebook-icon";
import { NotebookSettings } from "@/components/notebook-settings";
import { SourcesRail } from "@/components/sources-rail";
import { useNotebookStream } from "@/components/use-notebook-stream";

/**
 * The three panes, and the little state they share: sources on the left,
 * conversation in the middle, artifacts on the right.
 */
export function NotebookWorkspace({
  notebook,
  initialSources,
  initialEvents,
  initialCursor,
}: {
  notebook: Notebook;
  initialSources: Source[];
  initialEvents: UiEvent[];
  initialCursor: string | null;
}) {
  const [sources, setSources] = useState(initialSources);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);

  const pushed = useRef(false);

  const showArtifacts = useCallback((next: Artifact[]) => {
    pushed.current = true;
    setArtifacts(next);
    setLoadingArtifacts(false);
  }, []);

  // The relay re-lists and pushes after every turn, so this is only the first
  // paint — artifacts are listed live rather than mirrored, and the page render
  // does not carry them.
  const stream = useNotebookStream(notebook.id, initialEvents, showArtifacts, initialCursor);

  useEffect(() => {
    let cancelled = false;
    api
      .listArtifacts(notebook.id)
      .then((result) => {
        // This list is slow enough that a turn can end while it is in flight,
        // and what the relay pushed is then newer than what it returns.
        if (!cancelled && !pushed.current) setArtifacts(result.artifacts);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingArtifacts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notebook.id]);

  return (
    // The three panes float as cards on the page background rather than filling
    // it: the gap between them *is* the separator, so none of them carries a
    // divider of its own.
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
      <div className="flex shrink-0 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="text-muted hover:text-foreground text-sm">
            Notebooks
          </Link>
          <ChevronRight aria-hidden className="text-muted size-3.5 shrink-0" />
          <NotebookIcon name={notebook.icon} className="text-accent size-4 shrink-0" />
          <h1 className="truncate text-sm font-medium">{notebook.title}</h1>
        </div>

        <NotebookSettings
          notebook={notebook}
          onConversationReset={() => {
            // The old session is archived; its transcript and its artifacts
            // are gone. Reloading is the honest way to show that.
            window.location.reload();
          }}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <SourcesRail notebookId={notebook.id} sources={sources} onChange={setSources} />
        <ChatPane notebookId={notebook.id} stream={stream} hasSources={sources.length > 0} />
        <ArtifactsRail notebookId={notebook.id} artifacts={artifacts} loading={loadingArtifacts} />
      </div>
    </div>
  );
}
