"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const LINKS = [
  { href: "/reports", label: "Daily report", hint: "Risk, allocation and the day's scan" },
  { href: "/settings", label: "Settings", hint: "Password, learning memory, quota" },
];

export function AccountButton({ withLabel = false }: { withLabel?: boolean }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            aria-label="Your account"
            className="flex h-11 items-center gap-2.5 rounded-lg px-1 text-left text-sm text-ink-2 hover:bg-muted"
          />
        }
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-medium text-secondary-foreground">
          {initials}
        </span>
        {withLabel && <span className="truncate">{user?.email}</span>}
      </SheetTrigger>

      <SheetContent>
        <SheetHeader>
          <SheetTitle>Your account</SheetTitle>
          <SheetDescription>{user?.email}</SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="flex min-h-14 items-center gap-3 border-b border-border py-2"
            >
              <span className="flex-1">
                <span className="block text-sm">{link.label}</span>
                <span className="block text-[13px] text-ink-3">{link.hint}</span>
              </span>
              <CaretRightIcon size={18} className="text-ink-3" />
            </Link>
          ))}
        </SheetBody>

        <SheetFooter>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
