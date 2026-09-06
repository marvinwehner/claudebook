# Handoff prompt

Paste the block below into a fresh Claude Code session in this repo.

> **The Anthropic API key is deliberately not in this file.** `PROMPT.md` is tracked by git and pushed
> to GitHub; a live key committed here would be picked up by secret scanning and revoked. Keep it in
> `.env.local` (already gitignored via `.env*.local`) and paste it into the session yourself when the
> agent asks, or export it as `ANTHROPIC_API_KEY` before starting.

---

```
Build Claudebook, a NotebookLM clone. Read PLAN.md first — it is the full
architecture and the research it rests on — then TASKS.md, which is the working
checklist. Work through TASKS.md in phase order, ticking items as they land and
committing as you go.

Context you need that isn't in the repo:
- Anthropic workspace 'Claudebook' (wrkspc_01HBxmxGr7npSG8G28t8uGsb). The API key
  is in .env.local as ANTHROPIC_API_KEY — read it from there, and ask me for it if
  that file doesn't exist yet. It also needs to go into Secret Manager as
  'anthropic-api-key'. Never commit it and never expose it to the browser.
- Firebase project: claudebook-lm. firebase + gcloud are already authenticated.
- Allowlist for local dev: ALLOWED_EMAILS=marvin.wehner@gmx.de
- git push currently fails with 403 (credentials are 'dubdia', remote is
  'mavonic/claudebook'). Commit locally; ask me before trying to push.

Rules:
- PLAN.md's decisions are settled. If you think one is wrong, say so and stop —
  don't silently re-decide.
- Load the `claude-api` skill before writing any Anthropic SDK code. Several
  things in your training data are stale here: the Files API has no `purpose`
  parameter, and Managed Agents is `client.beta.{agents,environments,sessions}`.
- HeroUI v3 is a ground-up rewrite; every v2 tutorial is wrong. There is no
  HeroUIProvider, no tailwind.config.js, no Navbar component. Check
  heroui.com/docs/react/* rather than recalling.
- Phase 0 has three steps only I can do in a browser. They are marked [!] in
  TASKS.md. Everything through phase 6 can be built and run locally without them;
  only phase 7 (deploy) is blocked.
- Verify each phase against the "Verify:" line in TASKS.md before moving on.

Start with phase 2 (scaffold). Phase 0b's gcloud/firebase provisioning needs
billing enabled first, so ask me whether that's done before running it.
```
