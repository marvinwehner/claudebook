import type { MetadataRoute } from "next";

/**
 * Deliberately no `Disallow`. Twitterbot and facebookexternalhit honour
 * robots.txt, so blocking them would stop the link previews from resolving at
 * all; the `noindex` in `layout.tsx` is what keeps the site out of search.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
