import { describe, expect, it } from "vitest";

import {
  addUsage,
  formatActive,
  formatCost,
  formatTokens,
  isEmptyUsage,
  maxUsage,
  notebookUsageFrom,
  rollUp,
  sameUsage,
  totalsFrom,
  ZERO_USAGE,
  type UsageTotals,
} from "./usage";

const usage = (patch: Partial<UsageTotals> = {}): UsageTotals => ({ ...ZERO_USAGE, ...patch });

const EMPTY = { retired: ZERO_USAGE, current: ZERO_USAGE, currentSessionId: null };

describe("addUsage", () => {
  it("adds every field", () => {
    const a = usage({
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      webSearches: 5,
      activeSeconds: 6,
      costCents: 7,
    });

    expect(addUsage(a, a)).toEqual(
      usage({
        inputTokens: 2,
        outputTokens: 4,
        cacheReadTokens: 6,
        cacheCreationTokens: 8,
        webSearches: 10,
        activeSeconds: 12,
        costCents: 14,
      }),
    );
  });

  it("leaves its operands alone", () => {
    const a = usage({ costCents: 10 });
    addUsage(a, usage({ costCents: 5 }));
    expect(a.costCents).toBe(10);
  });

  it("treats ZERO_USAGE as the identity", () => {
    const a = usage({ inputTokens: 9, costCents: 3 });
    expect(addUsage(a, ZERO_USAGE)).toEqual(a);
  });
});

describe("sameUsage", () => {
  it("is true only when every field matches", () => {
    const a = usage({ inputTokens: 5, costCents: 12, activeSeconds: 30 });
    expect(sameUsage(a, { ...a })).toBe(true);
    expect(sameUsage(ZERO_USAGE, ZERO_USAGE)).toBe(true);
  });

  // Guards the "skip the redundant write" path: a field it failed to compare
  // would be one a reconnect silently drops.
  it("notices a change in any single field", () => {
    const base = usage({
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 1,
      cacheCreationTokens: 1,
      webSearches: 1,
      activeSeconds: 1,
      costCents: 1,
    });

    for (const key of Object.keys(base) as Array<keyof typeof base>) {
      expect(sameUsage(base, { ...base, [key]: 2 })).toBe(false);
    }
  });
});

describe("isEmptyUsage", () => {
  it("is true for a notebook that has never run a turn", () => {
    expect(isEmptyUsage(ZERO_USAGE)).toBe(true);
  });

  // A session bills for runtime the moment its container comes up, so a turn
  // can have cost money before it has produced a single output token.
  it("is false once anything has been consumed", () => {
    expect(isEmptyUsage(usage({ costCents: 1 }))).toBe(false);
    expect(isEmptyUsage(usage({ inputTokens: 1 }))).toBe(false);
    expect(isEmptyUsage(usage({ outputTokens: 1 }))).toBe(false);
  });
});

describe("formatCost", () => {
  it("renders minor units as dollars", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(7)).toBe("$0.07");
    expect(formatCost(83)).toBe("$0.83");
    expect(formatCost(5000)).toBe("$50.00");
    expect(formatCost(123456)).toBe("$1234.56");
  });
});

describe("formatTokens", () => {
  it("leaves small counts alone", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("abbreviates thousands, dropping a trailing zero", () => {
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(15_500)).toBe("15.5k");
    expect(formatTokens(15_549)).toBe("15.5k");
  });

  it("drops the decimal once it stops buying precision", () => {
    expect(formatTokens(148_000)).toBe("148k");
    expect(formatTokens(999_400)).toBe("999k");
  });

  // 999_600 rounds to 1000k, which should read as 1M rather than a four-digit k.
  it("crosses into millions rather than printing 1000k", () => {
    expect(formatTokens(999_600)).toBe("1M");
  });

  it("abbreviates millions", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(2_350_000)).toBe("2.4M");
  });
});

describe("formatActive", () => {
  it("renders seconds, minutes and hours", () => {
    expect(formatActive(0)).toBe("0s");
    expect(formatActive(59)).toBe("59s");
    expect(formatActive(60)).toBe("1m 0s");
    expect(formatActive(252)).toBe("4m 12s");
    expect(formatActive(3600)).toBe("1h 0m");
    expect(formatActive(3840)).toBe("1h 4m");
  });

  it("rounds fractional seconds", () => {
    expect(formatActive(11.6)).toBe("12s");
  });
});

describe("maxUsage", () => {
  // The guard against an out-of-order write: three producers report a
  // session's usage and nothing orders them, so an older snapshot can land
  // after a newer one.
  it("keeps the larger of each field, whichever side it is on", () => {
    const older = usage({ inputTokens: 10, outputTokens: 500, costCents: 5 });
    const newer = usage({ inputTokens: 40, outputTokens: 900, costCents: 12 });

    expect(maxUsage(older, newer)).toEqual(newer);
    expect(maxUsage(newer, older)).toEqual(newer);
  });

  it("merges field-wise rather than picking a whole side", () => {
    const a = usage({ inputTokens: 10, costCents: 90 });
    const b = usage({ inputTokens: 99, costCents: 1 });

    expect(maxUsage(a, b)).toEqual(usage({ inputTokens: 99, costCents: 90 }));
  });
});

describe("totalsFrom / notebookUsageFrom", () => {
  // The path every notebook created before usage tracking existed takes on
  // its first read.
  it("reads a document with no usage field as zero", () => {
    expect(notebookUsageFrom(undefined)).toEqual({
      retired: ZERO_USAGE,
      current: ZERO_USAGE,
      currentSessionId: null,
    });
  });

  // recordSessionUsage writes only `usage.current`, so `usage.retired` stays
  // absent until the first roll-up.
  it("reads a half-written document", () => {
    const result = notebookUsageFrom({
      current: { inputTokens: 5, costCents: 33 },
      currentSessionId: "sesn_1",
    });

    expect(result.retired).toEqual(ZERO_USAGE);
    expect(result.current).toEqual(usage({ inputTokens: 5, costCents: 33 }));
    expect(result.currentSessionId).toBe("sesn_1");
  });

  it("fills in fields a document was saved before", () => {
    expect(totalsFrom({ costCents: 7 })).toEqual(usage({ costCents: 7 }));
  });
});

describe("rollUp", () => {
  it("banks the live session and starts the next one at zero", () => {
    const before = {
      retired: usage({ costCents: 100, inputTokens: 3 }),
      current: usage({ costCents: 33, inputTokens: 5 }),
      currentSessionId: "sesn_old",
    };

    expect(rollUp(before, "sesn_new")).toEqual({
      retired: usage({ costCents: 133, inputTokens: 8 }),
      current: ZERO_USAGE,
      currentSessionId: "sesn_new",
    });
  });

  // A transaction can be retried, and the model-change path runs after the
  // claim path has already rolled up in some orderings.
  it("is idempotent — a second roll-up adds nothing", () => {
    const once = rollUp(
      { retired: ZERO_USAGE, current: usage({ costCents: 33 }), currentSessionId: "a" },
      "b",
    );

    expect(rollUp(once, "b").retired).toEqual(usage({ costCents: 33 }));
  });

  it("clears the session id when nothing replaces it", () => {
    expect(rollUp({ ...EMPTY, currentSessionId: "a" }, null).currentSessionId).toBeNull();
  });
});
