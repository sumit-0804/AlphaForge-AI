"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMarketSessions,
  fetchRecommendationHistory,
  fetchMemoryHealth,
} from "@/lib/api";
import { dateTime } from "@/lib/format";
import { TickerSearch } from "@/components/ticker-search";
import { WorkflowStreamView, useWorkflowStream } from "@/components/analysis-stream";
import { MarketSessions } from "@/components/market-sessions";
import { LearningStatusChip } from "@/components/learning-status";
import { ActionBadge } from "@/components/status-badges";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader, EmptyState } from "@/components/ui-bits";

export default function AnalyzePage() {
  const qc = useQueryClient();
  const [ticker, setTicker] = useState("");
  const [includeNews, setIncludeNews] = useState(false);
  const [rounds, setRounds] = useState("3");
  // How many past recommendations to show — grows when "Load more" is clicked.
  const [historyLimit, setHistoryLimit] = useState(5);

  const { state: analysis, run, cancel } = useWorkflowStream();

  // Refresh the history + learning panels once a run finishes.
  useEffect(() => {
    if (analysis.recommendation) {
      qc.invalidateQueries({ queryKey: ["recommendation-history"] });
      qc.invalidateQueries({ queryKey: ["memory-health"] });
    }
  }, [analysis.recommendation, qc]);

  // Cheap, clock-only endpoint; a minute is fine for an open/closed chip.
  const sessions = useQuery({
    queryKey: ["market-sessions"],
    queryFn: fetchMarketSessions,
    refetchInterval: 60_000,
  });
  // Only pull a handful up front; "Load more" asks the API for a bigger slice.
  const history = useQuery({
    queryKey: ["recommendation-history", historyLimit],
    queryFn: () => fetchRecommendationHistory(undefined, historyLimit),
    // Keep showing the current rows while the bigger page loads, so the list
    // doesn't blank out between clicks.
    placeholderData: (prev) => prev,
  });
  // A full page back means there are probably more to fetch.
  const canLoadMore = (history.data?.length ?? 0) >= historyLimit;
  const memory = useQuery({ queryKey: ["memory-health"], queryFn: fetchMemoryHealth });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (t) run(t, { news: includeNews, rounds: Number(rounds) });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Analyze" subtitle="Run the full agent pipeline on any ticker — research, risk, and a live Bull/Bear committee." />

      <div className="flex flex-wrap items-center gap-2">
        <MarketSessions sessions={sessions.data} />
        <LearningStatusChip status={memory.data?.status} />
      </div>

      {/* Run the workflow. overflow-visible so the search dropdown isn't clipped
          by the card, and relative+z-20 so it sits above the panels below. */}
      <Card className="relative z-20 overflow-visible p-4">
        <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
          <TickerSearch
            value={ticker}
            onChange={setTicker}
            onSelect={setTicker}
            placeholder="Search name or ticker e.g. Apple"
            className="min-w-48 flex-1"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Rounds
            <Select value={rounds} onValueChange={(v) => setRounds(v ?? "3")}>
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
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={includeNews} onCheckedChange={setIncludeNews} />
            Include news
          </label>
          {analysis.running ? (
            <Button type="button" variant="outline" onClick={cancel}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!ticker.trim()}>
              Run analysis
            </Button>
          )}
        </form>
      </Card>

      <WorkflowStreamView state={analysis} />

      <div className="grid gap-6">
        {/* Recent recommendations */}
        <Card className="p-0">
          <div className="border-b p-4">
            <h2 className="text-sm font-medium">Recent recommendations</h2>
          </div>
          <div className="divide-y">
            {(history.data ?? []).map((h, i) => (
              <div key={h.id ?? i} className="p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{h.symbol}</span>
                  <ActionBadge value={h.action} />
                  <span className="text-[11px] text-muted-foreground">{h.confidence}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{dateTime(h.created_at)}</span>
                </div>
                {h.rationale && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{h.rationale}</p>}
              </div>
            ))}
            {history.data?.length === 0 && <EmptyState title="No recommendations yet." hint="Run an analysis above." />}
          </div>
          {canLoadMore && (
            <div className="border-t p-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                disabled={history.isFetching}
                onClick={() => setHistoryLimit((n) => n + 5)}
              >
                {history.isFetching ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
