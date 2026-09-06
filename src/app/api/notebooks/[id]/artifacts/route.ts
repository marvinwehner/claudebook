import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/dal";
import { listNotebookArtifacts } from "@/lib/notebooks/artifact-service";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";

export async function GET(_request: Request, ctx: RouteContext<"/api/notebooks/[id]/artifacts">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);
    return NextResponse.json({ artifacts: await listNotebookArtifacts(notebook) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
