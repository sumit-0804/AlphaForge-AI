"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    HouseIcon,
    ChartLineIcon,
    BriefcaseIcon,
    StarIcon,
    ReceiptIcon,
    RobotIcon,
    ScalesIcon,
    CrosshairIcon,
    ListIcon,
    XIcon,
} from "@phosphor-icons/react";

const links = [
    { href: "/", label: "Home", icon: HouseIcon },
    { href: "/scanner", label: "Scanner", icon: CrosshairIcon },
    { href: "/market", label: "Market", icon: ChartLineIcon },
    { href: "/agents", label: "Agents", icon: RobotIcon },
    { href: "/committee", label: "Committee", icon: ScalesIcon },
    { href: "/portfolio", label: "Portfolio", icon: BriefcaseIcon },
    { href: "/watchlist", label: "Watchlist", icon: StarIcon },
    { href: "/transactions", label: "Transactions", icon: ReceiptIcon },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
    return (
        <>
            {links.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                    <Link
                        key={href}
                        href={href}
                        onClick={onNavigate}
                        className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                            active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                    >
                        <Icon size={18} weight={active ? "fill" : "regular"} />
                        {label}
                    </Link>
                );
            })}
        </>
    );
}

export function Nav() {
    const pathname = usePathname();
    const [open, setOpen] = useState(false);

    return (
        <>
            {/* Desktop sidebar */}
            <aside className="hidden md:flex w-56 shrink-0 flex-col gap-1 border-r bg-sidebar p-4">
                <div className="px-2 pb-4">
                    <p className="text-lg font-semibold tracking-tight">AlphaForge AI</p>
                    <p className="text-xs text-muted-foreground">Paper Trading</p>
                </div>
                <NavLinks pathname={pathname} />
            </aside>

            {/* Mobile top bar */}
            <div className="border-b bg-sidebar md:hidden">
                <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-base font-semibold tracking-tight">AlphaForge AI</p>
                    <button
                        onClick={() => setOpen((o) => !o)}
                        aria-label="Toggle menu"
                        aria-expanded={open}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
                    >
                        {open ? <XIcon size={20} /> : <ListIcon size={20} />}
                    </button>
                </div>
                {open && (
                    <nav className="flex flex-col gap-1 px-3 pb-3">
                        <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
                    </nav>
                )}
            </div>
        </>
    );
}
