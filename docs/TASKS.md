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
- [ ] **Blocker before making the repo public again:** `marvin.wehner@gmx.de` was in four tracked
      files. **Narrowed, not closed** — see "Access moved to Firestore" below. The test and
      `.env.local.example` now use fake addresses, and the variable is `ADMIN_EMAILS`, but
      `apphosting.yaml` and `apphosting.emulator.yaml` still carry the real one. It names the exact
      account an attacker must compromise to reach admin. Remaining work: move `ADMIN_EMAILS` to
      Secret Manager alongside `anthropic-api-key` — note that pins the value at build, so changing
      admins would need a rollout.

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
  fails loudly instead of one refused sign-in at a time. **No longer true** — that refinement was
  removed when access moved to Firestore; see below for why it was the wrong lever.
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

## Artifact rail went stale after the first artifact

- [x] **`listArtifacts` retried on emptiness, not on change.** The retry exists to absorb the
      ~1-3s indexing lag after `session.status_idle`, but the gate was `artifacts.length > 0`.
      A notebook's _first_ artifact appeared (empty list -> retry ran); every one after it did
      not, because the already-indexed files satisfied the gate on the first attempt and the
      stale list returned instantly. The rail asked once per turn, so that answer was final
      until a reload — and a reload only worked because the page never server-renders
      artifacts, so it just re-ran the same fetch later.
- [x] **The relay now owns the lag.** On a non-`requires_action` `session.status_idle` the
      stream route sweeps `listArtifacts(sessionId, 0)` at 0/1.5/3s and pushes an `artifacts`
      frame whenever the file-id set changes. Fire-and-forget, or it stalls event forwarding
      for the width of the sweep. The frame carries **no `id:`** — a synthesised event has no
      `processed_at` and must never displace the `Last-Event-ID` cursor.
- [x] `UiEvent` stayed the transcript union (every member has an `id`, which
      `use-notebook-stream` relies on when seeding `seen`). The synthesised event is a separate
      `ArtifactsEvent`, and `StreamEvent = UiEvent | ArtifactsEvent` is what the relay sends.
      The compiler caught this — the first attempt put it in `UiEvent` and broke that seed.
- [x] The client no longer polls: `onTurnComplete` became `onArtifacts`, and the workspace
      keeps one mount fetch for first paint. Adding the kind to the `addEventListener` list is
      easy to miss — without it the frame arrives and nothing fires.
- [x] **Verified in the browser** on the notebook that reproduced it, which already held a
      `.pptx` and a `.md`: asked for a new `.md`, the rail went 2 -> 3 with no reload, and the
      dev log shows **zero** `/artifacts` requests after the `POST /messages` — it arrived over
      the stream.

### Not changed, deliberately

- `files.ts:128` keeps its retry-until-non-empty. It is correct for the cold-start HTTP path,
  and `verify-flow.ts:122` depends on it. The defect was that the _turn-end_ refresh used it.
- No mid-turn trigger off `agent.tool_use`. It fires when the tool is invoked, which is earlier
  than the lag window, and the pptx skill writes via pptxgenjs under bash — no `input.file_path`
  to sniff. `normalizeEvent` still drops `input`.
- A turn that ends while the client is disconnected reaches the relay only through the cursor
  replay, which forwards events but ran no sweep — so the rail stayed stale even with a perfectly
  good cursor, not just the null-cursor case this note first claimed. The replay loop now sweeps
  too, and both call sites use `isTurnComplete` rather than re-inlining the predicate.

---

## Phase 9 — per-notebook usage and cost

- [x] **The data was already on the wire and being thrown away.** `session.usage` was
      normalised, relayed, subscribed to — and dropped by a one-line `return` in
      `use-notebook-stream`. Separately, `sessions.retrieve()` (called on every request via
      `ensureSession`) returns the full cumulative `usage`, and we read only `status`.
- [x] **No per-model price table, and there should never be one.** The session carries
      `usage.list_cost` as an integer string in minor units, and it already includes web
      searches and $0.08/h of active runtime. A price table keyed on the model would go stale
      _and_ silently miss the runtime component. Money is kept in integer cents end to end and
      formatted only at the edge. The figure is Anthropic's public list rate rather than a
      contracted price — still the right one to show, being exactly what the $50 cap is
      enforced against.
- [x] **Usage is cumulative per session, not a per-turn delta.** So every write is a
      _replace_, never an increment — which is what makes it safe to drive from the relay,
      whose reconnects replay events either side of the seam. This one fact removed the
      whole double-counting problem rather than requiring a dedupe.
