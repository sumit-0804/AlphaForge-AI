"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  ClockCounterClockwiseIcon,
  CompassIcon,
  MagnifyingGlassIcon,
  WalletIcon,
} from "@phosphor-icons/react";

import { useAuth } from "@/components/auth-provider";
import { AccountButton } from "@/components/account-sheet";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Look up", icon: MagnifyingGlassIcon },
  { href: "/scanner", label: "Ideas", icon: CompassIcon },
  { href: "/portfolio", label: "Book", icon: WalletIcon },
  { href: "/transactions", label: "History", icon: ClockCounterClockwiseIcon },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" || pathname.startsWith("/stock") : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <span className="text-sm text-ink-3">{status === "loading" ? "Signing you in…" : ""}</span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh md:flex">
      <Rail pathname={pathname} />

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur-md md:hidden">
        <Link href="/" className="flex items-center gap-2" aria-label="AlphaForge home">
          <Mark />
          <span className="font-heading text-base font-medium">AlphaForge</span>
        </Link>
        <div className="ml-auto">
          <AccountButton />
        </div>
      </header>

      {/* The tab bar is fixed, so the last row of every page needs room to clear it. */}
      <main className="min-w-0 flex-1 px-5 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-16">
        <div className="mx-auto w-full max-w-[46rem]">{children}</div>
      </main>

      <TabBar pathname={pathname} />
    </div>
  );
}

function Mark() {
  return (
    <span
      aria-hidden
      className="flex size-7 items-center justify-center rounded-[8px] bg-card ring-1 ring-border"
    >
      <svg viewBox="0 0 32 32" className="size-5 text-primary drop-shadow-[0_0_5px_currentColor]" fill="none">
        <path
          d="M8.6 22.4 16 9.4l7.4 13"
          stroke="currentColor"
          strokeWidth="3.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 pb-safe backdrop-blur-md md:hidden">
      <ul className="flex">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[11px]",
                  active ? "text-primary" : "text-ink-3"
                )}
              >
                <Icon size={22} weight={active ? "fill" : "regular"} className={active ? "drop-shadow-[0_0_6px_currentColor]" : undefined} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Rail({ pathname }: { pathname: string }) {
  return (
    <nav className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border px-4 py-6 md:flex">
      <Link href="/" className="mb-8 flex items-center gap-2.5 px-2" aria-label="AlphaForge home">
        <Mark />
        <span className="font-heading text-base font-medium">AlphaForge</span>
      </Link>

      <ul className="flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                  active
                    ? "bg-accent-soft font-medium text-primary [&_svg]:drop-shadow-[0_0_6px_currentColor]"
                    : "text-ink-2 hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon size={20} weight={active ? "fill" : "regular"} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto px-1">
        <AccountButton withLabel />
      </div>
    </nav>
  );
}
