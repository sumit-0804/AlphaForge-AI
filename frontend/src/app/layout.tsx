import type { Metadata, Viewport } from "next";

import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlphaForge",
  description: "Autonomous investment research and paper trading.",
  appleWebApp: { capable: true, title: "AlphaForge", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // Content reaches the display edges, and the layout pads itself back off the home indicator.
  viewportFit: "cover",
  themeColor: "#0b0a09",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
