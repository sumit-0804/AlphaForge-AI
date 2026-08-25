"use client";

import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchStockInfo, type ScanCandidate, type ScanResult, type TriageEntry } from "@/lib/api";
import { currency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWatchlist } from "@/store/watchlist";
import { TickerSearch } from "@/components/ticker-search";
import { ConfidenceBadge } from "@/components/status-badges";
import { Skeleton } from "@/components/ui/skeleton";
import { StarIcon, BroadcastIcon, ArchiveIcon, WarningCircleIcon } from "@phosphor-icons/react";

function SourceBadge({ source }: { source?: string }) {
  if (source === "discovery")
    return (
      <span className="inline-flex items-center gap-1 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary ring-1 ring-inset ring-primary/25">
        <BroadcastIcon size={11} /> live
      </span>
    );
  if (source === "fallback")
    return (
      <span className="inline-flex items-center gap-1 bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-inset ring-border">
        <ArchiveIcon size={11} /> fallback
      </span>
    );
  return null;
}

function Row({
  symbol,
  selected,
  onSelect,
  right,
  children,
}: {
  symbol: string;
  selected: boolean;
  onSelect: (s: string) => void;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const watchlist = useWatchlist();
  return (
    <div
      className={cn(
        "flex cursor-pointer items-start gap-2 px-3 py-2.5 transition-colors hover:bg-accent/40",
        selected && "bg-primary/8 ring-1 ring-inset ring-primary/30"
      )}
      onClick={() => onSelect(symbol)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("truncate text-xs font-medium", selected && "text-primary")}>{symbol}</span>
          {right}
        </div>
        {children}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          watchlist.toggle(symbol);
        }}
        title="Toggle watchlist"
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
      >
        <StarIcon size={14} weight={watchlist.has(symbol) ? "fill" : "regular"} />
      </button>
    </div>
  );
}

function WatchlistSection({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (s: string) => void;
}) {
  const { tickers } = useWatchlist();
  const results = useQueries({
    queries: tickers.map((t) => ({ queryKey: ["stock", t], queryFn: () => fetchStockInfo(t) })),
  });

  if (tickers.length === 0)
    return <p className="px-3 py-3 text-[11px] text-muted-foreground">Star a stock to track it here.</p>;

  return (
    <div className="divide-y">
      {tickers.map((t, i) => {
        const d = results[i]?.data;
        return (
          <Row
            key={t}
            symbol={t}
            selected={selected === t}
            onSelect={onSelect}
            right={
              <span className="tabular ml-auto text-[11px] font-medium">
                {d ? currency(d.currentPrice, d.currency) : "…"}
              </span>
            }
          >
            <p className="truncate text-[10px] text-muted-foreground">{d?.shortName ?? "—"}</p>
          </Row>
        );
      })}
    </div>
  );
}

/** The workspace rail: search anything, pick a scanned mover, or pick a starred name. */
export function ScanSidebar({
  scan,
  candidates,
  triageBySymbol,
  loading,
  selected,
  onSelect,
  search,
  onSearchChange,
}: {
  scan?: ScanResult;
  candidates: ScanCandidate[];
  triageBySymbol: Map<string, TriageEntry>;
  loading: boolean;
  selected: string;
  onSelect: (s: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const [tab, setTab] = useState<"scan" | "watchlist">("scan");

  return (
    <div className="flex min-h-0 flex-col border-r bg-sidebar">
      {/* overflow-visible so the search dropdown escapes the rail. */}
      <div className="relative z-20 border-b p-3">
        <TickerSearch
          value={search}
          onChange={onSearchChange}
          onSelect={onSelect}
          placeholder="Search any ticker…"
        />
      </div>

      <div className="flex border-b text-xs">
        {(["scan", "watchlist"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 px-3 py-2 capitalize transition-colors",
              tab === k
                ? "bg-accent/50 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {k === "scan" ? `Movers${candidates.length ? ` (${candidates.length})` : ""}` : "Watchlist"}
          </button>
        ))}
      </div>

      {tab === "scan" && scan && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-[11px] text-muted-foreground">
          <strong className="text-foreground">{scan.matched}</strong> of {scan.scanned}
          <SourceBadge source={scan.universe_source} />
          {scan.triage?.valid === false && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <WarningCircleIcon size={12} /> rule-ranked
            </span>
          )}
        </div>
      )}

      {/* The rail scrolls on its own so the stock panel beside it stays put. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "scan" ? (
          loading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
              Nothing triggered a setup in this scan.
            </p>
          ) : (
            <div className="divide-y">
              {candidates.map((c) => {
                const t = triageBySymbol.get(c.symbol);
                return (
                  <Row
                    key={c.symbol}
                    symbol={c.symbol}
                    selected={selected === c.symbol}
                    onSelect={onSelect}
                    right={
                      <>
                        {t && <ConfidenceBadge value={t.conviction} />}
                        <span className="tabular ml-auto text-[11px] font-medium">
                          {currency(c.price, c.currency)}
                        </span>
                      </>
                    }
                  >
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.signals.slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="bg-positive/8 px-1 py-0.5 text-[9px] text-positive ring-1 ring-inset ring-positive/20"
                        >
                          {s.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  </Row>
                );
              })}
            </div>
          )
        ) : (
          <WatchlistSection selected={selected} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}

export { SourceBadge };
