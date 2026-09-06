import type { Artifact } from "@/lib/anthropic/files";
import type { Notebook } from "@/lib/firestore/notebooks";
import type { Source } from "@/lib/firestore/sources";

/**
 * Typed fetch wrappers for the browser.
 *
 * These are type-only imports of the server's shapes, so nothing server-side
 * is pulled into the bundle — the types are erased at build.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(body.error ?? `Request failed (${response.status}).`, response.status);
  }

  return (await response.json()) as T;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  createNotebook(input: {
    title: string;
    icon?: string;
    model?: string;
    customInstructions?: string;
  }) {
    return request<{ notebook: Notebook }>("/api/notebooks", json(input));
  },

  updateNotebook(id: string, input: Record<string, unknown>) {
    return request<{ notebook: Notebook; conversationReset: boolean }>(`/api/notebooks/${id}`, {
      ...json(input),
      method: "PATCH",
    });
  },

  deleteNotebook(id: string) {
    return request<{ ok: true }>(`/api/notebooks/${id}`, { method: "DELETE" });
  },

  sendMessage(id: string, text: string) {
    return request<{ ok: true; sessionId: string }>(
      `/api/notebooks/${id}/messages`,
      json({ text }),
    );
  },

  interrupt(id: string) {
    return request<{ ok: true }>(`/api/notebooks/${id}/interrupt`, {
      method: "POST",
    });
  },

  listSources(id: string) {
    return request<{ sources: Source[] }>(`/api/notebooks/${id}/sources`);
  },

  uploadSources(id: string, files: File[]) {
    const form = new FormData();
    for (const file of files) form.append("file", file);
    return request<{ sources: Source[] }>(`/api/notebooks/${id}/sources`, {
      method: "POST",
      body: form,
    });
  },

  deleteSource(id: string, sourceId: string) {
    return request<{ ok: true }>(`/api/notebooks/${id}/sources/${sourceId}`, {
      method: "DELETE",
    });
  },

  listArtifacts(id: string) {
    return request<{ artifacts: Artifact[] }>(`/api/notebooks/${id}/artifacts`);
  },

  artifactUrl(id: string, fileId: string) {
    return `/api/notebooks/${id}/artifacts/${fileId}`;
  },
};
