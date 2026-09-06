"use client";

import { BookOpen, Plus } from "@gravity-ui/icons";
import {
  Button,
  Card,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  Select,
  TextArea,
  TextField,
  useOverlayState,
} from "@heroui/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DEFAULT_MODEL, NOTEBOOK_MODELS, OPUS_MODEL } from "@/lib/anthropic/agent";
import { api, ApiError } from "@/lib/api/client";
import type { Notebook } from "@/lib/firestore/notebooks";
import { DEFAULT_NOTEBOOK_ICON } from "@/lib/notebook-icons";
import { IconPicker } from "@/components/icon-picker";
import { NotebookIcon } from "@/components/notebook-icon";

const MODEL_LABELS: Record<string, string> = {
  [DEFAULT_MODEL]: "Sonnet 5 — fast, the default",
  [OPUS_MODEL]: "Opus 5 — slower, better at hard questions",
};

// A fixed locale, not the runtime default: the server's default is en-US and the
// browser's is the visitor's own, so `undefined` here renders "Sep 6, 2026" into the
// HTML and "6 Sept 2026" on hydration. The UI is English-only, so pin it.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function NotebookGrid({ initialNotebooks }: { initialNotebooks: Notebook[] }) {
  const router = useRouter();
  const state = useOverlayState();

  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<string>(DEFAULT_NOTEBOOK_ICON);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { notebook } = await api.createNotebook({
        title,
        icon,
        model,
        customInstructions: instructions || undefined,
      });
      state.close();
      router.push(`/notebooks/${notebook.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create the notebook.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Notebooks</h1>
          <p className="text-muted mt-1 text-sm">
            {initialNotebooks.length === 0
              ? "Nothing here yet."
              : `${initialNotebooks.length} notebook${initialNotebooks.length === 1 ? "" : "s"}.`}
          </p>
        </div>

        <Modal state={state}>
          <Button variant="primary" onPress={state.open}>
            <Plus aria-hidden />
            New notebook
          </Button>

          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>New notebook</Modal.Heading>
                </Modal.Header>

                <Modal.Body className="flex flex-col gap-4">
                  <div className="flex gap-3">
                    <IconPicker value={icon} onChange={setIcon} />

                    <TextField className="flex-1" value={title} onChange={setTitle} isRequired>
                      <Label>Title</Label>
                      <Input autoFocus placeholder="Q3 research" />
                    </TextField>
                  </div>

                  <Select selectedKey={model} onSelectionChange={(key) => setModel(String(key))}>
                    <Label>Model</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Description>
                      Fixed once the notebook exists — changing it later starts a fresh
                      conversation.
                    </Description>
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

                  <TextField value={instructions} onChange={setInstructions}>
                    <Label>Custom instructions</Label>
                    <TextArea
                      rows={3}
                      placeholder="Optional. How should the assistant approach these sources?"
                    />
                  </TextField>

                  {error ? (
                    <p role="alert" className="text-danger text-sm">
                      {error}
                    </p>
                  ) : null}
                </Modal.Body>

                <Modal.Footer>
                  <Button variant="tertiary" onPress={state.close}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    isDisabled={!title.trim()}
                    isPending={busy}
                    onPress={create}
                  >
                    Create
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </div>

      {initialNotebooks.length === 0 ? (
        <Card className="border-border border border-dashed p-10 text-center">
          <div className="bg-surface-secondary text-muted mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl">
            <BookOpen aria-hidden className="size-5" />
          </div>
          <p className="font-medium">Start your first notebook</p>
          <p className="text-muted mx-auto mt-1 max-w-sm text-sm">
            Upload sources, then ask questions the assistant answers from them and cites.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialNotebooks.map((notebook) => (
            <li key={notebook.id}>
              <Link href={`/notebooks/${notebook.id}`} className="block h-full">
                <Card className="hover:border-accent h-full p-5 transition-colors">
                  <div className="bg-accent-soft text-accent-soft-foreground flex size-10 items-center justify-center rounded-2xl">
                    <NotebookIcon name={notebook.icon} className="size-5" />
                  </div>
                  <p className="mt-3 line-clamp-2 font-medium">{notebook.title}</p>
                  <p className="text-muted mt-1 text-xs">
                    {notebook.lastMessageAt
                      ? `Last message ${formatDate(notebook.lastMessageAt)}`
                      : `Created ${formatDate(notebook.createdAt)}`}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
