"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketSessions } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { ListIcon, SignOutIcon } from "@phosphor-icons/react";
import { useAuth } from "@/components/auth-provider";

// The four destinations; Scanner absorbed Market and Analyze onto one selected stock.
const links: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/scanner", label: "Scanner" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/transactions", label: "Transactions" },
];

function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link
      href="/"
      className="grad-text flex h-full items-center px-3 font-semibold tracking-[0.16em]"
    >
      ALPHAFORGE
    </Link>
  );
}

/** Which markets are trading, as a single strip cell. */
function SessionCell() {
  const { data } = useQuery({
    queryKey: ["market-sessions"],
    queryFn: fetchMarketSessions,
    refetchInterval: 60_000,
  });
  const open = Object.values(data ?? {}).filter((m) => m.is_open);
  if (!data) return null;

  return (
    <span className="flex h-full items-center gap-1.5 border-l px-3">
      <span
        className={cn(
          "inline-block size-1.5",
          open.length ? "bg-positive" : "bg-muted-foreground"
        )}
      />
      <span className={open.length ? "text-positive" : "text-muted-foreground"}>
        {open.length ? `${open.map((m) => m.label).join(" · ")} OPEN` : "MARKETS CLOSED"}
      </span>
    </span>
  );
}

/** A ticking clock — mounted-only, so the server and client never disagree. */
function ClockCell() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  return (
    <span className="tabular hidden h-full items-center border-l px-3 text-muted-foreground sm:flex">
      {now}
    </span>
  );
}

function AccountCell() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <>
      <span
        className="hidden h-full max-w-40 items-center truncate border-l px-3 text-muted-foreground lg:flex"
        title={user.email}
      >
        {user.email}
      </span>
      <span className="flex h-full items-center border-l px-1.5">
        <Button variant="ghost" size="icon-xs" onClick={signOut} aria-label="Sign out" title="Sign out">
          <SignOutIcon size={13} />
        </Button>
      </span>
    </>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-8 shrink-0 items-stretch border-b bg-sidebar text-[11px] tracking-wide uppercase">
      {/* Narrow screens get the same routes behind a sheet. */}
      <span className="flex items-center px-1.5 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon-xs" aria-label="Open menu">
                <ListIcon size={14} />
              </Button>
            }
          />
          <SheetContent side="left" className="w-60 p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <nav className="flex flex-col pt-2 text-xs uppercase">
              {links.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "px-4 py-2.5",
                    isActive(href, pathname)
                      ? "bg-accent text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </span>

      <Brand />

      <nav className="hidden items-stretch md:flex">
        {links.map(({ href, label }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center border-l px-3 transition-colors",
                active
                  ? "bg-accent text-accent-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-[image:var(--grad-primary)] after:content-['']"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <span className="ml-auto flex items-stretch">
        <SessionCell />
        <ClockCell />
        <AccountCell />
        <span className="flex h-full items-center border-l px-1.5">
          <ThemeToggle />
        </span>
      </span>
    </header>
  );
}
