/**
 * Reconciles the one shared Anthropic agent and environment with the config
 * committed in src/lib/anthropic/agent.ts.
 *
 * Idempotent by name: run it as often as you like. The second run of an
 * unchanged config creates nothing and updates nothing.
 *
 *   npx tsx --env-file=.env.local scripts/provision.ts
 *
 * It builds its own client rather than importing lib/anthropic/client.ts —
 * that module is `server-only`, which throws outside Next's react-server
 * condition, and rightly so: this is a setup script, not a request path.
 */
import Anthropic from "@anthropic-ai/sdk";

import {
  AGENT_CONFIG,
  AGENT_NAME,
  ENVIRONMENT_CONFIG,
  ENVIRONMENT_NAME,
} from "../src/lib/anthropic/agent";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    "ANTHROPIC_API_KEY is not set. Run with: npx tsx --env-file=.env.local scripts/provision.ts",
  );
  process.exit(1);
}

const client = new Anthropic({ apiKey });

async function findByName<T extends { name?: string | null; archived_at?: string | null }>(
  pages: AsyncIterable<T>,
  name: string,
): Promise<T | undefined> {
  for await (const item of pages) {
    // An archived object cannot back new sessions, so treat it as absent and
    // let a fresh one be created.
    if (item.name === name && !item.archived_at) return item;
  }
  return undefined;
}

/**
 * Deep "everything the committed config sets, the live object already has".
 * Same story as the agent's tools: the API fills in defaults the config omits —
 * `packages`, and every optional field of `limited` networking — so comparing
 * the whole object would never match.
 */
function subsetMatches(live: unknown, committed: unknown): boolean {
  if (Array.isArray(committed)) {
    return (
      Array.isArray(live) &&
      live.length === committed.length &&
      committed.every((value, index) => subsetMatches(live[index], value))
    );
  }
  if (committed === null || typeof committed !== "object") return live === committed;
  if (live === null || typeof live !== "object") return false;

  return Object.entries(committed).every(([key, value]) =>
    subsetMatches((live as Record<string, unknown>)[key], value),
  );
}

async function ensureEnvironment() {
  const existing = await findByName(client.beta.environments.list(), ENVIRONMENT_NAME);

  if (!existing) {
    const created = await client.beta.environments.create({
      name: ENVIRONMENT_NAME,
      config: ENVIRONMENT_CONFIG,
    });
    console.log(`environment  created  ${created.id}  (${ENVIRONMENT_NAME})`);
    return created;
  }

  if (subsetMatches(existing.config, ENVIRONMENT_CONFIG)) {
    console.log(`environment  ok       ${existing.id}  (${ENVIRONMENT_NAME})`);
    return existing;
  }

  // Update in place. Omitted fields preserve their existing value, so sending
  // the committed config only moves what this repo actually controls.
  const updated = await client.beta.environments.update(existing.id, {
    config: ENVIRONMENT_CONFIG,
  });
  console.log(`environment  updated  ${updated.id}  (${ENVIRONMENT_NAME})`);
  return updated;
}

/**
 * `type:skill_id`, sorted and joined. Same story as tools: the API echoes a
 * `version` back ("latest", for an unpinned skill) where the committed config
 * omits the field entirely, so version cannot be part of the comparison.
 * Sorted so that config order is not a false difference.
 */
function skillKeys(skills: unknown): string {
  const list = (skills as Array<{ type?: string; skill_id?: string }> | undefined) ?? [];
  return list
    .map((skill) => `${skill.type}:${skill.skill_id}`)
    .sort()
    .join(",");
}

/** True when the live agent already matches the committed config. */
function agentMatches(agent: {
  model?: unknown;
  system?: string | null;
  description?: string | null;
  tools?: unknown;
  skills?: unknown;
}): boolean {
  const liveModel =
    typeof agent.model === "string" ? agent.model : (agent.model as { id?: string })?.id;

  return (
    liveModel === AGENT_CONFIG.model &&
    agent.system === AGENT_CONFIG.system &&
    agent.description === AGENT_CONFIG.description &&
    // The API returns tools resolved (defaults filled in), so comparing the
    // whole object would never match. The set of toolset types is what we
    // actually control from here.
    JSON.stringify(
      (agent.tools as Array<{ type: string }> | undefined)?.map((t) => t.type) ?? [],
    ) === JSON.stringify(AGENT_CONFIG.tools.map((t) => t.type)) &&
    skillKeys(agent.skills) === skillKeys(AGENT_CONFIG.skills)
  );
}

async function ensureAgent() {
  const existing = await findByName(client.beta.agents.list(), AGENT_NAME);

  if (!existing) {
    const created = await client.beta.agents.create(AGENT_CONFIG);
    console.log(`agent        created  ${created.id}  v${created.version}  (${AGENT_NAME})`);
    return created;
  }

  if (agentMatches(existing)) {
    console.log(`agent        ok       ${existing.id}  v${existing.version}  (${AGENT_NAME})`);
    return existing;
  }

  // Update in place — never create a second agent. Each update bumps the
  // version; sessions already running keep the version they pinned.
  const updated = await client.beta.agents.update(existing.id, AGENT_CONFIG);
  console.log(
    `agent        updated  ${updated.id}  v${existing.version} -> v${updated.version}  (${AGENT_NAME})`,
  );
  return updated;
}

async function main() {
  const environment = await ensureEnvironment();
  const agent = await ensureAgent();

  console.log("\nPut these in .env.local and apphosting.yaml:\n");
  console.log(`ANTHROPIC_AGENT_ID=${agent.id}`);
  console.log(`ANTHROPIC_ENVIRONMENT_ID=${environment.id}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
