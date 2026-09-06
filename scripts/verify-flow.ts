/**
 * Phase 5's verify, as a script: the whole notebook lifecycle against real
 * Firestore and the real Anthropic API, plus the ownership boundary.
 *
 *   npm run verify:flow
 *
 * This exercises the service layer, not the HTTP layer — it calls the same
 * functions the route handlers call, with a synthetic uid, so it needs no
 * session cookie. The HTTP surface still has to be walked in a browser once,
 * because that is the only way to prove the cookie and the SSE relay work.
 *
 * It creates and then deletes real objects, and real Anthropic calls cost real
 * money. Cheap — one small file, three short turns — but not free.
 */
import {
  createNotebook,
  deleteNotebook,
  listNotebooks,
  requireNotebook,
  updateNotebook,
} from "@/lib/notebooks/notebook-service";
import { addSource, listSources, removeSource } from "@/lib/notebooks/source-service";
import { downloadNotebookArtifact, listNotebookArtifacts } from "@/lib/notebooks/artifact-service";
import { NotFoundError } from "@/lib/notebooks/errors";
import { sendUserMessage } from "@/lib/anthropic/sessions";
import { anthropic } from "@/lib/anthropic/client";
import { isTurnComplete, normalizeEvent } from "@/lib/anthropic/events";

const OWNER = `verify-owner-${Date.now()}`;
const INTRUDER = `verify-intruder-${Date.now()}`;

const FILENAME = "orbit-log.md";
const SOURCE = `# Orbit Log

The Halden-3 probe completed 1,947 orbits before its transmitter failed.
Fuel reserves at failure were 12.4 kilograms.

This log does not record the probe's launch mass.
`;

const results: Array<[string, boolean, string?]> = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
}

/** Drains the session stream until the turn ends, returning the agent's text. */
async function ask(sessionId: string, text: string): Promise<string> {
  const [answer] = await Promise.all([
    (async () => {
      const stream = await anthropic().beta.sessions.events.stream(sessionId);
      let out = "";
      for await (const raw of stream) {
        const event = normalizeEvent(raw);
        if (!event) continue;
        if (event.kind === "message" && event.role === "agent") out += event.text;
        if (event.kind === "error") console.error(`  session error: ${event.message}`);
        if (isTurnComplete(event)) break;
      }
      return out;
    })(),
    // Stream-first: the stream only carries what happens after it opens.
    sendUserMessage(sessionId, text),
  ]);
  return answer;
}

async function main() {
  console.log(`owner=${OWNER}\n`);

  console.log("1. create");
  const notebook = await createNotebook(OWNER, {
    title: "Verify flow",
    icon: "🛰",
    model: "claude-sonnet-5",
  });
  check("notebook created with a session", Boolean(notebook.sessionId), String(notebook.sessionId));
  check(
    "notebook appears in its owner's list",
    (await listNotebooks(OWNER)).some((candidate) => candidate.id === notebook.id),
  );
  // Tracks the newest known state so the cleanup below works from any point.
  let latest = notebook;

  try {
    console.log("\n2. ownership boundary");
    check("another user's list does not include it", (await listNotebooks(INTRUDER)).length === 0);
    let intruderSaw404 = false;
    try {
      await requireNotebook(notebook.id, INTRUDER);
    } catch (error) {
      intruderSaw404 = error instanceof NotFoundError;
    }
    check("another user gets NotFound on a real id, not Forbidden", intruderSaw404);

    console.log("\n3. upload a source");
    const source = await addSource(
      notebook,
      new File([SOURCE], FILENAME, { type: "text/markdown" }),
    );
    check("source indexed and mounted", Boolean(source.sessionResourceId), source.mountPath);
    check("source listed", (await listSources(notebook)).length === 1);

    let duplicateRejected = false;
    try {
      await addSource(notebook, new File([SOURCE], FILENAME, { type: "text/markdown" }));
    } catch {
      duplicateRejected = true;
    }
    check("a second source with the same filename is rejected", duplicateRejected);

    console.log("\n4. ask a grounded question");
    const answer = await ask(notebook.sessionId!, "How many orbits did the probe complete?");
    console.log(`   ${answer.slice(0, 200).replace(/\n/g, " ")}`);
    check("answer contains 1,947", /1[,.]?947/.test(answer));
    check(`answer cites [${FILENAME}]`, answer.includes(FILENAME));

    console.log("\n5. ask for an artifact");
    await ask(notebook.sessionId!, "Write a short briefing document about this log.");
    const artifacts = await listNotebookArtifacts(notebook);
    check("an artifact was written and listed", artifacts.length > 0, `${artifacts.length}`);

    if (artifacts[0]) {
      const download = await downloadNotebookArtifact(notebook, artifacts[0].fileId);
      const body = download.body ? await new Response(download.body).text() : "";
      check("artifact downloads with content", body.length > 0, `${body.length} bytes`);

      let crossUserBlocked = false;
      try {
        // The intruder's own (nonexistent) notebook cannot resolve this file id.
        await downloadNotebookArtifact(
          { ...notebook, id: "nope", sessionId: null },
          artifacts[0].fileId,
        );
      } catch (error) {
        crossUserBlocked = error instanceof NotFoundError;
      }
      check("an artifact id from another notebook is refused", crossUserBlocked);
    }

    console.log("\n6. remove the source");
    await removeSource(notebook, source.id);
    check("source removed from the index", (await listSources(notebook)).length === 0);

    console.log("\n7. change the model");
    const updated = await updateNotebook(notebook, { model: "claude-opus-5" });
    latest = updated.notebook;
    check("model change resets the conversation", updated.conversationReset);
    check("model change clears the session id", updated.notebook.sessionId === null);
  } finally {
    // In a finally so a failure part-way through cannot leave a paid session,
    // an uploaded file and a Firestore document behind.
    console.log("\n8. delete");
    await deleteNotebook(latest).catch((error: unknown) => {
      console.error(`  CLEANUP FAILED - orphaned notebook ${latest.id}:`, error);
    });
  }

  check(
    "notebook is gone",
    (await listNotebooks(OWNER)).every((candidate) => candidate.id !== notebook.id),
  );

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
