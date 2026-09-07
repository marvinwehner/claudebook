import { notFound, redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/dal";
import { NotFoundError } from "@/lib/notebooks/errors";
import { lifetimeUsage, requireNotebook } from "@/lib/notebooks/notebook-service";
import { listSources } from "@/lib/notebooks/source-service";
import { loadTranscript } from "@/lib/notebooks/transcript-service";
import { AppNav } from "@/components/app-nav";
import { NotebookWorkspace } from "@/components/notebook-workspace";

export default async function NotebookPage({ params }: PageProps<"/notebooks/[id]">) {
  // Pages render concurrently with their layout, so the gate is repeated here
  // rather than assumed. Free the second time — getSessionUser is cached.
  const user = await getSessionUser();
  if (!user) redirect("/login");

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
      <AppNav user={user} />
      <NotebookWorkspace
        notebook={notebook}
        initialSources={sources}
        initialEvents={transcript.events}
        initialCursor={transcript.cursor}
        initialUsage={lifetimeUsage(notebook)}
      />
    </div>
  );
}
