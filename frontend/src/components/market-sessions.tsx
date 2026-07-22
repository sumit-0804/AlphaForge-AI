"use client";

import { type MarketSession } from "@/lib/api";
import { inTimeZone, localTimeZoneLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

// Open/closed pills per market, each with its own exchange clock. Shows the
// viewer's timezone too, since "is NSE open?" and "what time is it for me?" differ.
export function MarketSessions({
  sessions,
  showViewerZone = true,
}: {
  sessions: Record<string, MarketSession> | undefined;
  showViewerZone?: boolean;
}) {
  if (!sessions) return null;
  const list = Object.values(sessions);
  if (list.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map((s) => (
        <span
          key={s.market}
          title={`${s.label} · ${s.opens}–${s.closes} ${s.timezone}`}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 text-[11px] ring-1 ring-inset",
            s.is_open
              ? "bg-positive/10 text-positive ring-positive/25"
              : "bg-muted text-muted-foreground ring-border"
          )}
        >
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              s.is_open ? "animate-pulse bg-positive" : "bg-muted-foreground"
            )}
          />
          {s.label} {s.is_open ? "open" : "closed"}
          <span className="opacity-70">· {inTimeZone(s.local_time, s.timezone)}</span>
        </span>
      ))}
      {showViewerZone && (
        <span className="text-[11px] text-muted-foreground">
          times in {localTimeZoneLabel()}
        </span>
      )}
    </div>
  );
}
