import type { Metadata, Viewport } from "next";

import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/config/site";

import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  // Required. Without it a static `opengraph-image` resolves against
  // localhost:3000 in production and only warns, so every preview loses its
  // image silently.
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Invite-only, so nothing is worth indexing. `robots.ts` must still allow
  // crawling — see the note there.
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  // Next fills twitter title/description/images from `openGraph` when they are
  // absent, so `card` is the only tag with no Open Graph equivalent. It is also
  // what makes Discord render the large embed rather than a thumbnail.
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2EEE6" },
    { media: "(prefers-color-scheme: dark)", color: "#151B2E" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning because next-themes writes the class on <html>
    // before React hydrates — that mismatch is the mechanism, not a bug.
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
