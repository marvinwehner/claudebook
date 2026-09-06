<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
  <img src="docs/logo.svg" alt="" width="72" height="72">
</picture>

# Claudebook

A private, invite-only NotebookLM clone. You create a notebook, drop your sources into it, and ask
questions that get answered from those sources — with inline `[filename]` citations, and with longer
documents (summaries, briefings, study guides, timelines) written out as downloadable artifacts.

Each notebook is backed by an **Anthropic Managed Agents session**: Anthropic runs the agent loop and
hosts the container where the notebook's sources are mounted and the agent's tools execute. There is
no retrieval pipeline and no LLM loop in this repo — it is a UI, an ownership boundary, and a
streaming relay over that session.

## Access

**https://claudebook--claudebook-lm.europe-west4.hosted.app**

Sign-in is Google only, and the address must be on the allowlist (`ALLOWED_EMAILS` /
`ALLOWED_DOMAINS` in `apphosting.yaml`) — everyone else gets bounced at `/login`. The allowlist is
re-checked on every request, not just at sign-in, so removing an address takes effect immediately.
If both lists are empty, nobody gets in; it fails closed on purpose.

## What it does

- **Notebooks** — create one with a title, an icon, a model and optional custom instructions.
  Deleting a notebook archives its Anthropic session and removes the uploaded files on both sides.
- **Sources** — drag-and-drop or file-picker upload, up to 500 per notebook and 32 MB each. They are
  mounted read-only into the session's container and the agent reads them with grep/glob/read/bash.
- **Grounded chat** — streamed token by token, with thinking and tool activity visible and a Stop
  button. Answers cite each claim as `[filename]`, and say so plainly when the sources don't cover
  the question instead of guessing.
- **Artifacts** — anything the agent writes to the outputs directory shows up in the right-hand rail,
  previews as Markdown, and downloads with its real filename.
- **Model switching** — Sonnet 5 or Opus 5, changeable per notebook. A session's model is fixed at
  create time, so switching starts a fresh session and loses the conversation; the UI confirms first.

## How it works

```
browser  ──`__session` cookie──>  Next route handler  ──>  service  ──┬──>  Firestore (ownership)
                                                                     └──>  Anthropic session
```

## Local development

Needs Node 22, the Firebase CLI, and access to the `claudebook-lm` project.

```bash
npm install
cp .env.local.example .env.local     # then fill in the values it lists
gcloud auth application-default login # Admin SDK creds; there is no service-account JSON, on purpose
npm run provision                     # reconciles the shared agent + environment, prints their ids
npm run dev
```

`npm run provision` is idempotent — run it whenever `src/lib/anthropic/agent.ts` changes, and paste
the ids it prints into `.env.local`.

| Command                                         |                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                                   | local dev                                                                 |
| `npm run build` / `lint` / `typecheck` / `test` | the four checks — run all before committing                               |
| `npm run format`                                | prettier, printWidth 100                                                  |
| `npm run provision`                             | reconcile the shared Anthropic agent + environment (idempotent)           |
| `npm run verify:flow`                           | full lifecycle against real Firestore and the real API. **Spends money.** |

CI runs lint, typecheck, test and build on every pull request against `main`.

## Deployment

Firebase App Hosting, backend `claudebook` in `europe-west4`, linked to this repository with a
rollout policy on `main` — pushing to `main` builds and rolls out.

All configuration lives in `apphosting.yaml` and nowhere else: env vars set in the Firebase console
**silently override** the file. `ANTHROPIC_API_KEY` is a Secret Manager secret, runtime-only, so it
never reaches a build artifact or the browser bundle; the `NEXT_PUBLIC_FIREBASE_*` values are public
by design — the boundary is Firebase Auth plus the server-side ownership checks, not their secrecy.

## Repo layout

```
src/app/(app)          notebook list + workspace (server components; auth gating lives here)
src/app/api/**         route handlers: HTTP only
src/components         HeroUI v3 UI — sources rail | chat pane | artifacts rail
src/lib/anthropic      agent config, sessions, files, event normalisation
src/lib/firestore      notebook + source repositories
src/lib/notebooks      services: the only place Firestore and Anthropic meet
scripts/provision.ts   reconcile the shared agent and environment
scripts/verify-flow.ts the full lifecycle, end to end, against the real API
```

## Docs

- [`AGENTS.md`](./AGENTS.md) — conventions, and the things the upstream docs get wrong. Read this
  before writing code.
- [`docs/PLAN.md`](./docs/PLAN.md) — the settled why and what.
- [`docs/TASKS.md`](./docs/TASKS.md) — the task board, including where reality contradicted the plan.

## License

MIT — see [LICENSE](./LICENSE).
