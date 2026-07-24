import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

// Monospace is the identity; a clean sans is available for the rare long paragraph.
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "AlphaForge AI",
  description: "Autonomous investment research & paper trading",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html> before paint.
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full antialiased", mono.variable, sans.variable)}
    >
      <body className="min-h-full font-mono">
        <Providers>
          {/* AppShell owns the nav/main frame because /login renders without it. */}
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
