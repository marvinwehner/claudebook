<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Claudebook

A private, invite-only NotebookLM clone. Each notebook is backed by an **Anthropic Managed Agents
session**: Anthropic runs the agent loop and hosts the container where the notebook's sources are
mounted and the agent's tools execute. We build a good UI over that session — there is no retrieval
pipeline and no LLM loop in this repo, and adding one would be the wrong shape.

Next 16 (App Router) - HeroUI v3 - Firebase Auth + Firestore - Firebase App Hosting (europe-west4).

## Commands

| Command                                         |                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                                   | local dev                                                                 |
| `npm run build` / `lint` / `typecheck` / `test` | the four checks — run all before committing                               |
| `npm run format`                                | prettier, printWidth 100                                                  |
| `npm run provision`                             | reconcile the shared Anthropic agent + environment (idempotent)           |
| `npm run verify:flow`                           | full lifecycle against real Firestore and the real API. **Spends money.** |

`.env.local` is gitignored; `.env.local.example` lists what it needs. Local Admin SDK access needs
`gcloud auth application-default login` — there is no service-account JSON anywhere, on purpose.

## Layering — the one structural rule

Route handler -> service -> repository / Anthropic gateway.

- Route handlers (`src/app/api/**`) do HTTP only: auth, zod-validate, call a service, map errors.
  They never import the Anthropic SDK or `firebase-admin` directly.
- Services (`src/lib/notebooks/*`) are the **only** place Firestore and Anthropic combine.
- `src/lib/firestore/*` knows nothing about Anthropic; `src/lib/anthropic/*` knows nothing about
  Firestore. Rehydration's side effects are persisted by the service, not by the gateway.

## Non-negotiable

- **The browser never talks to Firestore or Anthropic.** It holds a `__session` cookie and calls our
  routes. `firestore.rules` is a flat default-deny and must stay that way. The name `__session`
  follows Firebase Hosting's convention — its CDN forwards only a cookie of that name — so don't
  rename it without checking what App Hosting's CDN actually does.
- **Never accept a `file_id` — or any Anthropic id — from a client.** Anthropic files are
  _workspace_-scoped, not user-scoped, so Firestore's `ownerId` is the only boundary between two
  users. Resolve every id against the notebook's own session first.
- **Every handler opens with `requireUser()` and an ownership check**, and returns **404, not 403**,
  for someone else's notebook — a 403 confirms the id exists.

## Anthropic — what the docs get wrong

Load the `claude-api` skill before touching SDK code. Beyond it, these were found by running it:

- **A `system.message` cannot be sent on its own.** It must be in the same request as, and
  immediately after, a `user.message` or tool result. So `ensureSession()` _returns_ the rehydration
  note and `sendUserMessage(id, text, note)` carries it.
- **`files.list({ scope_id })` does not mean "outputs".** It also returns the sources mounted into
  the session, which come back `downloadable: false`. Filter on `downloadable === true`, and retry
  on the **filtered** count — retrying on the raw count is satisfied instantly by the mounted
  sources and misses the real artifact while indexing catches up.
- The Files API is out of beta: `client.files.upload({ file })`, and there is **no `purpose`
  parameter**. The exception is session-scoped listing — `client.beta.files.list` with
  `betas: ['managed-agents-2026-04-01']` passed explicitly, because the SDK adds only the Files one.
- Mount paths have two forms and conflating them silently breaks grounding: send
  `mount_path: "/sources/x.md"`, but the agent reads it at `/mnt/session/uploads/sources/x.md`.
  `lib/anthropic/agent.ts` exports both.
- A session's **model is fixed at create time**, so changing a notebook's model means a new session.
  That is why the UI confirms it.
- One shared agent and one shared environment, never one per notebook — isolation is already the
  session's job. Per-notebook variation goes through `agent_with_overrides` at session create, and
  overrides **replace in full, never merge**.

## HeroUI v3

A ground-up rewrite; every v2 tutorial is wrong. No `HeroUIProvider`, no `tailwind.config.js`, no
`Navbar`. Check `heroui.com/docs/react/*` or the installed `.d.ts` rather than recalling.

- Composition, not props: `<TextField><Label/><Input/></TextField>` and
  `<Select><Label/><Select.Trigger>...</Select.Trigger><Select.Popover><ListBox><ListBox.Item/>`.
- `onPress`, not `onClick`. `useOverlayState()`, not `useDisclosure`.
- Upload uses `DropZone` + `FileTrigger` from `react-aria-components` — a direct dependency of
  `@heroui/react`, so it is version-aligned by construction. Do not add it as its own dependency.
- Streamdown uses shadcn token names. `globals.css` maps them onto HeroUI's, and
  `.claudebook-markdown` remaps `--color-muted` locally because shadcn's `muted` is a _surface_
  while HeroUI's is a _text_ grey.

## Next 16 + App Hosting

- **No `proxy.ts`, no `cacheComponents`** — App Hosting supports neither. Auth gating lives in
  server components instead.
- `params` is a Promise. `RouteContext<'/api/...'>` and `PageProps<'/...'>` are global but
  _generated_: a new route fails `tsc` until you `npm run build`.
- In a server component use `getSessionUser()` + `redirect()`, **not** `requireUser()`. A page
  renders concurrently with its layout, so `requireUser()` throws before the layout's redirect
  lands. `requireUser()` is the route-handler form.
- Requests are capped at **5 minutes and it is not configurable**. The SSE relay self-closes at 4
  and lets EventSource resume via `Last-Event-ID`; keep `concurrency: 20` so open streams cannot
  starve normal SSR.
- Console-set env vars **silently override** `apphosting.yaml`. Use the YAML only.
- The CLI flag is `--primary-region`, not `--location`. Running `backends:create` without a TTY
  silently skips the GitHub link, and there is no `backends:update` to add one afterwards.

## React 19

Two habits the lint rules reject, both with clean fixes rather than suppressions: mount guards use
`useSyncExternalStore` (not `setState` inside an effect), and per-render bookkeeping lives in state
(not a ref written during render).

## Tooling gotchas

- `server-only` **throws** outside Next's `react-server` condition, so a plain script cannot import
  anything that uses it. Use `tsx --conditions=react-server`, as `npm run verify:flow` does;
  `scripts/provision.ts` deliberately builds its own client instead, because a setup script is not
  a request path.
- A standalone `tsx` script needs the `.mts` extension for top-level `await`.

## Where the plan lives

- `docs/PLAN.md` — the settled why/what. **If you think a decision is wrong, say so and stop. Do not
  quietly re-decide.**
- `docs/TASKS.md` — the mutable board, and the only state that survives into a new session. Tick items as
  they land, and record it there when reality contradicts the plan. It has, several times; that is
  normal and worth writing down rather than routing around.
