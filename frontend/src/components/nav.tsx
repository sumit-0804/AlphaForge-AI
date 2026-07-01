"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
    HouseIcon,
    ChartLineIcon,
    BriefcaseIcon,
    StarIcon,
    ReceiptIcon,
} from "@phosphor-icons/react";

const links = [
    {href: "/", label: "Home", icon: HouseIcon},
    {href: "/market", label :"Market", icon: ChartLineIcon},
    {href: "/portfolio", label: "Portfolio", icon: BriefcaseIcon},
    {href: "/watchlist", label: "Watchlist", icon: StarIcon},
    {href: "/transactions", label: "Transactions", icon : ReceiptIcon},
]

export function Nav() {
    const pathname = usePathname();
    return (
        <aside className="w-56 shrink-0 border-r bg-sidebar p-4 flex flex-col gap-1">
        <div className="px-2 pb-4">
            <p className="text-lg font-semibold tracking-tight">AlphaForge AI</p>
            <p className="text-xs text-muted-foreground">Paper Trading</p>
        </div>
        {links.map(({ href, label, icon: Icon }) => {
            const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
            <Link
                key={href}
                href={href}
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
        </aside>
    );
}