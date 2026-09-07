# Claudebook — a NotebookLM clone on Next.js + Firebase App Hosting + Anthropic Managed Agents

## Context

There is nothing to build on yet: an empty GitHub repo (`mavonic/claudebook`, one commit), an empty
Firebase project (`claudebook-lm`), and an empty Anthropic workspace with a working API key.

The goal is a private, invite-only NotebookLM clone: sign in with Google, create notebooks, upload
sources into a notebook, chat with an agent grounded in those sources, and collect the artifacts it
produces. Instead of building a retrieval pipeline and an LLM loop, **each notebook is backed by an
Anthropic Managed Agents session** — Anthropic runs the agent loop and hosts a per-session container
where the sources are mounted and the agent's tools (`read`, `grep`, `glob`, `bash`, `write`,
`web_search`) execute. That turns "build a RAG app" into "build a good UI over a session", which is
where the leverage is.

---

## Research findings that shape the design

Everything below was verified against the live API or current docs, not recalled. Several findings
contradict what a 2025-era tutorial would tell you.

### Anthropic

| Claudebook concept         | Anthropic object                                 | Cardinality                      |
| -------------------------- | ------------------------------------------------ | -------------------------------- |
| Notebook behaviour/persona | **Agent** (`/v1/agents`)                         | **one, shared, versioned**       |
| Sandbox template           | **Environment** (`/v1/environments`)             | **one, shared**                  |
| A notebook                 | **Session** (`/v1/sessions`)                     | **one per notebook**, long-lived |
| A source                   | Files API upload + `sessions.resources.add`      | ≤ 500 per session                |
| Chat transcript            | session event history                            | —                                |
| An artifact                | file the agent writes to `/mnt/session/outputs/` | —                                |

- Managed Agents beta is **live on this workspace** (`GET /v1/agents` → `200 {"data":[]}`).
- **One deliberate deviation from the brief — verified, not assumed.** You asked for an Agent _and_
  Environment per notebook. The isolation you want is already guaranteed by the **Session**. Verbatim
  from the environments doc: _"Multiple sessions can share the same environment, but each session gets
  its own isolated sandbox (a fresh Linux container)"_ and _"Sessions do not share filesystem state."_
  Three further facts make one-environment-per-notebook actively worse: environments are **not
  versioned**; an environment can only be **deleted if no session references it**, so per-notebook
  environments accumulate as permanently undeletable objects; and `packages` are **cached across
  sessions sharing an environment**, so sharing is faster. For Agents, creating one per run is an
  explicitly documented anti-pattern (orphaned objects, create latency, defeats versioning).
  Per-notebook variation (model, custom instructions) uses `agent_with_overrides` at session-create —
  session-local, creates no new agent version.
  _If a notebook ever needs different packages or a locked-down `networking` policy, that is the one
  reason to add a second named environment — a per-profile environment, still not per-notebook._
- `client.files.upload({ file })` — the Files API is **out of beta** and has **no `purpose` parameter**
  (docs that mention `purpose: "agent"` / `"agent_resource"` are stale).
- `mount_path: "/sources/x.pdf"` lands at `/mnt/session/uploads/sources/x.pdf`, **read-only**.
  Session-scoped copies do not count against storage quota.
- **Files can be added to and removed from a _running_ session**: `sessions.resources.add(sessionId,
{type:'file', file_id})` → `sesrsc_…`; `sessions.resources.delete(resourceId, {session_id})`.
- **Uploaded files are not downloadable** (`downloadable: false`) — only agent-written outputs are.
  Hence the "Anthropic Files only" decision: no in-app source viewer.
- Outputs: `client.beta.files.list({ scope_id: sessionId, betas: ['managed-agents-2026-04-01'] })`
  then `client.files.download(id)`. Indexing lags the idle event a few seconds — retry once or twice.
- **Files are workspace-scoped, not user-scoped.** Anthropic's docs: _"Never accept `file_id` values
  from end users."_ Ownership is ours to enforce, in Firestore, server-side, on every request.
