import { NextResponse } from "next/server";

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/dal";

/**
 * "Not found" covers both a missing notebook and one owned by someone else.
 * Never 403 on the second case — that confirms the id exists.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** The request is well-formed but the notebook is in the wrong state for it. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  // Admin endpoints only. Never throw this from a notebook path — NotFoundError
  // is the answer there, because a 403 confirms the id exists.
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  // Anything else is ours to fix: log it server-side, tell the client nothing.
  console.error("Unhandled route error:", error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
