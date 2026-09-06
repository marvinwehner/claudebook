"use client";

import { AlertDialog, Button, ListBox, Select, useOverlayState } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DEFAULT_MODEL, NOTEBOOK_MODELS, OPUS_MODEL } from "@/lib/anthropic/agent";
import { api, ApiError } from "@/lib/api/client";
import type { Notebook } from "@/lib/firestore/notebooks";

const MODEL_LABELS: Record<string, string> = {
  [DEFAULT_MODEL]: "Sonnet 5",
  [OPUS_MODEL]: "Opus 5",
};

/**
 * A session's model is fixed at create time, so switching models means starting
 * a new session — the sources are re-mounted, but the conversation does not
 * survive. That is destructive enough to sit behind a confirm that says so.
 */
export function NotebookSettings({
  notebook,
  onConversationReset,
}: {
  notebook: Notebook;
  onConversationReset: () => void;
}) {
  const router = useRouter();
  const confirmModel = useOverlayState();
  const confirmDelete = useOverlayState();

  const [pendingModel, setPendingModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function applyModel() {
    if (!pendingModel) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateNotebook(notebook.id, { model: pendingModel });
      confirmModel.close();
      onConversationReset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not change the model.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteNotebook(notebook.id);
      router.push("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not delete the notebook.");
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Model"
        className="w-36"
        selectedKey={notebook.model}
        onSelectionChange={(key) => {
          if (String(key) === notebook.model) return;
          setPendingModel(String(key));
          confirmModel.open();
        }}
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {NOTEBOOK_MODELS.map((id) => (
              <ListBox.Item key={id} id={id} textValue={MODEL_LABELS[id]}>
                {MODEL_LABELS[id]}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Button size="sm" variant="ghost" onPress={confirmDelete.open}>
        Delete
      </Button>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={confirmModel.isOpen} onOpenChange={confirmModel.setOpen}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>Start a fresh conversation?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm">
                  A notebook&rsquo;s model is fixed for the life of its conversation, so switching
                  to <strong>{pendingModel ? MODEL_LABELS[pendingModel] : ""}</strong> starts a new
                  one.
                </p>
                <p className="text-muted mt-2 text-sm">
                  Your sources are re-attached automatically. The messages so far are not carried
                  over.
                </p>
                {error ? (
                  <p role="alert" className="text-danger mt-2 text-sm">
                    {error}
                  </p>
                ) : null}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="tertiary" onPress={confirmModel.close}>
                  Keep {MODEL_LABELS[notebook.model]}
                </Button>
                <Button variant="primary" isPending={busy} onPress={applyModel}>
                  Switch and start fresh
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={confirmDelete.isOpen} onOpenChange={confirmDelete.setOpen}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>Delete {notebook.title}?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm">
                  This deletes the conversation, every source you uploaded, and everything the
                  assistant wrote. It cannot be undone.
                </p>
                {error ? (
                  <p role="alert" className="text-danger mt-2 text-sm">
                    {error}
                  </p>
                ) : null}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="tertiary" onPress={confirmDelete.close}>
                  Cancel
                </Button>
                <Button variant="danger" isPending={busy} onPress={remove}>
                  Delete notebook
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
