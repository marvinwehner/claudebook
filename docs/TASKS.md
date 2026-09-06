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

- [x] `lib/firebase/admin.ts` — `initializeApp()` via ADC, no service-account JSON
- [x] `lib/firebase/client.ts` — Firebase **auth only**, no Firestore in the browser bundle
- [x] `lib/auth/allowlist.ts` — `ALLOWED_EMAILS` + optional `ALLOWED_DOMAINS`
- [x] `lib/auth/dal.ts` — `getSession()` in React `cache()`, `requireUser()`
- [x] `app/api/auth/session/route.ts` — POST: Origin check → `verifyIdToken` → require `google.com` +
      `email_verified` → allowlist → `createSessionCookie` → `__session` (httpOnly/secure/lax/5d);
      403 + `deleteUser` on refusal. DELETE: revoke + clear.
- [x] `app/(app)/layout.tsx` — server component gate: `requireUser()` or `redirect('/login')`
- [x] `app/login/page.tsx` — `signInWithPopup`, handling `popup-blocked` / `popup-closed-by-user`
- [x] Unit test: `allowlist` (9 cases, incl. fail-closed on an empty allowlist and no suffix-matching
      of domains)
- [~] **Verify:** done without credentials — `/` with no cookie 307s to `/login`, `/login` renders,
  `POST /api/auth/session` gives 403 with a missing or foreign Origin, 400 on a bad body and 401
  on a malformed token. **Still to do:** a real Google sign-in, which needs
  `gcloud auth application-default login` (no ADC on this machine yet) for `createSessionCookie`
  and `deleteUser`, plus a human at the Google popup. Non-allowlisted refusal untested for the
  same reason.

## Phase 4 — Anthropic gateway + provisioning

- [x] `scripts/provision.ts` — idempotent find-or-create of the **one shared** environment and agent
      **by name**; update the agent when committed config drifts; print `ANTHROPIC_AGENT_ID` /
      `ANTHROPIC_ENVIRONMENT_ID`
- [x] `lib/anthropic/client.ts` — SDK client, server-only
- [x] `lib/anthropic/agent.ts` — the committed agent config (model, toolset, system prompt)
- [x] `lib/anthropic/sessions.ts` — `ensureSession()` incl. **rehydration** (missing/terminated →
      recreate + re-mount every source from Firestore); also backs "change this notebook's model"
- [x] `lib/anthropic/files.ts` — upload, `resources.add`/`delete`, artifact list via `scope_id` +
      `betas: ['managed-agents-2026-04-01']`, download
- [x] `lib/anthropic/events.ts` — `normalizeEvent()` + SSE cursor codec (`<createdAt>|<eventId>`)
- [x] Unit tests: `normalizeEvent`, cursor encode/decode (15 cases)
- [x] **Verify:** `provision` run twice — second run created nothing and the agent stayed at v1
      (`agent_01Jo4zPsLgxJMskAJjxNrfD5`, `env_01U3GHJPwPyg8D4g9fSohJHP`). Scratch script passed all
      six checks: mounted file → grounded answer citing `[sundial-report.md]` → correctly refused a
      question the source does not cover → wrote an artifact → listed it → downloaded it.

### Corrections this phase forced (both found by running it, not by reading docs)

- **A lone `system.message` is rejected.** It must be in the same request as, and immediately after,
  a `user.message` / `user.tool_result` / `user.custom_tool_result`. So `ensureSession()` no longer
  sends the rehydration note itself — it returns `seedNote`, and `sendUserMessage(id, text, note)`
  pairs them. Phase 5 must persist `seedNote` on the notebook when rehydration happens on an upload
  rather than a message, or the note is lost.
- **`files.list({scope_id})` is not "outputs".** It returns the sources mounted into the session too,
  and those are `downloadable: false`. `listArtifacts` filters on `downloadable === true`, and
  retries on the _filtered_ count — otherwise the mounted sources satisfy the retry immediately and
  the real artifact is missed while indexing is still catching up.

