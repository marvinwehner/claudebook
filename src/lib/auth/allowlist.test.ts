import { describe, expect, it } from "vitest";

import { isAllowed, parseList, type Allowlist } from "./allowlist";

describe("parseList", () => {
  it("splits, trims and lowercases", () => {
    expect(parseList(" A@b.com , C@D.com ")).toEqual(["a@b.com", "c@d.com"]);
  });

  it("drops blanks and handles undefined", () => {
    expect(parseList("a@b.com,, ,")).toEqual(["a@b.com"]);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList("")).toEqual([]);
  });
});

describe("isAllowed", () => {
  const list: Allowlist = {
    emails: ["marvin.wehner@gmx.de"],
    domains: ["example.com"],
  };

  it("matches an allowlisted address regardless of case or padding", () => {
    expect(isAllowed("marvin.wehner@gmx.de", list)).toBe(true);
    expect(isAllowed("  Marvin.Wehner@GMX.de ", list)).toBe(true);
  });

  it("matches an allowlisted domain", () => {
    expect(isAllowed("anyone@example.com", list)).toBe(true);
  });

  it("rejects a non-allowlisted address", () => {
    expect(isAllowed("someone@else.com", list)).toBe(false);
  });

  it("does not treat a domain as a suffix match", () => {
    // notexample.com must not pass because it ends with example.com.
    expect(isAllowed("a@notexample.com", list)).toBe(false);
    expect(isAllowed("a@sub.example.com", list)).toBe(false);
  });

  it("uses the last @ so an address-shaped local part cannot spoof a domain", () => {
    expect(isAllowed('"a@example.com"@evil.test', list)).toBe(false);
  });

  it("fails closed on empty, missing or malformed input", () => {
    expect(isAllowed(null, list)).toBe(false);
    expect(isAllowed(undefined, list)).toBe(false);
    expect(isAllowed("", list)).toBe(false);
    expect(isAllowed("not-an-email", list)).toBe(false);
    expect(isAllowed("trailing@", list)).toBe(false);
  });

  it("fails closed when both lists are empty, rather than allowing everyone", () => {
    const empty: Allowlist = { emails: [], domains: [] };
    expect(isAllowed("marvin.wehner@gmx.de", empty)).toBe(false);
  });
});
