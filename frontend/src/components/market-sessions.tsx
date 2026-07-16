"use client";

import { type MarketSession } from "@/lib/api";
import { inTimeZone, localTimeZoneLabel } from "@/lib/format";

/** Open/closed badges for each market, with each exchange's own local clock.
 *
 * Shows both the market's local time and the viewer's timezone label, because
 * "is NSE open?" and "what time is it for me?" are different questions and a
 * single clock can't answer both.
 */
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
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                        s.is_open
                            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                            : "border-muted bg-muted/30 text-muted-foreground"
                    }`}
                >
                    <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                            s.is_open ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                    />
                    {s.label} {s.is_open ? "open" : "closed"}
                    <span className="opacity-70">
                        · {inTimeZone(s.local_time, s.timezone)}
                    </span>
                </span>
            ))}
            {showViewerZone && (
                <span className="text-xs text-muted-foreground">
                    times shown in {localTimeZoneLabel()}
                </span>
            )}
        </div>
    );
}