- [x] **Firestore is the only place a lifetime figure can live.** A session is rebuilt on
      rehydration and on a model change, and both reset Anthropic's counter to zero. The
      roll-up (`retired += current`, `current = 0`) rides inside the existing
      `claimSessionId` transaction — already the atomic moment a notebook swaps sessions —
      and is repeated on the model-change path in `updateNotebook`.
      Accepted: a vanished session cannot be re-read, so the roll-up banks its **last
      persisted snapshot**. Only usage since the last completed turn is lost.
- [x] `session.usage` now normalises to `null`. The relay reads the snapshot off the raw
      event instead, so it no longer spends one of `loadTranscript`'s 500 `MAX_EVENTS` slots
      to render nothing. `UsageEvent` joins `ArtifactsEvent` as a synthesised frame carrying
      the **lifetime** total, so `kind: "usage"` means one thing on the client.
- [x] Three emit points: on connect (free — `liveSession` already returns the session with
      its usage), on a `session.usage` event (the SDK types it "periodic" but the docs only
      promise it at the spend cap, so it is a bonus), and one `sessions.retrieve()` at turn
      end beside the artifact sweep (the reliable one — no rendered event carries a turn's
      cost). Redundant writes are skipped inside the transaction: a relay reconnects every
      four minutes for as long as a tab is open, and on an idle notebook that is the same
      numbers over and over.

### Corrections review forced

- **The first cut let the figure go backwards, permanently.** Three producers report a
  session's usage — the relay on connect, a `session.usage` event, and the read after a
  turn — each from its own `sessions.retrieve`, and nothing orders them. Two reads issued
  together can land in either order, so a plain replace let an older snapshot overwrite a
  newer one; a later roll-up then banked the lower number and the difference was gone for
  good. `recordSessionUsage` now merges with `maxUsage` rather than replacing. Usage only
  grows within a session, so the loser of the race is a no-op instead of a regression.
- **`pushUsage` used to bail on `closed` before persisting.** Closing a tab a moment after a
  turn ended threw away the figure that had just been read — and if the session then expired,
  the whole turn's cost vanished from the lifetime total. It now always persists; only the
  SSE frame is skipped. Safe to do only because of the merge above, which is what stops a
  late write from a dying relay clobbering a newer one.
- **The model-change roll-up was a read-modify-write on a field a transaction owns**, with an
  `archiveSession` round trip inside the window — the exact race the comment on
  `recordSessionUsage` warns about. It is now `retireSessionUsage`, transactional like
  `claimSessionId`, and runs _after_ `sessionId` is cleared so the repository's guard has
  already started rejecting writes for the retired session.
- **The relay was combining Anthropic and Firestore itself**, which AGENTS.md reserves for
  the service layer. The turn-end retrieve and the persist moved into `recordTurnUsage`.
  (The file's pre-existing SDK imports for streaming and artifact listing stay — those are
  pure Anthropic reads, not a combination.)

Verified end to end against real Firestore and the real API, including the one case unit
tests cannot reach: a scratch notebook billed $0.02, then switched Sonnet 5 -> Opus 5 to force
a rebuild. The figure held at $0.02, and Firestore showed `retired` holding the dead session's
totals with `current` reset against the new session id.

### Still open

- [ ] **Surface `budget_reached` in the UI** — see Phase 8. This work makes it cheap (the
      `session.usage` event carries `budget` alongside the spend, and `sessions.update`
      takes a new cap), but it still needs a decision on who may raise one, given that
      removal is one-way.

---

## Access moved to Firestore, with an admin UI

The allowlist was `ALLOWED_EMAILS` in `apphosting.yaml`, so inviting anyone meant editing YAML and
redeploying. Now `ADMIN_EMAILS` holds admins only; everyone else is a row in `allowedUsers` that an
admin manages from the account menu in the header. `ALLOWED_DOMAINS` is gone entirely.

- [x] `lib/auth/access.ts` replaces `allowlist.ts` — `parseList`, `normalizeEmail`,
      `isAdmin(email, admins)` + `isAdminEmail()`. The list is an argument on the pure one because
      `serverEnv()` memoises the first `process.env` it sees and a test cannot vary it otherwise.
- [x] **The email IS the `allowedUsers` document id.** A new precedent — every other repo here uses
      auto-ids — and it is what makes the per-request check a point read rather than a query, and
      duplicates impossible by construction. `normalizeEmail` is the single gate, called by the
      repository on every id it touches as well as by the service, because a write path and a read
      path that disagree on the key is a silent lockout with no error anywhere.
