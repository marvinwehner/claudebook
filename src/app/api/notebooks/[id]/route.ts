import { NextResponse } from "next/server";
import { z } from "zod";

import { NOTEBOOK_MODELS } from "@/lib/anthropic/agent";
import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import {
  deleteNotebook,
  requireNotebook,
  updateNotebook,
} from "@/lib/notebooks/notebook-service";

const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    icon: z.string().max(8).optional(),
    model: z.enum(NOTEBOOK_MODELS).optional(),
    customInstructions: z.string().max(20_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

export async function GET(_request: Request, ctx: RouteContext<"/api/notebooks/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    return NextResponse.json({ notebook: await requireNotebook(id, user.uid) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/notebooks/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body." }, { status: 400 });
    }

    const result = await updateNotebook(notebook, parsed.data);
    return NextResponse.json({
      notebook: result.notebook,
      // The client shows a confirm before sending this, but say plainly what
      // happened so the UI can clear the transcript it is holding.
      conversationReset: result.conversationReset,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/notebooks/[id]">) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    await deleteNotebook(notebook);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
