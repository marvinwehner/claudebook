import { describe, expect, it } from "vitest";

import { isAdmin, normalizeEmail, parseList } from "./access";

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

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
  });

  // Everything below would otherwise become an allowedUsers document id.
  it("rejects a quoted local part, which is a legal address but an illegal id", () => {
    // The slash would make doc() address a subcollection rather than fail.
    expect(normalizeEmail('"a/b"@example.test')).toBeNull();
    expect(normalizeEmail('"."@example.test')).toBeNull();
    expect(normalizeEmail('"a b"@example.test')).toBeNull();
  });

  it("rejects a leading dot and a double dot", () => {
    expect(normalizeEmail("..@example.com")).toBeNull();
    expect(normalizeEmail(".a@example.com")).toBeNull();
    expect(normalizeEmail("a..b@example.com")).toBeNull();
  });

  it("rejects Firestore's reserved __…__ id shape", () => {
    expect(normalizeEmail("__x__@example.com")).toBeNull();
  });

  it("rejects an address longer than 254 characters", () => {
    const local = "a".repeat(242); // + "@example.com" = exactly 254
    expect(normalizeEmail(`${local}@example.com`)).toHaveLength(254);
    expect(normalizeEmail(`${local}a@example.com`)).toBeNull();
  });

  it("rejects non-ASCII, so one accent cannot become two documents", () => {
    // NFC (single code point) and NFD (e + combining acute) are different byte
    // strings. Rejecting both is what stops an invite and a sign-in disagreeing.
    expect(normalizeEmail("café@example.com")).toBeNull();
    expect(normalizeEmail("café@example.com")).toBeNull();
  });

  it("does not canonicalise + aliases or dots", () => {
    // Folding these would let an admin grant access to an address they never
    // typed, so the two stay distinct entries on purpose.
    expect(normalizeEmail("ada+notes@gmail.com")).toBe("ada+notes@gmail.com");
    expect(normalizeEmail("a.da@gmail.com")).toBe("a.da@gmail.com");
  });

  it("fails closed on empty, missing or malformed input", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("trailing@")).toBeNull();
    expect(normalizeEmail("no-tld@example")).toBeNull();
  });
});

describe("isAdmin", () => {
  const admins = ["ada.lovelace@example.com"];

  it("matches regardless of case or padding", () => {
    expect(isAdmin("ada.lovelace@example.com", admins)).toBe(true);
    expect(isAdmin("  Ada.Lovelace@Example.COM ", admins)).toBe(true);
  });

  it("rejects a different address", () => {
    expect(isAdmin("grace.hopper@example.com", admins)).toBe(false);
  });

  it("does not match on domain", () => {
    // The old allowlist had an ALLOWED_DOMAINS half. This one does not.
    expect(isAdmin("anyone@example.com", admins)).toBe(false);
  });

  it("fails closed on an empty admin list, rather than allowing everyone", () => {
    expect(isAdmin("ada.lovelace@example.com", [])).toBe(false);
  });

  it("fails closed on empty, missing or malformed input", () => {
    expect(isAdmin(null, admins)).toBe(false);
    expect(isAdmin(undefined, admins)).toBe(false);
    expect(isAdmin("", admins)).toBe(false);
    expect(isAdmin("not-an-email", admins)).toBe(false);
  });
});
