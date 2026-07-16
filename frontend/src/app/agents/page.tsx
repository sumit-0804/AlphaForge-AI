"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    fetchSchedulerJobs,
    fetchSchedulerStatus,
    runSchedulerJob,
    fetchRecommendationHistory,
} from "@/lib/api";
import { TickerSearch } from "@/components/ticker-search";
import { WorkflowStreamView, useWorkflowStream } from "@/components/analysis-stream";
import { MarketSessions } from "@/components/market-sessions";
import { dateTime, localTimeZoneLabel } from "@/lib/format";

// Timestamps render in the viewer's own timezone — see lib/format.
const fmtTime = dateTime;

function actionColor(a: string): string {
    const v = (a ?? "").toUpperCase();
    return v === "BUY" ? "text-emerald-600" : v === "SELL" ? "text-red-600" : "text-amber-600";
}

export default function AgentsPage() {
    const qc = useQueryClient();
    const [ticker, setTicker] = useState("");
    const [includeNews, setIncludeNews] = useState(false);
    const [rounds, setRounds] = useState(3);

    // Streaming analysis pipeline (live "what it's analysing now" + committee chat).
    const { state: analysis, run, cancel } = useWorkflowStream();

    // Refresh the history panel once a run produces a recommendation.
    useEffect(() => {
        if (analysis.recommendation) {
            qc.invalidateQueries({ queryKey: ["recommendation-history"] });
        }
    }, [analysis.recommendation, qc]);

    // Live-polling panels (the "live logs").
    const jobs = useQuery({
        queryKey: ["scheduler-jobs"],
        queryFn: fetchSchedulerJobs,
        refetchInterval: 5000,
    });
    const status = useQuery({
        queryKey: ["scheduler-status"],
        queryFn: fetchSchedulerStatus,
        refetchInterval: 5000,
    });
    const history = useQuery({
        queryKey: ["recommendation-history"],
        queryFn: () => fetchRecommendationHistory(undefined, 10),
    });

    const runJob = useMutation({
        mutationFn: (id: string) => runSchedulerJob(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["scheduler-status"] });
            qc.invalidateQueries({ queryKey: ["scheduler-jobs"] });
            qc.invalidateQueries({ queryKey: ["recommendation-history"] });
        },
    });

    function submit(e: React.FormEvent) {
        e.preventDefault();
        const t = ticker.trim().toUpperCase();
        if (t) run(t, { news: includeNews, rounds });
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold tracking-tight">Agent Monitor</h1>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                        className={`inline-block h-2 w-2 rounded-full ${
                            status.data?.running ? "bg-emerald-500" : "bg-muted-foreground"
                        }`}
                    />
                    Scheduler {status.data?.running ? "live" : "stopped"}
                    {status.data?.timezone ? ` · ${status.data.timezone}` : ""}
                </span>
            </div>

            <MarketSessions sessions={status.data?.sessions} />

            {/* Run the workflow */}
            <form onSubmit={submit} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
                <TickerSearch
                    value={ticker}
                    onChange={setTicker}
                    onSelect={setTicker}
                    placeholder="Search name or ticker e.g. Apple"
                    className="flex-1 min-w-48"
                />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Rounds
                    <select
                        value={rounds}
                        onChange={(e) => setRounds(Number(e.target.value))}
                        className="rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                        {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={includeNews}
                        onChange={(e) => setIncludeNews(e.target.checked)}
                    />
                    Include news
                </label>
                {analysis.running ? (
                    <button
                        type="button"
                        onClick={cancel}
                        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                    >
                        Stop
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={!ticker.trim()}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                        Run analysis
                    </button>
                )}
            </form>

            <WorkflowStreamView state={analysis} />

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Scheduler jobs + live last-runs */}
                <div className="rounded-lg border bg-card">
                    <div className="border-b px-4 py-3">
                        <h2 className="font-medium">Scheduled jobs</h2>
                        <p className="text-xs text-muted-foreground">
                            Next-run times in {localTimeZoneLabel()}
                        </p>
                    </div>
                    <div className="divide-y">
                        {(jobs.data ?? []).map((j) => {
                            const last = status.data?.last_runs?.[j.id];
                            return (
                                <div key={j.id} className="flex items-start justify-between gap-3 px-4 py-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium">{j.id}</p>
                                        <p className="text-xs text-muted-foreground">
                                            next: {fmtTime(j.next_run)}
                                        </p>
                                        {last && (
                                            <p className="mt-1 truncate text-xs text-muted-foreground">
                                                last: {Object.entries(last)
                                                    .map(([k, v]) => `${k}=${String(v)}`)
                                                    .join(" · ")}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => runJob.mutate(j.id)}
                                        disabled={runJob.isPending}
                                        className="shrink-0 rounded-md border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50"
                                    >
                                        Run now
                                    </button>
                                </div>
                            );
                        })}
                        {jobs.data?.length === 0 && (
                            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                                No jobs scheduled.
                            </p>
                        )}
                    </div>
                </div>

                {/* Recent recommendations */}
                <div className="rounded-lg border bg-card">
                    <div className="border-b px-4 py-3">
                        <h2 className="font-medium">Recent recommendations</h2>
                    </div>
                    <div className="divide-y">
                        {(history.data ?? []).map((h, i) => (
                            <div key={h.id ?? i} className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{h.symbol}</span>
                                    <span className={`text-sm font-medium ${actionColor(h.action)}`}>
                                        {h.action}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{h.confidence}</span>
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        {fmtTime(h.created_at)}
                                    </span>
                                </div>
                                {h.rationale && (
                                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                        {h.rationale}
                                    </p>
                                )}
                            </div>
                        ))}
                        {history.data?.length === 0 && (
                            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                                No recommendations yet — run an analysis above.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
