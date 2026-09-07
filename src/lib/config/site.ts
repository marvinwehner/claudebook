/**
 * Static site identity, used for `metadataBase` and the social share card.
 *
 * Not an env var: the origin is fixed by the App Hosting backend name and
 * region, and a `NEXT_PUBLIC_*` would have to be kept in sync across five files
 * to carry a value that cannot change.
 */

export const SITE_URL = "https://claudebook--claudebook-lm.europe-west4.hosted.app";

export const SITE_NAME = "Claudebook";

/** Verbatim from `src/app/login/page.tsx`, so the card and the page agree. */
export const SITE_DESCRIPTION = "A private notebook that reads your sources. Invite only.";


export const REPO_URL = "https://github.com/mavonic/claudebook";
