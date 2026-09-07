"use client";

import {
  ArrowDownToLine,
  Eye,
  FileLetterP,
  FileLetterW,
  FileLetterX,
  FileText,
  LogoAcrobat,
  Sparkles,
} from "@gravity-ui/icons";
import {
  Button,
  buttonVariants,
  Link,
  Modal,
  Spinner,
  Tooltip,
  useOverlayState,
} from "@heroui/react";
import { useState } from "react";
import { Streamdown } from "streamdown";

import type { Artifact } from "@/lib/anthropic/files";
import { api } from "@/lib/api/client";

const PREVIEWABLE = /^(text\/|application\/json)/;

/**
 * A glyph per output format — enough to scan the list by shape, not a MIME
 * taxonomy. Keyed on the extension rather than the mime type: the agent names
 * the file, so the extension is the part we control.
 */
function artifactIcon(filename: string) {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "pptx") return FileLetterP;
  if (ext === "xlsx") return FileLetterX;
  if (ext === "docx") return FileLetterW;
  if (ext === "pdf") return LogoAcrobat;
  return FileText;
}

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
    // Otherwise the heading names the previous artifact while this one loads.
    setPreview(null);
    setPreviewing(true);
    state.open();
    try {
      const response = await fetch(api.artifactUrl(notebookId, artifact.fileId));
      // fetch does not reject on 4xx, so without this the error JSON would be
      // rendered as the artifact.
      if (!response.ok) throw new Error(`Artifact request failed (${response.status}).`);
      setPreview({ artifact, body: await response.text() });
    } catch {
      setPreview({ artifact, body: "_Could not load this artifact._" });
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <aside className="bg-surface shadow-surface flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles aria-hidden className="text-muted size-4" />
          Artifacts
        </h2>
        {loading ? (
          <Spinner size="sm" />
        ) : artifacts.length > 0 ? (
          <span className="text-muted text-xs">{artifacts.length}</span>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {artifacts.length === 0 && !loading ? (
          <li className="text-muted px-2 py-4 text-center text-xs">
            Documents the assistant writes — a briefing, a slide deck — appear here.
          </li>
        ) : null}

        {artifacts.map((artifact) => {
          const Icon = artifactIcon(artifact.filename);

          return (
            <li
              key={artifact.fileId}
              className="hover:bg-surface-secondary flex items-center gap-2 rounded-md px-2 py-1.5"
            >
              <Icon aria-hidden className="text-muted size-4 shrink-0" />
              <p className="min-w-0 flex-1 truncate text-xs font-medium" title={artifact.filename}>
                {artifact.filename}
              </p>

              {PREVIEWABLE.test(artifact.mimeType) ? (
                <Tooltip>
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label={`Preview ${artifact.filename}`}
                    onPress={() => void open(artifact)}
                  >
                    <Eye aria-hidden />
                  </Button>
                  <Tooltip.Content>Preview</Tooltip.Content>
                </Tooltip>
              ) : null}

              {/* Still an anchor, so the browser's own download handling applies —
                  the route sets Content-Disposition. React Aria skips client
                  routing for any link carrying `download`, so `Link` keeps that.
                  It wears the button's shape through `buttonVariants`, which is
                  what link.css's `.link.button` rule exists for. */}
              <Tooltip>
                <Link
                  href={api.artifactUrl(notebookId, artifact.fileId)}
                  download={artifact.filename}
                  aria-label={`Download ${artifact.filename}`}
                  className={buttonVariants({ isIconOnly: true, size: "sm", variant: "ghost" })}
                >
                  <ArrowDownToLine aria-hidden />
                </Link>
                <Tooltip.Content>Download</Tooltip.Content>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <Modal state={state}>
        <Modal.Backdrop>
          <Modal.Container size="lg" scroll="inside">
            <Modal.Dialog className="md:max-w-[70vw]">
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