- SSE has **no replay**. `GET /v1/sessions/{id}/events` accepts (probed live against the API):
  `created_at[gt|gte|lt|lte]`, `limit`, `order`, `page`, `types[]` — so resume-after-disconnect is a
  cheap timestamp query, and we can subscribe to only the event types we render.
- `GET /v1/sessions` filters by `agent_id`, `statuses[]`, `created_at[…]` — **no metadata filter**, so
  Firestore must be the user→notebook→session index.
- Turn-complete gate: `session.status_idle` where `stop_reason.type !== 'requires_action'`.
- Cost: tokens + web search + **$0.08/h of _active_ time only**. Idle notebooks cost nothing.

### Firebase / Next.js / App Hosting

- **`claudebook-lm` is on the Spark plan — billing is not enabled.** App Hosting needs Blaze. **This
  blocks deployment** and is fixable only in the console.
- Not yet enabled: `firestore`, `firebaseapphosting`, `secretmanager`, `cloudbuild`, `run`,
  `developerconnect`, `artifactregistry`, `iamcredentials`. No web app registered. No Firestore db.
- **App Hosting is GA and is the right product.** Classic Hosting's framework support is still an
  unsupported preview **and it buffers streaming responses** (firebase-tools#9774) — disqualifying.
- **The request timeout is 5 minutes and is not configurable** — no such field in the docs, the CLI's
  `RunConfig` type, or the API type. SSE must be built to be cut and resumed.
- **App Hosting does not support Next.js Proxy (v16's `middleware.ts`) or Cache Components.** So: no
  `proxy.ts`, and don't enable `cacheComponents`. Auth gating moves into server components — which is
  where Next's own docs want it anyway, since Server Functions bypass proxy matchers regardless.
- Every open SSE connection holds a Cloud Run **concurrency slot** for its lifetime → set
  `concurrency: 20`, `maxInstances: 10`, or long streams starve normal SSR.
- Secrets are **pinned at build time**: rotating one needs a new rollout, not just a `secrets:set`.
- Console-set env vars **silently override** `apphosting.yaml` — use the YAML only.
- A **lock file is mandatory** or the build fails; `engines.node` must match the chosen runtime.
- `firebase apphosting:backends:create` **opens a browser** for the Developer Connect / GitHub App
  authorization; `--non-interactive` skips the repo link entirely. This is the one unavoidable click.
- Region note: Google warns `us-central1` has slow Cloud Run provisioning. `europe-west4` is supported
  and closest to the repo owner (Germany) → use it, with Firestore in `eur3`. Region is **immutable** after creation.

### Auth

- Session cookies (`createSessionCookie`) beat bearer tokens here: a cookie rides document navigations,
  so server components can gate rendering. `next-firebase-auth-edge` exists to work around the old
  Edge-runtime limitation and is no longer needed — skip it.
- `initializeApp()` picks up ADC on App Hosting; no service-account JSON anywhere.
- **One-time IAM gotcha:** minting a session cookie under ADC signs remotely via `signBlob`, so
  `firebase-app-hosting-compute@claudebook-lm.iam.gserviceaccount.com` needs
  `roles/iam.serviceAccountTokenCreator` **on itself**, plus `iamcredentials.googleapis.com`.
  Verifying needs no extra IAM — only minting does.
- `signInWithPopup`, not `signInWithRedirect` (redirect depends on a third-party-cookie iframe).
- Auth blocking functions would force an **irreversible** Identity Platform upgrade — not worth it.

### UI

- **HeroUI v3 (3.2.4) is a ground-up rewrite** and every v2 tutorial is wrong for it: no
  `HeroUIProvider`, no `tailwind.config.js` plugin, no Framer Motion. Setup is CSS-first
  (`@import "tailwindcss"; @import "@heroui/styles";`), requires React 19 + Tailwind 4, and is built on
  React Aria Components. `onPress` not `onClick`; `useOverlayState` not `useDisclosure`.
- **Removed in v3: `Navbar`.** Never existed: sidebar, file upload, resizable panels. Upload uses
  `DropZone` + `FileTrigger` from `react-aria-components`, which is already a required peer of
  `@heroui/react` — so it is version-aligned by construction, not a new dependency risk.
- Reference: the official `heroui-inc/next-app-template` (Next 16 + HeroUI v3 + Tailwind 4).
- Local node is 22.15.1; `heroui-cli` needs ≥22.22.0. Irrelevant — we install the two packages
  directly and never invoke the CLI.

### Decisions the repo owner made

1. Sources: **Anthropic Files API only** — no second copy, no in-app source viewer.
2. Scope: **Core** — notebooks + chat + sources + artifacts.
3. CI/CD: **App Hosting native GitHub trigger**.
4. Model: **Sonnet 5 default, Opus 5 opt-in per notebook**, no session budget.

### Decisions made during planning, with reasons

- **Next.js 16.3.x**, not 15.x. Firebase's own version table is stale, but their March 2026 post calls
  the Next 16.2 Deployment Adapter API "our new baseline for stability" for App Hosting. The two
  unsupported features (Proxy, Cache Components) are ones we actively don't want.
- **`streamdown` for chat markdown.** We opt into live previews (`event_deltas: ['agent.message']`), so
  the renderer receives _incomplete_ markdown — half-open code fences, dangling `**`. Streamdown repairs
  that and memoises per block; hand-rolling it goes badly. Cost: ~30 lines of CSS mapping its
  shadcn-style tokens onto HeroUI's. Skip `@streamdown/code`/shiki until code blocks actually matter.
- **The browser never talks to Firestore or Anthropic directly.** It holds a Firebase Auth session
  cookie and calls our routes. Consequences: the Anthropic key never leaves the server, no `file_id`
  is ever accepted from a client, `firestore.rules` becomes a flat default-deny, and we ship
  `firebase/auth` to the browser but not `firebase/firestore`.

---

## Architecture

```
Browser ──__session cookie──► Next.js on Cloud Run (App Hosting, europe-west4)
  │                             │  server layout   → requireUser() or redirect('/login')
  │                             │  lib/auth/dal    → verifySessionCookie + access     ◄── EVERY handler
  │                             │  lib/notebooks/  → domain services
  │                             ├──► Firestore (Admin SDK)  notebooks + source index  [ownership truth]
  │                             └──► Anthropic API          agent, environment, sessions, files
  └──EventSource───────────────► GET /api/notebooks/:id/stream   (SSE relay, resumable)
```

### Layering

| Layer             | Path                      | Responsibility                                                     |
| ----------------- | ------------------------- | ------------------------------------------------------------------ |
| Route handlers    | `src/app/api/**/route.ts` | HTTP only: auth, zod-validate, call a service, map errors          |
| Services          | `src/lib/notebooks/*.ts`  | Domain logic; the only place Firestore and Anthropic combine       |
| Repositories      | `src/lib/firestore/*.ts`  | Typed Firestore access + converters                                |
| Anthropic gateway | `src/lib/anthropic/*.ts`  | Thin typed wrapper over the SDK; provisioning; event normalisation |
| Auth              | `src/lib/auth/*.ts`       | `server-only` DAL, access rules, session cookie mint/verify        |

Rule: a route handler never imports the Anthropic SDK or `firebase-admin` directly.

### Data model (Firestore)

```
notebooks/{notebookId}
  ownerId, title, icon, model, customInstructions?,
  sessionId, agentVersion, sessionStatus,
  usage { retired, current, currentSessionId },
  createdAt, updatedAt, lastMessageAt

notebooks/{notebookId}/sources/{sourceId}
  filename, mimeType, sizeBytes, mountPath,
  anthropicFileId, sessionResourceId, status, createdAt

allowedUsers/{normalizedEmail}          ◄── the email IS the doc id
  email, invitedByEmail, invitedByUid, createdAt
```

Artifacts are **not** mirrored — they are listed live from `files.list({ scope_id })`. One less thing
to keep in sync. Index: `notebooks` on `(ownerId ASC, updatedAt DESC)`.

`usage` is the one thing that _must_ be mirrored, for the opposite reason: Anthropic meters per
session, and a notebook outlives its sessions. `retired` is what dead sessions came to, `current`
is the live session's own cumulative total, and the displayed figure is the sum. See Phase 9.

### `ensureSession(notebook)` — the single choke point

Every chat / source / artifact call goes through it:

1. Read `sessionId` from Firestore, `sessions.retrieve` it.
2. If missing or `terminated` → **rehydrate**: create a new session (same agent, same model override,
   same custom instructions), re-mount every source from the Firestore index, write the new `sessionId`
   back, and seed the new transcript with a short system note.
3. Return the live session.

Anthropic publishes no session TTL, so rehydration is not optional — it's built in phase 3, not bolted
on after the first expiry. It also implements "change this notebook's model", since a session's model
is fixed at create time; the UI presents that as a destructive action behind a confirm.

### Streaming

`GET /api/notebooks/:id/stream` is a native **`EventSource`** endpoint (GET-only, sends cookies, has
built-in reconnect — exactly the three properties we need):

- Server: auth → `ensureSession` → `sessions.events.stream({ event_deltas: ['agent.message'] })` →
  normalise each Anthropic event into a small UI event (`message`, `delta`, `thinking`, `tool`,
  `status`, `usage`) → write SSE frames.
- Each frame carries `id: <createdAt>|<eventId>`. On reconnect the browser sends `Last-Event-ID`
  automatically; the server parses the timestamp out of it and replays via
  `events.list({ 'created_at[gt]': ts })` before tailing the live stream, deduping by event id.
- **Self-close at ~4 minutes** and let the client reconnect, rather than being cut at App Hosting's
  hard 5-minute cap mid-frame. Heartbeat `: ping` every 15s so intermediaries don't drop an idle stream.
- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform`,
  `X-Accel-Buffering: no`.
- Live previews are best-effort and may shed deltas — accumulate them into a scratch buffer keyed by
  event id and **discard it when the authoritative buffered `agent.message` arrives**.
- Sending is separate: `POST /api/notebooks/:id/messages` (`user.message`) and `…/interrupt`
  (`user.interrupt`). Events queue server-side, so there's no need to wait for idle.

### The agent

One shared agent, provisioned by an idempotent script from committed config:

- `model: claude-sonnet-5`; per-notebook override to `claude-opus-5` at session create.
- `tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }]` — the notebook agent
  needs `read`/`grep`/`glob` over mounted sources, `write` for artifacts, `bash` to unpack archives,
  and `web_search`/`web_fetch` for research.
- `skills: [pptx, xlsx, docx, pdf]` — Anthropic's four pre-built document skills, unpinned. The
  sandbox already ships python-pptx, openpyxl, python-docx, pypdf, LibreOffice and pandoc, so
  nothing is fetched at run time. Fixed at session create, like the model.
- `system`: the notebook persona — sources live under `/mnt/session/uploads/sources/`; ground every
  claim in them and cite as `[filename]`; say plainly when the sources don't answer the question;
  every artifact lands in `/mnt/session/outputs/`, Markdown by default and a real
  `.pptx`/`.xlsx`/`.docx`/`.pdf` when that is what was asked for.
- One `cloud` environment, `networking: { type: 'unrestricted' }`.

---

## Implementation plan

Phase 2 is the foundation. Phases 3 and 4 then run in parallel, 5 depends on both, 6 on 5.

### 0. Manual prerequisites — repo owner, in a browser (not automatable)

1. **Enable billing (Blaze) on `claudebook-lm`.** Hard blocker for everything deployed.
2. Firebase console → Authentication → Sign-in method → **enable Google**, set a support email.
3. During phase 7: authorise the Firebase GitHub App when the CLI opens the browser.

Everything else is CLI:

```bash
gcloud services enable firebaseapphosting.googleapis.com developerconnect.googleapis.com \
  cloudbuild.googleapis.com run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  firestore.googleapis.com --project=claudebook-lm
