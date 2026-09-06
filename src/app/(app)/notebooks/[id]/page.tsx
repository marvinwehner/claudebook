import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/dal";
import { NotFoundError } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";
import { listSources } from "@/lib/notebooks/source-service";
import { loadTranscript } from "@/lib/notebooks/transcript-service";
import { AppNav } from "@/components/app-nav";
import { NotebookWorkspace } from "@/components/notebook-workspace";

export default async function NotebookPage({ params }: PageProps<"/notebooks/[id]">) {
  const user = await requireUser();
  const { id } = await params;

  let notebook;
  try {
    notebook = await requireNotebook(id, user.uid);
  } catch (error) {
    // Someone else's notebook is indistinguishable from a missing one, by
    // design — a 403 would confirm the id exists.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Sources and transcript in parallel: neither needs the other, and the
  // transcript is the slower of the two.
  const [sources, transcript] = await Promise.all([
    listSources(notebook),
    loadTranscript(notebook),
  ]);

  return (
    <div className="flex h-dvh flex-col">
      <AppNav email={user.email} />
      <NotebookWorkspace
        notebook={notebook}
        initialSources={sources}
        initialEvents={transcript.events}
      />
    </div>
  );
}
