import { NextResponse } from "next/server";
import { z } from "zod";

import { NOTEBOOK_MODELS } from "@/lib/anthropic/agent";
import { requireUser } from "@/lib/auth/dal";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { createNotebook, listNotebooks } from "@/lib/notebooks/notebook-service";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  icon: z.string().max(8).optional(),
  model: z.enum(NOTEBOOK_MODELS).optional(),
  customInstructions: z.string().max(20_000).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ notebooks: await listNotebooks(user.uid) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Expected { title, icon?, model?, customInstructions? }." },
        { status: 400 },
      );
    }

    const notebook = await createNotebook(user.uid, parsed.data);
    return NextResponse.json({ notebook }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
