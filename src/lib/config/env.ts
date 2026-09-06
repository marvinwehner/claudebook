import { z } from "zod";

/**
 * Environment access.
 *
 * Validation is LAZY on purpose. `ANTHROPIC_API_KEY` and `ALLOWED_EMAILS` are
 * RUNTIME-only on App Hosting (see apphosting.yaml), so they are absent while
 * `next build` runs. Validating at module scope would fail every build.
 */

const serverSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_AGENT_ID: z.string().min(1),
  ANTHROPIC_ENVIRONMENT_ID: z.string().min(1),
  ALLOWED_EMAILS: z.string().default(""),
  ALLOWED_DOMAINS: z.string().default(""),
});

const publicSchema = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

let serverCache: ServerEnv | undefined;
let publicCache: PublicEnv | undefined;

function fail(scope: string, error: z.ZodError): never {
  const missing = error.issues.map((i) => i.path.join(".")).join(", ");
  throw new Error(
    `Invalid ${scope} environment: ${missing}. ` +
      `Set these in .env.local for local dev, or in apphosting.yaml for deploys.`,
  );
}

export function serverEnv(): ServerEnv {
  if (!serverCache) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) fail("server", parsed.error);
    serverCache = parsed.data;
  }
  return serverCache;
}

/**
 * `process.env.NEXT_PUBLIC_*` must be written out literally — Next inlines these
 * by static substitution, so a computed lookup yields undefined in the browser.
 */
export function publicEnv(): PublicEnv {
  if (!publicCache) {
    const parsed = publicSchema.safeParse({
      NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
    if (!parsed.success) fail("public", parsed.error);
    publicCache = parsed.data;
  }
  return publicCache;
}
