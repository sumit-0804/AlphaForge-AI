import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

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
          <div className="flex min-h-screen flex-col md:flex-row">
            <Nav />
            <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
              <div className="mx-auto w-full max-w-6xl">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
