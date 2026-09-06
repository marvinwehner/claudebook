import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";
import { loadTranscript } from "@/lib/notebooks/transcript-service";

/**
 * The transcript, for a client that needs to re-sync. The server component
 * paints the first one from the same loader.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/notebooks/[id]/events">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    const transcript = await loadTranscript(notebook);
    return NextResponse.json({ ...transcript, sessionId: notebook.sessionId });
  } catch (error) {
    return toErrorResponse(error);
  }
}