## Phase 5 — domain services + API routes

- [x] `lib/firestore/notebooks.ts`, `lib/firestore/sources.ts` — typed repositories + converters
- [x] `NotebookService` — create provisions a session; delete archives it and deletes its Anthropic files
- [x] `SourceService` — multipart → `files.upload` → `resources.add` → Firestore index
- [x] `ArtifactService` — list via `scope_id` (retry once or twice; indexing lags idle), proxy downloads
- [x] `app/api/notebooks/route.ts` — GET list, POST create
- [x] `app/api/notebooks/[id]/route.ts` — GET, PATCH, DELETE
- [x] `app/api/notebooks/[id]/messages/route.ts` — POST `user.message`
- [x] `app/api/notebooks/[id]/interrupt/route.ts` — POST `user.interrupt`
- [x] `app/api/notebooks/[id]/events/route.ts` — transcript history for first paint
- [x] `app/api/notebooks/[id]/stream/route.ts` — SSE relay: `event_deltas: ['agent.message']`,
      `Last-Event-ID` resume via `created_at[gt]`, **self-close at ~4 min**, `: ping` every 15s,
      headers `no-store, no-transform` + `X-Accel-Buffering: no`
- [x] `app/api/notebooks/[id]/sources/**` — GET list, POST upload, DELETE
- [x] `app/api/notebooks/[id]/artifacts/**` — GET list, GET download
- [x] Every handler opens with `requireUser()` **and** an ownership check — never trust a client `file_id`
- [x] **Verify:** `npm run verify:flow` — 16/16 against real Firestore and the real Anthropic API:
      create, ownership boundary (a second uid gets NotFound on a real notebook id, and its artifact
      ids are refused), upload, duplicate-filename refusal, a grounded answer citing its source, an
      artifact written/listed/downloaded, source removal, the model-change reset, delete. The HTTP
      layer was then walked in a browser with a real session cookie (see phase 6).

## Phase 6 — UI

- [x] App shell — hand-rolled `<nav>` (HeroUI v3 removed `Navbar`), `next-themes` toggle with mount guard
- [x] Notebook grid + create dialog (model picker: Sonnet 5 default / Opus 5 opt-in, **fixed after create**)
- [x] Notebook page — three panes: sources rail, chat, artifacts rail
- [x] Streaming chat via `EventSource` + `streamdown`; discard the delta buffer when the authoritative
      `agent.message` arrives
- [x] Tool-activity + thinking indicators
- [x] Upload via `DropZone` + `FileTrigger` from `react-aria-components` (already a HeroUI peer)
- [x] Artifact list, preview, download
- [x] "Changing the model starts a fresh conversation" confirm dialog
- [x] **Verify:** full flow walked in Chrome against the real API, signed in with Google:
      `/` gated → sign-in → create notebook (modal, model picker) → drag-target upload → grounded
      answer citing `[lighthouse-survey.md]` → a correct "the survey does not cover that" → thinking
      and Stop indicators → artifact appears on turn-complete → preview renders → download lands on
      disk with the right filename and 1691 bytes → model-change confirm → delete confirm → deleted.
      Afterwards the Anthropic workspace showed the source file gone and the session no longer
      listed, i.e. archived — delete really does clean up both sides.
- [x] **SSE resume verified.** With `SELF_CLOSE_MS` temporarily dropped to 6s, a long turn survived
      repeated mid-answer reconnects: the answer arrived complete, the client showed
      "Reconnecting…" each cycle, and the transcript had **zero duplicated blocks**. The constant is
      back at 4 minutes.

### Notes

- `normalizeEvent` now renders the echoed `user.message` too. Without it a reload showed the
  assistant's half of the conversation and none of the user's — we keep no second copy of the
  transcript, so the echo _is_ the record.
- The mount guard uses `useSyncExternalStore` rather than `useEffect(() => setMounted(true))`;
  React 19's `set-state-in-effect` rule rejects the older idiom.
