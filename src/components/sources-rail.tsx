"use client";

import {
  ArrowUpFromLine,
  File,
  FileCode,
  FileText,
  Files,
  Paperclip,
  Picture,
  Xmark,
} from "@gravity-ui/icons";
import { Button, Spinner } from "@heroui/react";
import { useState } from "react";
import { DropZone, FileTrigger } from "react-aria-components";

import { api, ApiError } from "@/lib/api/client";
import type { Source } from "@/lib/firestore/sources";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A glyph per broad file family — enough to scan the list by shape, not a MIME taxonomy. */
function sourceIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Picture;
  if (mimeType === "application/json" || mimeType.startsWith("text/x-")) return FileCode;
  if (mimeType.startsWith("text/") || mimeType === "application/pdf") return FileText;
  return File;
}

/**
 * Upload uses `DropZone` + `FileTrigger` from react-aria-components, which is a
 * direct dependency of @heroui/react — HeroUI v3 has no upload component and
 * never had one, but these are the primitives it is built on, so they are
 * version-aligned by construction.
 */
export function SourcesRail({
  notebookId,
  sources,
  onChange,
}: {
  notebookId: string;
  sources: Source[];
  onChange: (sources: Source[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: File[]) {
    if (files.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.uploadSources(notebookId, files);
      onChange([...sources, ...result.sources]);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Upload failed.");
      // Re-sync: a multi-file upload is sequential server-side, so some may
      // have landed before the failure.
      await api
        .listSources(notebookId)
        .then((result) => onChange(result.sources))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function remove(source: Source) {
    const previous = sources;
    onChange(sources.filter((candidate) => candidate.id !== source.id));
    try {
      await api.deleteSource(notebookId, source.id);
    } catch {
      onChange(previous);
      setError(`Could not remove ${source.filename}.`);
    }
  }

  return (
    <aside className="bg-surface shadow-surface flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Files aria-hidden className="text-muted size-4" />
          Sources
        </h2>
        <span className="text-muted text-xs">{sources.length}</span>
      </div>

      <div className="px-4 pb-3">
        <DropZone
          className="border-border data-[drop-target]:border-accent data-[drop-target]:bg-accent-soft flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-5 text-center transition-colors"
          onDrop={async (event) => {
            const files = await Promise.all(
              event.items
                .filter((item) => item.kind === "file")
                .map((item) => (item as { getFile: () => Promise<File> }).getFile()),
            );
            void upload(files);
          }}
        >
          <ArrowUpFromLine aria-hidden className="text-muted size-4" />
          <p className="text-muted text-xs">Drop files here</p>
          <FileTrigger allowsMultiple onSelect={(list) => void upload(list ? [...list] : [])}>
            <Button size="sm" variant="secondary" isPending={busy}>
              <Paperclip aria-hidden />
              Choose files
            </Button>
          </FileTrigger>
        </DropZone>

        {error ? (
          <p role="alert" className="text-danger mt-2 text-xs">
            {error}
          </p>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {sources.length === 0 && !busy ? (
          <li className="text-muted px-2 py-4 text-center text-xs">
            No sources yet. The assistant can only answer from what you add here.
          </li>
        ) : null}

        {busy ? (
          <li className="text-muted flex items-center gap-2 px-2 py-2 text-xs">
            <Spinner size="sm" />
            Uploading…
          </li>
        ) : null}

        {sources.map((source) => {
          const Icon = sourceIcon(source.mimeType);

          return (
            <li
              key={source.id}
              className="hover:bg-surface-secondary group flex items-start gap-2 rounded-md px-2 py-2"
            >
              <Icon aria-hidden className="text-muted mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium" title={source.filename}>
                  {source.filename}
                </p>
                <p className="text-muted text-[11px]">{formatSize(source.sizeBytes)}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label={`Remove ${source.filename}`}
                className="opacity-0 group-hover:opacity-100"
                onPress={() => void remove(source)}
              >
                <Xmark aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
