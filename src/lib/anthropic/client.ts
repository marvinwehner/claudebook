import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/lib/config/env";

/**
 * The Anthropic client for the running app.
 *
 * `server-only` here is the guard that keeps ANTHROPIC_API_KEY out of any
 * browser bundle — importing this from a client component is a build error
 * rather than a leaked key. It also means `scripts/provision.ts` cannot import
 * it (server-only throws outside Next's react-server condition); the script
 * builds its own client, which is correct — it is not a request path.
 */
let cached: Anthropic | undefined;

export function anthropic(): Anthropic {
  if (!cached) {
    cached = new Anthropic({ apiKey: serverEnv().ANTHROPIC_API_KEY });
  }
  return cached;
}

/** IDs of the shared agent and environment, provisioned by scripts/provision.ts. */
export function agentId(): string {
  return serverEnv().ANTHROPIC_AGENT_ID;
}

export function environmentId(): string {
  return serverEnv().ANTHROPIC_ENVIRONMENT_ID;
}
