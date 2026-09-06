import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claudebook",
  description: "A private notebook that reads your sources.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        {children}
      </body>
    </html>
  );
}
