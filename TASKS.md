# Claudebook — task board

Working checklist for the build described in [PLAN.md](./PLAN.md). Tick items as they land; keep this
file honest — it is the only state that survives between sessions.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[!]` **blocked on a human**

---

## Phase 0 — manual prerequisites (browser only, not automatable)

- [x] Enable **billing (Blaze plan)** on `claudebook-lm` — done 2026-09-06; verified with
      `gcloud billing projects describe`.
- [x] Firebase console → Authentication → Sign-in method → **enable Google**, set a support email.
- [!] Phase 7 only: authorise the Firebase GitHub App when `apphosting:backends:create` opens a browser.

## Phase 0b — CLI provisioning

- [x] `gcloud services enable` — firebaseapphosting, developerconnect, cloudbuild, run,
      artifactregistry, secretmanager, iam, iamcredentials, firestore
- [x] `gcloud firestore databases create --location=eur3` — `(default)`, eur3, FIRESTORE_NATIVE
- [x] `firebase apps:create web claudebook` → app ID `1:428276124646:web:450dc028026fbc20b4a427`;
      config written into `apphosting.yaml` and `.env.local`
- [x] `firebase apphosting:secrets:set anthropic-api-key` → version 1, value verified by round-trip
- [x] `npm i -g firebase-tools@latest` — already at 15.29.0, nothing to do
- [→] Grant `roles/iam.serviceAccountTokenCreator` to `firebase-app-hosting-compute@…` **on itself**
      — **moved to phase 7**: that service account does not exist until `apphosting:backends:create`
      creates it (`NOT_FOUND: Unknown service account`). Still required before `createSessionCookie`
      works in production.

## Phase 1 — plan + board

- [x] `PLAN.md` committed
- [x] `TASKS.md` committed

## Phase 2 — scaffold + infrastructure config

- [x] `create-next-app`: Next 16, TS, App Router, Tailwind 4, `src/`, `@/*`; strip boilerplate
- [x] Deps: `@heroui/react` + `@heroui/styles` (identical exact versions), `next-themes`, `streamdown`,
      `zod`, `firebase`, `firebase-admin`, `@anthropic-ai/sdk`
- [x] `globals.css`: `@import "tailwindcss"` → `@import "@heroui/styles"` → streamdown `@source`
      → HeroUI-token shim for streamdown's shadcn-style variables
- [x] `next.config.ts`: `serverExternalPackages: ['firebase-admin']`; **no** `cacheComponents`, **no**
      `proxy.ts` (neither is supported on App Hosting)
- [x] `apphosting.yaml` — cpu 1 / 1024 MiB / concurrency 20 / maxInstances 10;
      `ANTHROPIC_API_KEY` RUNTIME-only secret; `NEXT_PUBLIC_FIREBASE_*` BUILD+RUNTIME
- [x] `apphosting.emulator.yaml`, `firebase.json` (firestore + emulators), `.firebaserc`
- [x] `firestore.rules` — flat default-deny (the client never touches Firestore)
- [x] `firestore.indexes.json` — `notebooks` on `(ownerId ASC, updatedAt DESC)`
- [x] `src/lib/config/env.ts` — zod-validated **lazily**; `ALLOWED_EMAILS` is RUNTIME-only and absent
      during `next build`, so validating at module scope breaks the build
- [x] `engines.node: "22"`, lock file committed (App Hosting fails the build without one)
- [x] **Verify:** `npm run build` + `npm run lint` + `tsc --noEmit` pass; `firebase deploy --only
      firestore` succeeded (rules released, index built).

## Phase 3 — auth

- [ ] `lib/firebase/admin.ts` — `initializeApp()` via ADC, no service-account JSON
- [ ] `lib/firebase/client.ts` — Firebase **auth only**, no Firestore in the browser bundle
- [ ] `lib/auth/allowlist.ts` — `ALLOWED_EMAILS` + optional `ALLOWED_DOMAINS`
- [ ] `lib/auth/dal.ts` — `getSession()` in React `cache()`, `requireUser()`
- [ ] `app/api/auth/session/route.ts` — POST: Origin check → `verifyIdToken` → require `google.com` +
      `email_verified` → allowlist → `createSessionCookie` → `__session` (httpOnly/secure/lax/5d);
      403 + `deleteUser` on refusal. DELETE: revoke + clear.
- [ ] `app/(app)/layout.tsx` — server component gate: `requireUser()` or `redirect('/login')`
- [ ] `app/login/page.tsx` — `signInWithPopup`, handling `popup-blocked` / `popup-closed-by-user`
- [ ] Unit test: `allowlist`
- [ ] **Verify:** allowlisted account reaches `/`; non-allowlisted gets a clear refusal with no cookie
      and no lingering Firebase user; `/api/*` returns 401 without a cookie

## Phase 4 — Anthropic gateway + provisioning

- [ ] `scripts/provision.ts` — idempotent find-or-create of the **one shared** environment and agent
      **by name**; update the agent when committed config drifts; print `ANTHROPIC_AGENT_ID` /
      `ANTHROPIC_ENVIRONMENT_ID`
- [ ] `lib/anthropic/client.ts` — SDK client, server-only
- [ ] `lib/anthropic/agent.ts` — the committed agent config (model, toolset, system prompt)
- [ ] `lib/anthropic/sessions.ts` — `ensureSession()` incl. **rehydration** (missing/terminated →
      recreate + re-mount every source from Firestore); also backs "change this notebook's model"
- [ ] `lib/anthropic/files.ts` — upload, `resources.add`/`delete`, artifact list via `scope_id` +
      `betas: ['managed-agents-2026-04-01']`, download
- [ ] `lib/anthropic/events.ts` — `normalizeEvent()` + SSE cursor codec (`<createdAt>|<eventId>`)
- [ ] Unit tests: `normalizeEvent`, cursor encode/decode
- [ ] **Verify:** run `provision` twice — second run creates nothing. Scratch script: create session →
      mount file → ask → streamed answer cites the file.

## Phase 5 — domain services + API routes

- [ ] `lib/firestore/notebooks.ts`, `lib/firestore/sources.ts` — typed repositories + converters
- [ ] `NotebookService` — create provisions a session; delete archives it and deletes its Anthropic files
- [ ] `SourceService` — multipart → `files.upload` → `resources.add` → Firestore index
- [ ] `ArtifactService` — list via `scope_id` (retry once or twice; indexing lags idle), proxy downloads
- [ ] `app/api/notebooks/route.ts` — GET list, POST create
- [ ] `app/api/notebooks/[id]/route.ts` — GET, PATCH, DELETE
- [ ] `app/api/notebooks/[id]/messages/route.ts` — POST `user.message`
- [ ] `app/api/notebooks/[id]/interrupt/route.ts` — POST `user.interrupt`
- [ ] `app/api/notebooks/[id]/events/route.ts` — transcript history for first paint
- [ ] `app/api/notebooks/[id]/stream/route.ts` — SSE relay: `event_deltas: ['agent.message']`,
      `Last-Event-ID` resume via `created_at[gt]`, **self-close at ~4 min**, `: ping` every 15s,
      headers `no-store, no-transform` + `X-Accel-Buffering: no`
- [ ] `app/api/notebooks/[id]/sources/**` — GET list, POST upload, DELETE
- [ ] `app/api/notebooks/[id]/artifacts/**` — GET list, GET download
- [ ] Every handler opens with `requireUser()` **and** an ownership check — never trust a client `file_id`
- [ ] **Verify:** curl the full flow with a real cookie; confirm a second user gets 404 on the first
      user's notebook

## Phase 6 — UI

- [ ] App shell — hand-rolled `<nav>` (HeroUI v3 removed `Navbar`), `next-themes` toggle with mount guard
- [ ] Notebook grid + create dialog (model picker: Sonnet 5 default / Opus 5 opt-in, **fixed after create**)
- [ ] Notebook page — three panes: sources rail, chat, artifacts rail
- [ ] Streaming chat via `EventSource` + `streamdown`; discard the delta buffer when the authoritative
      `agent.message` arrives
- [ ] Tool-activity + thinking indicators
- [ ] Upload via `DropZone` + `FileTrigger` from `react-aria-components` (already a HeroUI peer)
- [ ] Artifact list, preview, download
- [ ] "Changing the model starts a fresh conversation" confirm dialog
- [ ] **Verify:** full flow in a browser; kill the network mid-stream and confirm the SSE cursor resumes
      losslessly

## Phase 7 — deploy

- [ ] **Spike first:** deploy a trivial SSE route and confirm App Hosting does not buffer it, *before*
      the UI depends on it (see the open risk in PLAN.md)
- [ ] `firebase apphosting:backends:create --location europe-west4` (browser step)
- [ ] `firebase apphosting:secrets:grantaccess anthropic-api-key --backend <id>`
- [ ] Grant `roles/iam.serviceAccountTokenCreator` on `firebase-app-hosting-compute@claudebook-lm`
      **to itself** (moved here from phase 0b — the SA is created by `backends:create`). Without it
      `createSessionCookie` fails under ADC, so sign-in breaks in production only.
- [ ] First rollout; confirm auto-deploy on push to `main`
- [ ] Add `<backend>--claudebook-lm.europe-west4.hosted.app` to Firebase Auth authorized domains —
      **verify whether this is automatic**; symptom if missing is `auth/unauthorized-domain`
- [ ] `.github/workflows/ci.yml` — lint + typecheck + build on pull requests
- [ ] **Verify in prod:** sign in → create notebook → upload a PDF → grounded question → generate an
      artifact → download → delete, confirming the session is archived and its files removed

---

## Deferred (explicitly out of scope for v1)

- Source viewer / re-download of uploaded sources (Anthropic returns `downloadable: false` for uploads;
  would need a Cloud Storage mirror)
- NotebookLM "Studio" one-click generators (study guide, briefing doc, FAQ, timeline, mind map)
- Sharing notebooks between users
- Per-session spend budgets (create-only and removal is one-way, so adding later means a new session)
