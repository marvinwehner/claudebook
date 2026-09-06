"use client";

import { Button, Modal, Spinner, useOverlayState } from "@heroui/react";
import { useState } from "react";
import { Streamdown } from "streamdown";

import type { Artifact } from "@/lib/anthropic/files";
import { api } from "@/lib/api/client";

const PREVIEWABLE = /^(text\/|application\/json)/;

export function ArtifactsRail({
  notebookId,
  artifacts,
  loading,
}: {
  notebookId: string;
  artifacts: Artifact[];
  loading: boolean;
}) {
  const state = useOverlayState();
  const [preview, setPreview] = useState<{
    artifact: Artifact;
    body: string;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  async function open(artifact: Artifact) {
    setPreviewing(true);
    state.open();
    try {
      const response = await fetch(api.artifactUrl(notebookId, artifact.fileId));
      setPreview({ artifact, body: await response.text() });
    } catch {
      setPreview({ artifact, body: "_Could not load this artifact._" });
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <aside className="border-border bg-surface flex w-72 shrink-0 flex-col border-l">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold">Artifacts</h2>
        {loading ? (
          <Spinner size="sm" />
        ) : (
          <span className="text-muted text-xs">{artifacts.length}</span>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {artifacts.length === 0 && !loading ? (
          <li className="text-muted px-2 py-4 text-center text-xs">
            Documents the assistant writes — a briefing, a study guide — appear here.
          </li>
        ) : null}

        {artifacts.map((artifact) => (
          <li key={artifact.fileId} className="hover:bg-surface-secondary rounded-md px-2 py-2">
            <p className="truncate text-xs font-medium" title={artifact.filename}>
              {artifact.filename}
            </p>
            <div className="mt-1 flex gap-1">
              {PREVIEWABLE.test(artifact.mimeType) ? (
                <Button size="sm" variant="ghost" onPress={() => void open(artifact)}>
                  Preview
                </Button>
              ) : null}
              {/* A plain link, so the browser's own download handling applies —
                  the route sets Content-Disposition. */}
              <a
                href={api.artifactUrl(notebookId, artifact.fileId)}
                download={artifact.filename}
                className="text-accent px-2 py-1 text-xs hover:underline"
              >
                Download
              </a>
            </div>
          </li>
        ))}
      </ul>

      <Modal state={state}>
        <Modal.Backdrop>
          <Modal.Container size="lg" scroll="inside">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>{preview?.artifact.filename ?? "Artifact"}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {previewing ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : (
                  <Streamdown className="claudebook-markdown" mode="static">
                    {preview?.body ?? ""}
                  </Streamdown>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" onPress={state.close}>
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </aside>
  );
}
