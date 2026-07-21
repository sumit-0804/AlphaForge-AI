"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  GaugeIcon,
  CrosshairIcon,
  ChartLineIcon,
  BrainIcon,
  BriefcaseIcon,
  ReceiptIcon,
  ListIcon,
  type Icon,
} from "@phosphor-icons/react";

// The six top-level destinations. Analyze absorbed the old Committee page;
// Watchlist now lives inside Market.
const links: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "Dashboard", icon: GaugeIcon },
  { href: "/scanner", label: "Scanner", icon: CrosshairIcon },
  { href: "/market", label: "Market", icon: ChartLineIcon },
  { href: "/analyze", label: "Analyze", icon: BrainIcon },
  { href: "/portfolio", label: "Portfolio", icon: BriefcaseIcon },
  { href: "/transactions", label: "Transactions", icon: ReceiptIcon },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="grid size-7 place-items-center bg-primary text-primary-foreground">
        <span className="text-sm font-bold">α</span>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-sm font-semibold tracking-tight">AlphaForge</span>
        <span className="text-[10px] text-muted-foreground">paper trading</span>
      </span>
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 px-3 py-2 text-sm transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {/* A thin accent bar marks the active route. */}
            <span
              className={cn(
                "h-4 w-0.5 shrink-0 transition-colors",
                active ? "bg-primary" : "bg-transparent"
              )}
            />
            <Icon size={17} weight={active ? "fill" : "regular"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center justify-between border-b px-2">
          <Brand />
          <ThemeToggle />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t px-4 py-3 text-[10px] text-muted-foreground">
          Educational analysis — not financial advice.
        </div>
      </aside>

      {/* Mobile top bar + slide-out sheet */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-sidebar px-3 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Open menu">
                <ListIcon size={18} />
              </Button>
            }
          />
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <div className="flex h-14 items-center border-b px-4">
              <Brand />
            </div>
            <div className="p-3">
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <Brand />
        <ThemeToggle />
      </div>
    </>
  );
}
