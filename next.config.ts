import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // firebase-admin uses dynamic requires and native-ish deps that must not be
  // bundled into the server build.
  serverExternalPackages: ["firebase-admin"],
  // Deliberately NOT set: `cacheComponents`. Firebase App Hosting does not
  // support Cache Components or the Next 16 Proxy (`proxy.ts`) — auth gating
  // lives in server components instead. See docs/PLAN.md.
  experimental: {
    // @gravity-ui/icons is a barrel over ~800 modules. Next rewrites named
    // imports from it into deep ones so only the icons actually used are
    // pulled in. It is not in Next's built-in default list, unlike lucide.
    optimizePackageImports: ["@gravity-ui/icons"],
  },
  // The session cookie is SameSite=Lax, which does not stop framing — so the
  // signed-in workspace has to refuse it explicitly.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
