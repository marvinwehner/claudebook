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
};

export default nextConfig;
