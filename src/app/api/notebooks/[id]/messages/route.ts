import { NextResponse } from "next/server";
import { z } from "zod";

import { sendUserMessage } from "@/lib/anthropic/sessions";
import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import {
  clearSeedNote,
  liveSession,
  markMessageSent,
  requireNotebook,
} from "@/lib/notebooks/notebook-service";

const bodySchema = z.object({ text: z.string().min(1).max(100_000) });

/**
 * Sending is separate from streaming: events queue server-side, so there is no
 * need to wait for the session to be idle before posting the next message.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/notebooks/[id]/messages">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { text }." }, { status: 400 });
    }

    const { session, seedNote } = await liveSession(notebook);

    // A pending rehydration note can only be delivered alongside a user
    // message, so this is the moment it goes out.
    await sendUserMessage(session.id, parsed.data.text, seedNote);
    if (seedNote) await clearSeedNote(notebook.id);
    await markMessageSent(notebook.id);

    return NextResponse.json({ ok: true, sessionId: session.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