- Added `prettier` (printWidth 100, matching how the code was already written) and an `npm run
format` script.

## Phase 7 — deploy

- [x] `firebase apphosting:backends:create` — created `claudebook` in `europe-west4`, runtime
      nodejs22, linked to web app `1:428276124646:web:450dc028026fbc20b4a427`.
      URL: `https://claudebook--claudebook-lm.europe-west4.hosted.app`
      **Note:** the flag is `--primary-region`, not `--location` as PLAN.md says.
- [x] `firebase apphosting:secrets:grantaccess anthropic-api-key --backend claudebook`
- [x] Grant `roles/iam.serviceAccountTokenCreator` on `firebase-app-hosting-compute@claudebook-lm`
      to itself. **Probably unnecessary** — see the correction below — but harmless, so it stands
      until a production sign-in proves it either way.
- [x] **Link the GitHub repository.** Run non-interactively, `backends:create` silently skipped the
      Developer Connect step, so the backend had no repository and no rollout could be created
      (`rollouts:create` takes a git branch or commit), and there is no `backends:update` to add one
      afterwards. Fixed by deleting the empty backend and re-creating it **interactively**, which
      prompts for GitHub App authorization. Now linked to `mavonic/claudebook`, branch `main`.
- [ ] **Spike:** deploy a trivial SSE route and confirm App Hosting does not buffer it
- [x] First rollout — "Rollout complete", serving at the URL above.
- [ ] Confirm auto-deploy fires on push to `main`
- [x] Add `claudebook--claudebook-lm.europe-west4.hosted.app` to Firebase Auth authorized domains.
      **It is not automatic** — PLAN.md flagged this as a risk and was right. Added additively via
      the Identity Toolkit admin API under ADC; the list is now localhost, `*.firebaseapp.com`,
      `*.web.app`, and the App Hosting domain.
- [x] `.github/workflows/ci.yml` — lint + typecheck + test + build on pull requests
      (done early: it needs nothing from the deploy)
- [ ] **Verify in prod:** sign in → create notebook → upload a PDF → grounded question → generate an
      artifact → download → delete, confirming the session is archived and its files removed

### Security — GitHub secret-scanning alert (2026-09-06)

GitHub flagged a "Google API Key" in `apphosting.yaml#L45` (commit `804d279`) while the repo was
**public**. Audited every blob in every commit: the finding is the **Firebase Web API key**, and it
is the only credential-shaped value ever committed.

- [x] **Confirmed `ANTHROPIC_API_KEY` was never committed.** The only `sk-ant-` string in history is
      the `sk-ant-api03-...` placeholder in `.env.local.example`. `.env.local` is untracked and
      matched by `.gitignore:28`. No stash, no unreachable blob, no service-account JSON, no private
      key, no npm credential anywhere in history. **No rotation, no history rewrite.**
- [x] **Not rotating the Firebase key.** A Firebase web API key is a public project identifier — it
      ships in the browser bundle to every visitor, so purging it from git would not make it secret.
      It is safe here because email/password and anonymous sign-in are both disabled, `ALLOWED_EMAILS`
      gates session-cookie creation, and `firestore.rules` is flat default-deny.
- [x] **Restricted the key by HTTP referrer** — the one thing that was genuinely missing. It had
      `browserKeyRestrictions: {}` (usable from anywhere) while permitting `identitytoolkit` and
      `securetoken`. Now limited to the App Hosting domain, `*.firebaseapp.com` (needed because sign-in
      uses `signInWithPopup`, whose OAuth handler runs there), `*.web.app`, and localhost.
      Verified: allowed referrers 200, `evil.example.com` 403, no-referrer 403.
      **Patch with `updateMask=restrictions.browserKeyRestrictions`** — `browserKeyRestrictions` is a
      oneof but `apiTargets` is a sibling field, so an unscoped update silently wipes all 27 targets.
      Needed `gcloud services enable apikeys.googleapis.com` first.
