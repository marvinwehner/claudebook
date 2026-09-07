/**
 * What a notebook has consumed, and how it is written out.
 *
 * Deliberately neutral ground: `lib/firestore/*` may not know about Anthropic
 * and `lib/anthropic/*` may not know about Firestore, but both sides need this
 * shape — as does the client, which imports the formatters. So it lives here,
 * pure and free of I/O.
 *
 * Anthropic prices the session itself and hands back a `list_cost`, so there is
 * no per-model price table anywhere in this repo. That is on purpose: a table
 * keyed on the model would go stale, and it would silently miss the two
 * non-token components — web searches, and $0.08/hour of *active* runtime.
 *
 * Caveat worth knowing when reading the number: `list_cost` is Anthropic's
 * public list rate, not necessarily a contracted price. It is still the right
 * figure to show, because it is exactly what the session's spend cap is
 * enforced against.
 */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the prompt cache. Excluded from `inputTokens`. */
  cacheReadTokens: number;
  cacheCreationTokens: number;
  webSearches: number;
  /** Time with at least one thread running — what runtime cost is priced on. */
  activeSeconds: number;
  /**
   * Integer cents, never a float. Anthropic sends the amount as a string in
   * minor units precisely so no rounding is ever applied to money; doing the
   * arithmetic in cents and formatting only at the edge keeps that property.
   */
  costCents: number;
}

// Frozen because it is handed out by reference, not copied, from several
// readers below.
export const ZERO_USAGE: UsageTotals = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  webSearches: 0,
  activeSeconds: 0,
  costCents: 0,
});

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    webSearches: a.webSearches + b.webSearches,
    activeSeconds: a.activeSeconds + b.activeSeconds,
    costCents: a.costCents + b.costCents,
  };
}

/**
 * Field-wise max, which is what makes a stale write harmless.
 *
 * A session's usage only ever grows, but three independent producers report it
 — the relay on connect, a `session.usage` event, and the read after a turn —
 * and nothing orders them. Two reads issued at the same moment can land in
 * either order, so a plain replace lets an older snapshot overwrite a newer
 * one. Taking the max per field means the loser of that race is a no-op
 * instead of a regression that a later roll-up would make permanent.
 */
export function maxUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: Math.max(a.inputTokens, b.inputTokens),
    outputTokens: Math.max(a.outputTokens, b.outputTokens),
    cacheReadTokens: Math.max(a.cacheReadTokens, b.cacheReadTokens),
    cacheCreationTokens: Math.max(a.cacheCreationTokens, b.cacheCreationTokens),
    webSearches: Math.max(a.webSearches, b.webSearches),
    activeSeconds: Math.max(a.activeSeconds, b.activeSeconds),
    costCents: Math.max(a.costCents, b.costCents),
  };
}

export function sameUsage(a: UsageTotals, b: UsageTotals): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheCreationTokens === b.cacheCreationTokens &&
    a.webSearches === b.webSearches &&
    a.activeSeconds === b.activeSeconds &&
    a.costCents === b.costCents
  );
}

/** A notebook that has never run anything shows no readout at all, not "$0.00". */
export function isEmptyUsage(usage: UsageTotals): boolean {
  return usage.costCents === 0 && usage.inputTokens === 0 && usage.outputTokens === 0;
}

export function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;

  const thousands = tokens / 1000;
  // One decimal only while it buys precision: 15.5k reads well, 148.2k does not.
  if (thousands < 100) return `${round1(thousands)}k`;
  // Rounding first, because 999_600 rounds to 1000k and should read as 1M.
  if (Math.round(thousands) < 1000) return `${Math.round(thousands)}k`;

  return `${round1(tokens / 1_000_000)}M`;
}

export function formatActive(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${whole % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** `15.5`, but `15` rather than `15.0` — a trailing zero is noise at this size. */
function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

/**
 * How the lifetime figure is stored on a notebook.
 *
 * Anthropic meters per *session*, and a notebook outlives its sessions — one is
 * rebuilt whenever the old one expires or the model changes. Keeping the two
 * halves apart is what stops the number falling back to zero under the user.
 *
 * The shape lives here rather than beside the repository so that these readers
 * stay testable: `lib/firestore/*` is `server-only`, which throws outside
 * Next's react-server condition and so cannot be imported by a unit test.
 */
export interface NotebookUsage {
  /** Sessions that no longer exist. Only ever grows. */
  retired: UsageTotals;
  /** The live session's last known cumulative snapshot. */
  current: UsageTotals;
  /** Which session `current` describes. Guards a write that lost a rebuild race. */
  currentSessionId: string | null;
}

export const EMPTY_NOTEBOOK_USAGE: NotebookUsage = Object.freeze({
  retired: ZERO_USAGE,
  current: ZERO_USAGE,
  currentSessionId: null,
});

/**
 * Spread over the zero totals rather than read field by field: Firestore never
 * stores an undefined, so the only keys present are ones we wrote, and this way
 * a document saved before a field existed still reads cleanly.
 */
export function totalsFrom(value: unknown): UsageTotals {
  return { ...ZERO_USAGE, ...((value as Partial<UsageTotals> | undefined) ?? {}) };
}

/** Every notebook created before usage tracking existed takes this path. */
export function notebookUsageFrom(value: unknown): NotebookUsage {
  const raw = (value ?? {}) as {
    retired?: unknown;
    current?: unknown;
    currentSessionId?: string;
  };

  return {
    retired: totalsFrom(raw.retired),
    current: totalsFrom(raw.current),
    currentSessionId: raw.currentSessionId ?? null,
  };
}

/**
 * Banks the live session into `retired` and starts `current` over.
 *
 * Idempotent: a second call adds a zeroed `current`, so a retried transaction
 * cannot double-count.
 */
export function rollUp(usage: NotebookUsage, nextSessionId: string | null): NotebookUsage {
  return {
    retired: addUsage(usage.retired, usage.current),
    current: ZERO_USAGE,
    currentSessionId: nextSessionId,
  };
}