- [x] Checked `z.email()` against the hazards rather than assuming. Zod 4's pattern is stricter than
      the RFC and does most of the work: ASCII-only (so an accented address cannot arrive NFC in one
      write and NFD in another and land in two documents), and it rejects quoted local parts
      (`"a/b"@x.test` — a legal address whose slash would make `doc()` address a **subcollection**
      rather than fail), a leading dot, and `..`. Only the 254-char cap and Firestore's reserved
      `__…__` ids had to be added on top.
- [x] **`+` aliases and Gmail dots are deliberately not canonicalised.** Folding `victim+x@gmail.com`
      into `victim@gmail.com` would let an admin grant access to an address they never typed. Not
      folding fails closed and is merely surprising.
- [x] `addAllowedUser` uses `ref.create()`, not `set()`. With the email as the id, a `set()` would
      silently overwrite the `invitedBy`/`createdAt` provenance the row exists to display; `create()`
      throws gRPC `ALREADY_EXISTS` (code 6), which the service maps to `ConflictError` → 409.
- [x] `requireAdmin()` + `ForbiddenError` → a **403 branch in `toErrorResponse`**, which had none.
      That does not contradict the 404-not-403 rule: that rule stops a notebook handler confirming an
      id exists, and `/api/admin/*` has a fixed path that leaks nothing.
- [x] `DELETE /api/admin/allowed-users` takes `{ email }` in the **body**, not a `[email]` path
      segment. Cloud Logging records the full request path, and an invited user's address in a log
      line is the same leak the blocker above is about. It also means no generated `RouteContext`.
- [x] UI: `user-menu.tsx` (avatar → Dropdown) replaces `sign-out-button.tsx`, which is deleted; the
      email moved out of the header into the menu; `allowed-users-dialog.tsx` lists admins as a
      non-removable group above the invited rows.
- [x] Verified `next build` still succeeds with every server secret blank. That property was at risk
      (see the DAL note below) and CI depends on it.
- [x] `verify-flow.ts` gained an allowlist lifecycle block — invite / list / conflict / reject /
      revoke against real Firestore, at **zero Anthropic spend**. Doc-id encoding is exactly the bug
      class that passes every unit test.

### Two things this got wrong on the first pass

- **The Firestore read must sit OUTSIDE `getSessionUser`'s try/catch.** That catch turns everything
  into "not signed in", which is right for a bad cookie and very wrong for a Firestore outage: the
  user would be bounced to `/login`, sign-in would hit the same failure at `session/route.ts`, and —
  because that call is not in a try either — return a 500 whose HTML body `login/page.tsx` cannot
  parse, leaving them told **"Sign-in was refused."** An infra blip would have been indistinguishable
  from revocation. The read is now outside the try, and the sign-in gate has its own try returning
  **503**, distinct from the 403.
- **Keeping a non-empty refinement on `ADMIN_EMAILS` would have been worse than the problem.** A
  failed parse invalidates the whole object and `serverEnv()` never caches a failure, so it re-throws
  forever — and its other callers are `anthropic/client.ts`, so an unset `ADMIN_EMAILS` would have
  taken down every Anthropic call. The coupling was defensible when empty meant nobody could sign in.
  It is not now that empty just means no admins, which is recoverable and leaves invited users
  working.

### What this contradicts in PLAN.md

- **The allowlist is no longer an env var.** PLAN.md's auth phase, its architecture diagram, the
  layering table's Auth row and the data-model block have all been amended, and the auth phase now
  points here. This overturns a settled decision, at the user's request — recorded rather than
  quietly re-decided.
- **`ALLOWED_DOMAINS` is gone.** Nothing ever used it; it was empty in every config.

### Known limits, accepted

- **An open SSE stream survives a revocation by up to `SELF_CLOSE_MS` (4 min).** The relay
  authenticates once at connect; the reconnect is what denies. True before this change too, but it
  becomes visible now that revoking is a button a human presses and watches. The 15s heartbeat is the
  cheap hook if it ever matters.
- **CI has probably never gone green.** `ci.yml` runs `typecheck` before `build`, but
  `RouteContext`/`PageProps`/`LayoutProps` exist only under `.next/`, which is gitignored — so on a
  fresh checkout `npm run typecheck` fails on the ten existing files that use them. Pre-existing and
  unrelated to this change, so **left untouched**; the fix is to move `build` above `typecheck`.

---

## Streaming chat showed only the newest fragment

Reported from real use: while the agent answers, the chat showed one scrap of text that kept being
replaced, and the full answer appeared only once the turn ended.