- [ ] **Blocker before making the repo public again:** `marvin.wehner@gmx.de` is in four tracked
      files (`apphosting.yaml`, `apphosting.emulator.yaml`, `.env.local.example`,
      `src/lib/auth/allowlist.test.ts`). Not a credential, but public means scraped, and it names the
      exact account an attacker must compromise to pass the allowlist. Move `ALLOWED_EMAILS` to
      Secret Manager alongside `anthropic-api-key`, and use a fake address in the test and example.

### Corrections to PLAN.md found in this phase

- `apphosting:backends:create` takes **`--primary-region`**, not `--location`.
- **`createSessionCookie` does not use `signBlob`.** PLAN.md says minting a session cookie under ADC
  signs remotely, hence the token-creator self-grant. `firebase-admin`'s `BaseAuth.createSessionCookie`
  goes through `authRequestHandler` — a REST call to Identity Toolkit's `:createSessionCookie`. Only
  `createCustomToken` uses the crypto signer. The grant is applied anyway as cheap insurance, but the
  stated reason for it is wrong.

## Phase 8 — session spend cap

- [x] **Un-deferred: every session is created with a $50 budget.** `createSession` now sends
      `budget: {type: "limit", max_list_cost: {amount: "5000", currency: "USD"}}`, so it applies to
      new notebooks _and_ to the sessions `ensureSession` rebuilds after one disappears.
      Sessions created before this change stay uncapped forever — a budget is **create-only**, and
      adding one to a live session is a 400. They only gain the cap once they rehydrate or the
      notebook's model changes, both of which create a new session.
- [ ] **Surface `budget_reached` in the UI.** At the cap the session pauses `idle` — it is not
      terminated, history and sandbox survive — and rejects `user.message` with a 400 until the cap
      is raised or removed. Today that surfaces as a generic send failure. Needs a distinct state,
      and a decision on who may raise a cap (removal is one-way: a removed budget can never be
      re-added).

### Two things the run contradicted

- **A `.pptx` comes back from the Files API as `application/zip`, not the Office mime type.**
  Harmless as it stands — `Content-Disposition: attachment` plus the `.pptx` filename means
  the browser saves it correctly, and `PREVIEWABLE` still (correctly) declines to preview it —
  but it is why `artifactIcon()` keys on the filename extension. A mime-keyed icon map would
  have silently fallen through to the generic glyph for every Office document.
- **The pptx skill brought its own toolchain.** The observed run built the deck with pptxgenjs
  rather than the pre-installed python-pptx, so the skills lean on the environment's
  `unrestricted` networking more than the sandbox's package list suggests. Nothing to fix
  today; it just means a future `limited` policy is not the free change it looks like.

### Correction this phase forced

- **Eagerly creating a session does not pre-warm its container.** The comment in `createNotebook`
  claimed the eager create meant "the first message is not the thing that pays for container
  start-up". It isn't: a session created without `initial_events` is only _registered_, and the
  sandbox comes up when the session first needs it — so the first message still pays. The eager
  create is still worth keeping, for the stable session id, but the stated reason was wrong.
  (The other half of the comment was right: idle sessions bill nothing. Runtime is metered on
  `usage.active_seconds` — time with ≥1 thread running — at $0.08/hour.)

---

## Phase 9 — document skills (pptx / xlsx / docx / pdf)

- [x] `lib/anthropic/agent.ts` — `AGENT_SKILLS`, Anthropic's four pre-built document skills,
      attached to `AGENT_CONFIG`. That is the complete pre-built set; everything else on
      claude.ai is a user-uploaded custom skill.
- [x] `lib/anthropic/agent.ts` — the artifacts prompt said to write a document **as Markdown**,
      which would have steered the agent away from a real deck even with the skill attached.
      Now: Markdown by default, the real format when asked for, and _everything_ in
      `/mnt/session/outputs/` — the skills have no idea that directory is special.
