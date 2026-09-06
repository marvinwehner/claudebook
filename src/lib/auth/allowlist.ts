import { serverEnv } from "@/lib/config/env";

export interface Allowlist {
  emails: string[];
  domains: string[];
}

/** Splits `a@b.com, c@d.com` into a normalised list. Blanks are dropped. */
export function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fails closed in every direction: an unparseable address, an address with no
 * domain, and — importantly — an allowlist that is empty on both sides all
 * return false. A misconfigured deploy locks everyone out rather than letting
 * everyone in.
 */
export function isAllowed(email: string | null | undefined, list: Allowlist): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  if (!normalised.includes("@")) return false;
  if (list.emails.length === 0 && list.domains.length === 0) return false;

  if (list.emails.includes(normalised)) return true;

  const domain = normalised.slice(normalised.lastIndexOf("@") + 1);
  return domain.length > 0 && list.domains.includes(domain);
}

export function allowlistFromEnv(): Allowlist {
  const env = serverEnv();
  return {
    emails: parseList(env.ALLOWED_EMAILS),
    domains: parseList(env.ALLOWED_DOMAINS),
  };
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  return isAllowed(email, allowlistFromEnv());
}
