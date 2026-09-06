/**
 * The committed configuration of the one shared Claudebook agent, and of the
 * one shared environment.
 *
 * There is deliberately no agent or environment per notebook. Isolation is the
 * session's job — each session gets a fresh container and sessions do not share
 * filesystem state. Per-notebook variation (model, custom instructions) happens
 * at session-create time via `agent_with_overrides`, which is session-local and
 * creates no new agent version.
 *
 * `scripts/provision.ts` reconciles the live objects against this file. Nothing
 * else should mutate them.
 */

export const AGENT_NAME = "claudebook-notebook";
export const ENVIRONMENT_NAME = "claudebook-default";

/**
 * Two different paths, and mixing them up is the easy mistake here.
 *
 * `MOUNT_PATH_PREFIX` is what we send as a resource's `mount_path`;
 * `SOURCES_DIR` is where it actually appears inside the container, because the
 * platform roots uploads at /mnt/session/uploads. The agent's prompt must use
 * the container path.
 */
export const MOUNT_PATH_PREFIX = "/sources";
export const SOURCES_DIR = `/mnt/session/uploads${MOUNT_PATH_PREFIX}`;

/** Anything the agent writes here is captured by the Files API as an artifact. */
export const OUTPUTS_DIR = "/mnt/session/outputs";

export const DEFAULT_MODEL = "claude-sonnet-5";
export const OPUS_MODEL = "claude-opus-5";

/** The two models a notebook may pin. Fixed at session-create; see ensureSession. */
export const NOTEBOOK_MODELS = [DEFAULT_MODEL, OPUS_MODEL] as const;
export type NotebookModel = (typeof NOTEBOOK_MODELS)[number];

export function isNotebookModel(value: unknown): value is NotebookModel {
  return typeof value === "string" && (NOTEBOOK_MODELS as readonly string[]).includes(value);
}

export const AGENT_SYSTEM_PROMPT = `You are the research assistant inside a Claudebook notebook.

The user's sources are mounted read-only at ${SOURCES_DIR}/. Use read, \
grep and glob to work through them; use bash when a source needs unpacking or \
converting first.

How to answer:
- Ground every factual claim in the sources. Read before you answer — do not \
answer from prior knowledge about a document you have not opened.
- Cite the source of each claim inline as [filename], using the file's name as \
it appears under ${SOURCES_DIR}/.
- When the sources do not answer the question, say so plainly and say what they \
do cover. Do not fill the gap with a guess.
- When the sources disagree, say that and cite both.
- Use web_search or web_fetch only when the user asks for something beyond the \
sources, and mark any such claim as coming from outside them.

Artifacts:
- When the user asks for a document — a summary, briefing, study guide, \
timeline, FAQ — write it to ${OUTPUTS_DIR}/ as Markdown with a descriptive \
filename, then tell the user what you wrote and give them a short summary. \
Files written there are collected and shown alongside the conversation.
- Keep ordinary conversational answers in the conversation. Do not write a file \
for every reply.`;

export const AGENT_TOOLS = [
  // The whole built-in toolset: read/grep/glob over the mounted sources, write
  // for artifacts, bash for unpacking, web_search/web_fetch for anything the
  // sources do not cover.
  {
    type: "agent_toolset_20260401" as const,
    default_config: { enabled: true },
  },
];

export const ENVIRONMENT_CONFIG = {
  type: "cloud" as const,
  networking: { type: "unrestricted" as const },
};

export const AGENT_CONFIG = {
  name: AGENT_NAME,
  model: DEFAULT_MODEL,
  system: AGENT_SYSTEM_PROMPT,
  tools: AGENT_TOOLS,
  description: "Grounded question answering and artifact generation over a notebook's sources.",
};

/** The `mount_path` to send when attaching a source with this filename. */
export function mountPathFor(filename: string): string {
  return `${MOUNT_PATH_PREFIX}/${filename}`;
}

/** Where that source is readable from inside the container. */
export function containerPathFor(filename: string): string {
  return `${SOURCES_DIR}/${filename}`;
}
