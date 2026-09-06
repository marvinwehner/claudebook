import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/dal";
import { listNotebooks } from "@/lib/notebooks/notebook-service";
import { AppNav } from "@/components/app-nav";
import { NotebookGrid } from "@/components/notebook-grid";

export default async function HomePage() {
  // The layout gate already ran, but a page renders concurrently with its
  // layout — so this repeats the check rather than assuming it. requireUser()
  // is the route-handler form and would throw here; getSessionUser is free the
  // second time because it is wrapped in React cache().
  const user = await getSessionUser();
  if (!user) redirect("/login");
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
