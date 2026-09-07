import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/dal";
import { invite, listAccess, revoke } from "@/lib/auth/allowlist-service";
import { toErrorResponse } from "@/lib/notebooks/errors";

/**
 * Managing who may sign in. Admin only — `requireAdmin()` opens every handler,
 * and a 403 here leaks nothing, unlike on a notebook path where 404 is the
 * answer (see `notebooks/errors.ts`).
 *
 * The address travels in the body on DELETE rather than in a path segment.
 * Cloud Logging records the full request path, and an invited user's address in
 * a log line is exactly the leak docs/TASKS.md already treats as a blocker.
 */

const emailSchema = z.object({ email: z.string().min(1).max(320) });

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await listAccess());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = emailSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { email }." }, { status: 400 });
    }

    const allowedUser = await invite(admin, parsed.data.email);
    return NextResponse.json({ allowedUser }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();

    const parsed = emailSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Expected { email }." }, { status: 400 });
    }

    await revoke(parsed.data.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