- [x] `scripts/provision.ts` — `agentMatches()` compares skills as a sorted set of
      `type:skill_id`. The API echoes a `version` back ("latest", for an unpinned skill) where
      the committed config omits the field, so version cannot be part of the comparison.
      Without this the drift is invisible and provision reports `ok` forever, so the skills
      would never reach the live agent.
- [x] `components/artifacts-rail.tsx` — an icon per output format, keyed on the filename
      extension rather than the mime type, since the agent is what names the file.
- [x] **Verified.** Provision run twice — `v1 -> v2`, then `ok`. A live session on agent v2
      carrying all four skills was asked for "a 3-slide PowerPoint summarising this log" and
      wrote `orbit-log-summary.pptx` (153 KB) into `/mnt/session/outputs/`, where
      `listArtifacts` picked it up. Still worth one click-through in the browser to see the
      rail render it.

### Known limits, accepted

- **Existing notebooks do not gain the skills until their session is rebuilt.** Skills are
  create-only, exactly like the model and the budget cap above. Deliberately not retrofitted:
  the only lever is archiving the session, which destroys the transcript. `ensureSession`
  rebuilds onto the current agent version on its own, so the fleet converges.
- **A notebook with custom instructions loses the outputs-dir rule.** `createSession` sends
  `system: customInstructions` and overrides replace in full, so such a notebook may build a
  deck outside `/mnt/session/outputs/` and it will never reach the rail. Pre-existing — it
  applies to Markdown artifacts too — but the skills make it easier to hit.

### Correction this phase forced

- **PLAN.md said artifacts are Markdown.** That was a settled decision and it is now wrong:
  the `system` bullet under `### The agent` has been amended to Markdown-by-default with the
  real file format when asked for. Changed deliberately, at the user's request, not routed
  around.

## Review pass — fixes landed, and what they contradict

A full code review + security audit ran over the whole repo. Eighteen findings were fixed.
Three of them contradict things recorded here or in PLAN.md:

- **`403 + deleteUser` on refusal is no longer the behaviour.** PLAN.md:294 and lines 64 and 73
  above still describe it. The `deleteUser` call is gone: the 403 is the control, the DAL
  re-checks the allowlist on every request, and deleting the uid orphaned the notebooks,
  sources and Anthropic files keyed to it — so a typo in `ALLOWED_EMAILS` destroyed real data.
  `serverEnv()` now also rejects an allowlist empty on both sides, so that misconfiguration
  fails loudly instead of one refused sign-in at a time.
- **"A notebook with custom instructions loses the outputs-dir rule" is fixed.** `createSession`
  now sends `AGENT_SYSTEM_PROMPT` with the owner's instructions appended and framed as
  subordinate, rather than replacing the prompt outright.
- **`ANTHROPIC_API_KEY` was reaching the build environment.** Omitting `availability` in
  `apphosting.yaml` defaults to BUILD _and_ RUNTIME; only that one entry omitted it, while the
  comment above it claimed runtime-only. Now explicit. Verified safe: `next build` succeeds with
  every server secret blank, because `env.ts` validates lazily.

Also fixed: a transient Anthropic error no longer destroys a conversation (`retrieve` rethrows
anything that is not a 404/410); the SSE relay no longer emits a cursor its own decoder rejects,
and the first connect now resumes from the SSR cursor; `listArtifacts` paginates; uploaded
filenames are validated before they reach `mount_path` or the seed note; concurrent
`liveSession()` can no longer create two paid sessions; `provision.ts` reconciles environment
drift instead of only creating.

Still open and deliberately not changed: the sandbox's `networking: unrestricted` combined with
bash and web_fetch over untrusted sources is an exfiltration path. That is a settled PLAN.md
decision, so it needs a call rather than a quiet edit.

---

## Deferred (explicitly out of scope for v1)

- Source viewer / re-download of uploaded sources (Anthropic returns `downloadable: false` for uploads;
  would need a Cloud Storage mirror)
- NotebookLM "Studio" one-click generators (study guide, briefing doc, FAQ, timeline, mind map)
- Sharing notebooks between users
