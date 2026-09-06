import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse, ValidationError } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";
import { addSource, listSources } from "@/lib/notebooks/source-service";

export async function GET(_request: Request, ctx: RouteContext<"/api/notebooks/[id]/sources">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);
    return NextResponse.json({ sources: await listSources(notebook) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Multipart upload. The client sends bytes and a filename and nothing else —
 * notably not a file_id, which Anthropic's own guidance says never to accept
 * from an end user.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/notebooks/[id]/sources">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    const form = await request.formData().catch(() => null);
    const files = form?.getAll("file").filter((entry): entry is File => entry instanceof File) ?? [];
    if (files.length === 0) {
      throw new ValidationError("Expected at least one file in a `file` form field.");
    }

    // Sequential on purpose: addSource checks for duplicate filenames and the
    // 500-source cap against the current index, and parallel uploads would race
    // each other past both.
    const added = [];
    for (const file of files) {
      added.push(await addSource(notebook, file));
    }

    return NextResponse.json({ sources: added }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
