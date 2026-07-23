"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchScan, type ScanCandidate, type TriageEntry, type UniverseKey } from "@/lib/api";
import { currency, number } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWatchlist } from "@/store/watchlist";
import { WorkflowStreamView, useWorkflowStream } from "@/components/analysis-stream";
import { AdvisorPanel } from "@/components/advisor-panel";
import { MarketSessions } from "@/components/market-sessions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfidenceBadge } from "@/components/status-badges";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import {
  StarIcon,
  ArrowClockwiseIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
  BroadcastIcon,
  ArchiveIcon,
} from "@phosphor-icons/react";

const UNIVERSES: { key: UniverseKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "IN", label: "India" },
  { key: "NSE", label: "NSE" },
  { key: "BSE", label: "BSE" },
  { key: "US", label: "US" },
];

// Where the scanned list came from — live movers vs the offline fallback.
function SourceBadge({ source }: { source?: string }) {
  if (source === "discovery")
    return (
      <span className="inline-flex items-center gap-1 bg-primary/10 px-2 py-0.5 text-[11px] text-primary ring-1 ring-inset ring-primary/25">
        <BroadcastIcon size={12} /> live movers
      </span>
    );
  if (source === "fallback")
    return (
      <span className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-border">
        <ArchiveIcon size={12} /> fallback list
      </span>
    );
  return null;
}

export default function ScannerPage() {
  const watchlist = useWatchlist();
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [market, setMarket] = useState<UniverseKey>("ALL");
  const { state: analysis, run } = useWorkflowStream();

  const scan = useQuery({ queryKey: ["scan", market], queryFn: () => fetchScan(10, true, market) });

  // Deep analysis is the expensive tier — runs only when the user picks a candidate.
  function analyse(symbol: string) {
    setAnalysing(symbol);
    run(symbol, { news: false, rounds: 2 });
  }

  const triageBySymbol = new Map<string, TriageEntry>(
    (scan.data?.triage?.ranked ?? []).map((r) => [r.symbol, r])
  );

  const candidates = [...(scan.data?.candidates ?? [])].sort((a, b) => {
    const ra = triageBySymbol.get(a.symbol)?.rank;
    const rb = triageBySymbol.get(b.symbol)?.rank;
    if (ra != null && rb != null) return ra - rb;
    return b.score - a.score;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Scanner" subtitle="Live movers the agent surfaced — you choose which earn a full analysis.">
        <Button variant="outline" size="sm" onClick={() => scan.refetch()} disabled={scan.isFetching}>
          <ArrowClockwiseIcon size={14} className={scan.isFetching ? "animate-spin" : ""} />
          Rescan
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={market} onValueChange={(v) => setMarket(v as UniverseKey)}>
          <TabsList>
            {UNIVERSES.map((u) => (
              <TabsTrigger key={u.key} value={u.key}>
                {u.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <MarketSessions sessions={scan.data?.sessions} />
      </div>

      {scan.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
      {scan.isError && <p className="text-xs text-negative">{(scan.error as Error).message}</p>}

      {scan.data && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b p-4">
            <MagnifyingGlassIcon size={15} className="text-muted-foreground" />
            <span className="text-xs">
              <strong>{scan.data.matched}</strong> of {scan.data.scanned} scanned
            </span>
            <SourceBadge source={scan.data.universe_source} />
            {scan.data.triage?.valid === false && (
              <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                <WarningCircleIcon size={13} />
                Ranked by rule score — agent triage unavailable
              </span>
            )}
          </div>

          {scan.data.triage?.summary && (
            <p className="border-b bg-muted/30 p-4 text-xs/relaxed text-muted-foreground">{scan.data.triage.summary}</p>
          )}

          {candidates.length === 0 ? (
            <EmptyState title="Nothing triggered a setup in this scan." hint="Try a different market or rescan." />
          ) : (
            <div className="divide-y">
              {candidates.map((c: ScanCandidate) => {
                const t = triageBySymbol.get(c.symbol);
                return (
                  <div key={c.symbol} className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{c.symbol}</span>
                      {t && <ConfidenceBadge value={t.conviction} />}
                      <span className="bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {c.market === "IN" ? "NSE/BSE" : "NASDAQ/NYSE"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">score {c.score}</span>
                      <button
                        onClick={() => watchlist.toggle(c.symbol)}
                        title="Toggle watchlist"
                        className="text-muted-foreground hover:text-primary"
                      >
                        <StarIcon size={17} weight={watchlist.has(c.symbol) ? "fill" : "regular"} />
                      </button>
                      <span className="tabular ml-auto text-base font-semibold">{currency(c.price, c.currency)}</span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.signals.map((s) => (
                        <span key={s} className="bg-positive/8 px-1.5 py-0.5 text-[10px] text-positive ring-1 ring-inset ring-positive/20">
                          {s.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>

                    <p className="tabular mt-2 text-[11px] text-muted-foreground">
                      RSI {c.rsi} · EMA20 {c.ema_20} · EMA50 {c.ema_50} · vol {number(c.volume)} ({c.volume_ratio}×)
                    </p>

                    {t && (
                      <>
                        <p className="mt-2 text-xs/relaxed">{t.thesis}</p>
                        {t.invalidation && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            <span className="font-medium">Invalidated if:</span> {t.invalidation}
                          </p>
                        )}
                      </>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => analyse(c.symbol)} disabled={analysis.running}>
                        {analysing === c.symbol && analysis.running ? "Analysing…" : "Deep analysis"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/market?ticker=${c.symbol}`}>Trade</Link>}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {analysing && (
        <div className="space-y-3">
          <h2 className={cn("text-sm font-medium")}>Deep analysis · {analysing}</h2>
          <WorkflowStreamView state={analysis} />
        </div>
      )}

      <AdvisorPanel />
    </div>
  );
}