gcloud firestore databases create --location=eur3 --project=claudebook-lm
firebase apps:create web claudebook --project=claudebook-lm     # → public client config
firebase apphosting:secrets:set anthropic-api-key --project=claudebook-lm
gcloud iam service-accounts add-iam-policy-binding \
  firebase-app-hosting-compute@claudebook-lm.iam.gserviceaccount.com \
  --member=serviceAccount:firebase-app-hosting-compute@claudebook-lm.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator --project=claudebook-lm
npm i -g firebase-tools@latest      # local 15.12.0 → ≥15.29.0
```

### 1. Commit the plan and the task board

This document is **`PLAN.md`** (the stable why/what — changes only when a decision
changes) alongside a **`TASKS.md`** checklist (the mutable state — one line per unit
of work, ticked as it lands). Commit both before any code.

Why a committed board rather than relying on the agent's own todo list: an agent's todo list is
per-session and evaporates. This build spans multiple sessions and possibly multiple instances, and
some of it is blocked on the owner's browser steps. `TASKS.md` is the only thing that survives a
`/clear`, shows up in `git log`, and makes visible what is blocked on a human. It costs one file and one edit per task.

### 2. Scaffold + infrastructure config

Next 16 + TS + App Router + Tailwind 4 + `src/` + `@/*`, stripped of boilerplate. Add
`@heroui/react` + `@heroui/styles` (exact same version), `next-themes`, `streamdown`, `zod`,
`firebase`, `firebase-admin`, `@anthropic-ai/sdk`.

Files: `apphosting.yaml` (cpu 1 / 1024 MiB / concurrency 20 / maxInstances 10; `ANTHROPIC_API_KEY` as a
RUNTIME-only secret; `NEXT_PUBLIC_FIREBASE_*` at BUILD+RUNTIME), `apphosting.emulator.yaml`,
`firebase.json` (firestore + emulators), `.firebaserc`, `firestore.rules` (default-deny),
`firestore.indexes.json`, `next.config.ts` (`serverExternalPackages: ['firebase-admin']`, no
`cacheComponents`), `postcss.config.mjs`, `src/app/globals.css` (tailwind → heroui → streamdown
`@source` → HeroUI-token shim), `eslint.config.mjs`, `.env.local.example`, `engines.node: "22"`, and
`src/lib/config/env.ts` — zod-validated **lazily**, because `ADMIN_EMAILS` is RUNTIME-only and absent
during `next build`.

**Verify:** `npm run build` and `npm run lint` pass; `firebase deploy --only firestore` succeeds.

### 3. Auth

`lib/firebase/admin.ts` (ADC), `lib/firebase/client.ts` (auth only), `lib/auth/access.ts`
(`ADMIN_EMAILS` + `normalizeEmail`; **superseded** — see "Access moved to Firestore" in TASKS.md),
`lib/auth/dal.ts` (`getSession` wrapped in React
`cache()`, `requireUser()`, `requireAdmin()`), `app/api/auth/session/route.ts` (POST: Origin check → `verifyIdToken` →
require `google.com` + `email_verified` → admin-or-invited → `createSessionCookie` → `__session` cookie,
httpOnly/secure/lax/5 days; refuse with 403 and `deleteUser` otherwise. DELETE: revoke + clear),
`app/(app)/layout.tsx` (server component: `requireUser()` or `redirect('/login')`),
`app/login/page.tsx` (`signInWithPopup`, handling `popup-blocked`/`popup-closed-by-user`).

**Verify:** an admin or invited account reaches `/`; any other Google account gets a clear refusal,
no cookie, and no lingering Firebase user record; `/api/*` returns 401 without a cookie.

### 4. Anthropic gateway + provisioning

`scripts/provision.ts` — idempotent: find-or-create environment and agent **by name**, `update` the
agent when committed config drifts, print `ANTHROPIC_AGENT_ID` / `ANTHROPIC_ENVIRONMENT_ID`.
`lib/anthropic/{client,agent,sessions,files,events}.ts`, including `normalizeEvent()` (Anthropic event
→ UI event), shared by the stream route and the history route, and the SSE cursor codec.

**Verify:** run the script twice — the second run creates nothing. A scratch script creates a session,
mounts a file, asks a question about it, and streams back an answer that cites the file.

### 5. Domain services + API routes

Repositories; `NotebookService` (create provisions the session; delete archives it and deletes its
Anthropic files); `SourceService` (multipart → `files.upload` → `resources.add` → Firestore);
`ArtifactService` (list via `scope_id`, proxy downloads through the server). Routes under
`app/api/notebooks/**` — every one opens with `requireUser()` and an ownership check.

**Verify:** curl the whole flow with a real cookie: create → upload → ask → artifact appears →
download → delete. Confirm a second user gets 404 on the first user's notebook.

### 6. UI

App shell (hand-rolled `<nav>` per the HeroUI template, theme toggle), notebook grid, and the
three-pane notebook page — sources rail, chat centre, artifacts rail — mirroring NotebookLM. Streaming
chat with `streamdown`, tool-activity indicators, drag-and-drop upload via `DropZone`/`FileTrigger`,
artifact preview/download, and the "model is fixed for this notebook" affordance.

**Verify:** run locally against the real Anthropic API and Firestore; exercise the flow in a browser,
including killing the network mid-stream to prove the SSE cursor resumes losslessly.

### 7. Deploy

`firebase apphosting:backends:create --location europe-west4` (browser step here), grant the backend
secret access, first rollout, then add `<backend>--claudebook-lm.europe-west4.hosted.app` to Firebase
Auth authorized domains — **verify this; it may not be automatic** — and smoke-test in prod. Add a
GitHub Actions workflow running lint/typecheck/build on pull requests as a quality gate.

---

## Verification

- **Local**: `npm run dev` with `.env.local`; Firestore emulator for repository tests. Anthropic calls
  hit the real API — there is no emulator for it.
- **Rules**: `@firebase/rules-unit-testing` proving no collection is client-readable.
- **Unit**: `access`, `normalizeEvent`, and the SSE cursor codec — the three pieces with real logic
  and no I/O.
- **End-to-end in prod** after the first rollout: sign in → create notebook → upload a PDF → ask a
  grounded question → generate an artifact → download it → delete the notebook, confirming the
  Anthropic session is archived and its files removed.

## Open risks

- **Billing.** Nothing deploys until Blaze is on. Everything else can be built and run locally first.
- **Session longevity is undocumented.** Mitigated by `ensureSession` rehydration from phase 4.
- **SSE on App Hosting is inferred, not documented.** Streaming is an advertised App Hosting feature and
  the CDN won't cache `no-store`, but Google never says "SSE from a route handler works". Phase 7
  should deploy a trivial SSE endpoint and confirm it **before** the UI depends on it. Fallback if it
  fails: write assistant messages into Firestore as they stream and let the client resume via
  `onSnapshot` — costs the "no client Firestore" simplification, so it is a fallback, not the plan.
- **`*.hosted.app` may not be auto-added** to Firebase Auth authorized domains — a one-line console fix
  if sign-in fails in prod with `auth/unauthorized-domain`.
- **Multi-tenant file isolation is ours.** Anthropic files are workspace-scoped; the server-side
  ownership check is the only boundary. If that ever needs to be structural, the escape hatch is a
  workspace per user (max 100 per org).
- **HeroUI v3 is ~6 months old** and dropped components we need (Navbar, and there was never an upload).
  Those are plain markup plus React Aria primitives, so the exposure is small, but it is real.
