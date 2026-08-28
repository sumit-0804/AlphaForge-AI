"use client";

import { WarningIcon } from "@phosphor-icons/react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function PageTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <h1 className="font-heading text-xl font-medium">{children}</h1>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

/** A hairline and a quiet label; sections are separated this way rather than boxed in cards. */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("mt-7 border-t border-border pt-5 first:mt-0 first:border-0 first:pt-0", className)}>
      {title && (
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-[13px] font-medium text-ink-3">{title}</h2>
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-sm text-ink-3">{children}</p>;
}

/** Errors say what happened and what to do, never a raw stack or a bare status code. */
export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div className="flex items-start gap-2.5 py-4 text-sm text-ink-2">
      <WarningIcon size={18} className="mt-0.5 shrink-0 text-down" />
      <span>
        {message}
        {retry && (
          <>
            {" "}
            <button type="button" onClick={retry} className="text-primary underline underline-offset-4">
              Try again
            </button>
          </>
        )}
      </span>
    </div>
  );
}

export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/** Colour is reserved for direction, so this is the only place a sign picks one. */
export function Move({ value, children }: { value: number | null | undefined; children: React.ReactNode }) {
  const tone = value == null || value === 0 ? "text-ink-3" : value < 0 ? "text-down" : "text-up";
  return <span className={cn("tnum", tone)}>{children}</span>;
}