- **`event_delta.delta.index` is the index of an entry in the previewed event's content array, not a
  sequence number.** Every fragment of one text block carries the same index, so the buffer has to
  append; `use-notebook-stream` was assigning, which kept only the newest fragment until the
  buffered `agent.message` replaced the preview wholesale. The SDK's own
  `accumulateManagedAgentsEvent` is the authority: same index → `existing.text + fragment.text`.
- **This contradicted PLAN.md, which had it right all along** — "accumulate them into a scratch
  buffer keyed by event id". The comment that justified assigning claimed a resume replays deltas
  and would double-count. It does not: deltas carry no cursor and "never appear in event history",
  so the replay lists persisted events only. A wrong comment outlived the plan it contradicted;
  `applyDelta` is now an exported pure function with a test, so the semantics cannot flip silently
  again.
- **Appending turned two latent preview-lifecycle gaps into visible corruption**, both fixed here:
  the relay opens the upstream stream _before_ replaying history, so a message that completes in
  that window is rendered from the replay while its deltas are still queued — the client now drops
  deltas for an id already in `seen`, rather than rebuilding the tail as a phantom bubble no later
  event can clear. And `session.status_rescheduled` now clears previews too: a model request that
  ends early produces no buffered message at all, so its abandoned preview was being concatenated in
  front of the retry's answer.

### Two pre-existing bugs the same review surfaced, also fixed

- **`rescheduling` read as not-running.** A rescheduled session is recovering and queued to resume,
  but `setRunning(event.status === "running")` emptied the activity indicator, so a recovering
  agent looked dead and invited a re-send. It now counts as running.
- **The relay never requested `agent.thinking` previews.** `event_deltas` listed only
  `agent.message`, and the SDK is explicit that "only previews of the requested event types are
  sent" — so the `event_start` → thinking arm in `normalizeEvent` was unreachable in production
  (`events.test.ts:77` passed on a path that never ran) and "Thinking…" could only appear _after_
  thinking had finished. Both types are requested now.

---

## Link previews (Open Graph / Twitter Cards)

Sharing any Claudebook URL produced a text-only preview: the root layout exported `title` and
`description` and nothing else. Added `metadataBase`, an `openGraph` block, `twitter.card`, a
generated `opengraph-image` and a `robots.ts`.

- [x] `src/lib/config/site.ts` — `SITE_URL` / `SITE_NAME` / `SITE_DESCRIPTION` as plain constants.
      Not env vars: the origin is fixed by the backend name and region, and a `NEXT_PUBLIC_*` would
      need syncing across `.env.local.example`, both `apphosting*.yaml`, `ci.yml` and `env.ts`.
- [x] `src/app/opengraph-image.tsx` — 1200x630, built with `ImageResponse`. Prerendered static, 38 KB.
- [x] `src/app/robots.ts`, and `robots: { index: false, follow: true }` in the root layout.

### Three things that only turned up by reading the installed source

- **A missing `metadataBase` fails silently, it does not error.** The docs say a relative URL without
  one is a build error, but for a _static metadata route file_ like `opengraph-image`,
  `resolvers/resolve-opengraph.js` only `warnOnce`s and falls back to `localhost:3000`. Production
  would have shipped `og:image="http://localhost:3000/..."` and lost the image on every platform.
- **`robots.txt` must not `Disallow`.** Twitterbot and facebookexternalhit both honour it, so the
  obvious "it's invite-only, block everything" would have broken the previews it was meant to
  accompany. The `noindex` meta tag is what hides the site; robots.txt stays permissive.
- **`next/og` bundles exactly one font** — `Geist-Regular.ttf`, weight 400. There is no bold, so the
  card's hierarchy is size and colour only. `ImageResponse` also hardcodes `content-type: image/png`
  with no JPEG option, which is why the art is flat-coloured: it keeps the PNG under WhatsApp's
  ~300 KB ceiling and Slack's ~1 MB proxy limit.

### Not changed, deliberately

- **No `generateMetadata` on `notebooks/[id]`.** A notebook title in an OG tag would leak exactly what
  the 404-not-403 rule exists to hide. Notebook pages inherit the generic site card.
- **`/` still redirects crawlers to `/login`.** Verified with `curl -sL -A "WhatsApp/2.23.20.0 A"`:
  the 307 is followed and `/login` returns 200 with the tags, which it inherits from the root layout.
  A public 200 shell at `/` would remove the dependency on redirect-following, but it is a change to
  the auth gate and was not needed.

---

## Deferred (explicitly out of scope for v1)

- Source viewer / re-download of uploaded sources (Anthropic returns `downloadable: false` for uploads;
  would need a Cloud Storage mirror)
- NotebookLM "Studio" one-click generators (study guide, briefing doc, FAQ, timeline, mind map)
- Sharing notebooks between users
