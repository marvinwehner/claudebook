import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";
import { removeSource } from "@/lib/notebooks/source-service";

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/notebooks/[id]/sources/[sourceId]">,
) {
  try {
    const user = await requireUser();
    const { id, sourceId } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    await removeSource(notebook, sourceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
