import { requireUser } from "@/lib/auth/dal";
import { downloadNotebookArtifact } from "@/lib/notebooks/artifact-service";
import { toErrorResponse } from "@/lib/notebooks/errors";
import { requireNotebook } from "@/lib/notebooks/notebook-service";

/**
 * The filename is chosen by the agent, so it can be non-ASCII or contain
 * quotes — either would corrupt the header. RFC 5987's `filename*` carries the
 * real name; the quoted `filename` is an ASCII-only fallback.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii || "artifact"}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Proxied download. The file id is checked against this notebook's own session
 * before anything is fetched — Anthropic files are workspace-scoped, so an
 * unchecked id from the client would read another user's artifact.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/notebooks/[id]/artifacts/[fileId]">,
) {
  try {
    const user = await requireUser();
    const { id, fileId } = await ctx.params;
    const notebook = await requireNotebook(id, user.uid);

    const artifact = await downloadNotebookArtifact(notebook, fileId);

    return new Response(artifact.body, {
      headers: {
        "Content-Type": artifact.mimeType,
        "Content-Disposition": contentDisposition(artifact.filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
