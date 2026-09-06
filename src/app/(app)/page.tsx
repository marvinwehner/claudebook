import { requireUser } from "@/lib/auth/dal";
import { listNotebooks } from "@/lib/notebooks/notebook-service";
import { AppNav } from "@/components/app-nav";
import { NotebookGrid } from "@/components/notebook-grid";

export default async function HomePage() {
  // The layout already gated this; requireUser here is for the uid, and it is
  // free — getSessionUser is wrapped in React cache().
  const user = await requireUser();
  const notebooks = await listNotebooks(user.uid);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppNav email={user.email} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <NotebookGrid initialNotebooks={notebooks} />
      </main>
    </div>
  );
}
