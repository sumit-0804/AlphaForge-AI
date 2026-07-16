import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";

const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AlphaForge AI",
  description: "Autonomous Investment Research & Paper Trading",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased font-mono",
        geistSans.variable,
        geistMono.variable,
        jetbrainsMono.variable
      )}
    >
      <body className="min-h-full">
        <Providers>
          <div className="flex flex-col md:flex-row min-h-screen">
            <Nav />
            <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-x-hidden">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}