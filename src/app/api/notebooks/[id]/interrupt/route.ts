import { NextResponse } from "next/server";

import { interrupt } from "@/lib/anthropic/sessions";
import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";

/**
 * An interrupt jumps the queue and forces the session idle. It does not
 * rehydrate: if there is no session there is nothing running to stop.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/notebooks/[id]/interrupt">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    if (notebook.sessionId) {
      await interrupt(notebook.sessionId);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
