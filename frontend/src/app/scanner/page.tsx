"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  fetchScan,
  fetchMemoryHealth,
  type ScanCandidate,
  type TriageEntry,
  type UniverseKey,
} from "@/lib/api";
import { useWorkflowStream, WorkflowStreamView } from "@/components/analysis-stream";
import { ScanSidebar } from "@/components/scan-sidebar";
import { StockDetail } from "@/components/stock-detail";
import { PriceChart } from "@/components/price-chart";
import { MarketSessions } from "@/components/market-sessions";
import { LearningStatusChip } from "@/components/learning-status";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui-bits";
import { ArrowClockwiseIcon, CrosshairIcon } from "@phosphor-icons/react";

const UNIVERSES: { key: UniverseKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "IN", label: "India" },
  { key: "NSE", label: "NSE" },
  { key: "BSE", label: "BSE" },
  { key: "US", label: "US" },
];

function Workspace() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();

  // The URL owns the selection, so deep links and the back button just work.
  const selected = (params.get("ticker") ?? "").toUpperCase();

  const [market, setMarket] = useState<UniverseKey>("ALL");
  const [search, setSearch] = useState("");
  const [rounds, setRounds] = useState("2");
  const [includeNews, setIncludeNews] = useState(false);
  // Which stock the analysis panel belongs to, so a stale one never shows under another.
  const [analysed, setAnalysed] = useState<string | null>(null);

  const { state: analysis, run, cancel } = useWorkflowStream();

  const scan = useQuery({ queryKey: ["scan", market], queryFn: () => fetchScan(10, true, market) });
  const memory = useQuery({ queryKey: ["memory-health"], queryFn: fetchMemoryHealth });

  useEffect(() => {
    if (analysis.recommendation) {
      qc.invalidateQueries({ queryKey: ["recommendation-history"] });
      qc.invalidateQueries({ queryKey: ["memory-health"] });
    }
  }, [analysis.recommendation, qc]);

  function select(symbol: string) {
    const s = symbol.toUpperCase();
    if (!s || s === selected) return;
    // Drop the previous stock's analysis rather than leaving it under this one.
    if (analysis.running) cancel();
    setAnalysed(null);
    setSearch("");
    router.replace(`/scanner?ticker=${s}`);
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

  const triage = selected ? triageBySymbol.get(selected) : undefined;
  const candidate: ScanCandidate | undefined = candidates.find((c) => c.symbol === selected);

  // h-full + min-h-0 throughout so each pane scrolls itself and fills the viewport.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
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
        <LearningStatusChip status={memory.data?.status} />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => scan.refetch()}
          disabled={scan.isFetching}
        >
          <ArrowClockwiseIcon size={14} className={scan.isFetching ? "animate-spin" : ""} />
          Rescan
        </Button>
      </div>

      {scan.isError && <p className="px-4 py-2 text-xs text-negative">{(scan.error as Error).message}</p>}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[20rem_1fr]">
        <ScanSidebar
          scan={scan.data}
          candidates={candidates}
          triageBySymbol={triageBySymbol}
          loading={scan.isLoading}
          selected={selected}
          onSelect={select}
          search={search}
          onSearchChange={setSearch}
        />

        <div className="min-w-0 min-h-0 space-y-4 overflow-y-auto p-4">
          {!selected ? (
            <div className="grid h-full place-items-center">
              <EmptyState
                icon={<CrosshairIcon size={26} />}
                title="Pick a stock to begin."
                hint="Choose a mover from the scan, open your watchlist, or search any ticker."
              />
            </div>
          ) : (
            <>
              {/* Keyed so switching stock remounts with a fresh order form. */}
              <StockDetail key={selected} ticker={selected} />

              {(triage || candidate) && (
                <Card className="gap-2 p-4">
                  {candidate && (
                    <div className="flex flex-wrap gap-1">
                      {candidate.signals.map((s) => (
                        <span
                          key={s}
                          className="bg-positive/8 px-1.5 py-0.5 text-[10px] text-positive ring-1 ring-inset ring-positive/20"
                        >
                          {s.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  )}
                  {triage && (
                    <>
                      <p className="text-xs/relaxed">{triage.thesis}</p>
                      {triage.invalidation && (
                        <p className="text-[11px] text-muted-foreground">
                          <span className="font-medium">Invalidated if:</span> {triage.invalidation}
                        </p>
                      )}
                    </>
                  )}
                </Card>
              )}

              <PriceChart ticker={selected} />

              {/* The expensive tier, directly under the stock it analyses. */}
              <Card className="gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Deep analysis</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Full agent pipeline and a Bull/Bear committee for {selected}.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      Rounds
                      <Select value={rounds} onValueChange={(v) => setRounds(v ?? "2")}>
                        <SelectTrigger size="sm" className="w-16">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Switch checked={includeNews} onCheckedChange={setIncludeNews} />
                      News
                    </label>
                    <Button
                      size="sm"
                      disabled={analysis.running}
                      onClick={() => {
                        setAnalysed(selected);
                        run(selected, { news: includeNews, rounds: Number(rounds) });
                      }}
                    >
                      {analysis.running
                        ? "Analysing…"
                        : analysed === selected
                          ? "Re-run analysis"
                          : "Run analysis"}
                    </Button>
                    {analysed === selected &&
                      (analysis.running ? (
                        <Button variant="outline" size="sm" onClick={cancel}>
                          Stop
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setAnalysed(null)}>
                          Hide
                        </Button>
                      ))}
                  </div>
                </div>
              </Card>

              {analysed === selected && <WorkflowStreamView state={analysis} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScannerPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="text-xs text-muted-foreground">Loading scanner…</p>}>
      <Workspace />
    </Suspense>
  );
}
