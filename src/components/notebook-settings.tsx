"use client";

import { TrashBin } from "@gravity-ui/icons";
import { AlertDialog, Button, useOverlayState } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/api/client";
import type { Notebook } from "@/lib/firestore/notebooks";

export function NotebookSettings({ notebook }: { notebook: Notebook }) {
  const router = useRouter();
  const confirmDelete = useOverlayState();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      {/*
        The root is React Aria's DialogTrigger, which always wraps its children in a
        PressResponder and warns on mount if none of them is pressable. Keeping the
        button that opens this dialog inside the root satisfies that. The open state
        stays on the Backdrop on purpose: the trigger's onPress is merged into every
        pressable below it, so driving the root would let "Delete notebook" close the
        dialog before remove() resolves, hiding the error this body renders.
      */}
      <AlertDialog>
        <Button size="sm" variant="ghost" onPress={confirmDelete.open}>
          <TrashBin aria-hidden />
          Delete
        </Button>

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
