"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  fetchLatestReport,
  fetchQuota,
  generateDailyReport,
  type AllocationNarration,
  type DailyReport,
  type QuotaSnapshot,
  type ReportAllocation,
  type ReportRisk,
  type RiskNarration,
} from "@/lib/api";
import { currency, dateTime, number, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui-bits";

// Risk narration + allocation narration. Mirrors _CHAT_CALLS_PER_REPORT in
// app/services/reports.py — the backend rejects with 429 below this, so the
// button is disabled rather than letting the user spend a click on a refusal.
const CALLS_PER_REPORT = 2;

/** Requests left in today's chat budget, or null when no daily cap is configured. */
function remaining(q: QuotaSnapshot | undefined): number | null {
  if (!q || q.rpd == null) return null;
  return Math.max(0, q.rpd - q.requests_today);
}

export function QuotaChip({ quota }: { quota?: QuotaSnapshot }) {
  if (!quota || quota.rpd == null) return null;
  const left = remaining(quota) ?? 0;
  const tone =
    left < CALLS_PER_REPORT ? "bg-negative" : left < quota.rpd * 0.2 ? "bg-amber-500" : "bg-positive";
  return (
    <span
      className="inline-flex items-center gap-1.5 bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-border"
      title={
        `${quota.requests_today} of ${quota.rpd} model requests used today` +
        (quota.resets_at ? ` · resets ${dateTime(quota.resets_at)}` : "")
      }
    >
      <span className={cn("size-1.5 rounded-full", tone)} />
      AI budget {left}/{quota.rpd} left today
    </span>
  );
}

export function DailyReportPanel() {
  const qc = useQueryClient();

  const quota = useQuery({ queryKey: ["quota"], queryFn: fetchQuota });
  const latest = useQuery({ queryKey: ["report-latest"], queryFn: fetchLatestReport });

  const generate = useMutation({
    mutationFn: generateDailyReport,
    onSuccess: () => {
      toast.success("Report generated");
      qc.invalidateQueries({ queryKey: ["report-latest"] });
      qc.invalidateQueries({ queryKey: ["quota"] });
    },
    onError: (e) => {
      // 409 (already running) and 429 (out of budget) arrive here as the backend's
      // own detail string, which already explains itself.
      toast.error((e as Error).message);
      qc.invalidateQueries({ queryKey: ["quota"] });
    },
  });

  const left = remaining(quota.data?.chat);
  const outOfBudget = left !== null && left < CALLS_PER_REPORT;
  const report = latest.data ?? null;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-sm font-medium">Daily report</h2>
          <p className="text-[11px] text-muted-foreground">
            Whole-book risk and an allocation plan over today&apos;s scan. Spends{" "}
            {CALLS_PER_REPORT} model calls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuotaChip quota={quota.data?.chat} />
          <Button
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending || outOfBudget}
            title={outOfBudget ? "Not enough daily model budget left" : undefined}
          >
            {generate.isPending ? "Generating…" : report ? "Regenerate" : "Generate report"}
          </Button>
        </div>
      </div>

      {generate.isPending && (
        <p className="border-b px-4 py-3 text-[11px] text-muted-foreground">
          Running — this takes a couple of minutes. The model calls queue behind the
          per-minute rate limit, so leaving the page is fine; the report is saved either way.
        </p>
      )}

      {latest.isLoading && (
        <div className="space-y-3 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {!latest.isLoading && !report && (
        <EmptyState
          title="No report yet."
          hint="Generate one to get whole-book risk metrics, a narrated risk read, and a target allocation across the current scan."
        />
      )}

      {report && <ReportBody report={report} />}
    </Card>
  );
}

function ReportBody({ report }: { report: DailyReport }) {
  const base =
    (report.portfolio && "base_currency" in report.portfolio
      ? report.portfolio.base_currency
      : undefined) ?? "USD";

  return (
    <div className="divide-y">
      <p className="px-4 py-2 text-[11px] text-muted-foreground">
        Generated {dateTime(report.date)}
      </p>

      {report.portfolio?.error && <SectionError label="Portfolio" message={report.portfolio.error} />}
      <RiskSection risk={report.risk} base={base} />
      <AllocationSection allocation={report.allocation} base={base} />
    </div>
  );
}

function SectionError({ label, message }: { label: string; message: string }) {
  return (
    <p className="px-4 py-3 text-[11px] text-negative">
      {label} unavailable — {message}
    </p>
  );
}

function RiskSection({ risk, base }: { risk: ReportRisk | null; base: string }) {
  if (!risk) return null;
  if (risk.error) return <SectionError label="Risk" message={risk.error} />;

  const m = risk.portfolio;
  const sectors = Object.entries(risk.sector_exposure ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-xs font-medium">Portfolio risk</h3>

      {risk.message && <p className="text-[11px] text-muted-foreground">{risk.message}</p>}

      {m && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric label="Volatility" value={`${m.volatility}%`} />
          <Metric label="Beta" value={m.beta == null ? "—" : number(m.beta)} />
          <Metric label="Sharpe" value={m.sharpe_ratio == null ? "—" : number(m.sharpe_ratio)} />
          <Metric label="Ann. return" value={percent(m.annualized_return)} />
          <Metric label="Risk level" value={m.risk_level} />
        </div>
      )}

      {sectors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sectors.map(([sector, pct]) => (
            <span
              key={sector}
              className="bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-border"
            >
              {sector} {pct}%
            </span>
          ))}
        </div>
      )}

      <Narration analysis={risk.analysis} benchmark={risk.benchmark} />

      {(risk.positions?.length ?? 0) > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Volatility</TableHead>
                <TableHead className="text-right">Beta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {risk.positions?.map((p) => (
                <TableRow key={p.ticker}>
                  <TableCell className="font-medium">{p.ticker}</TableCell>
                  <TableCell className="text-muted-foreground">{p.sector}</TableCell>
                  <TableCell className="tabular text-right">{(p.weight * 100).toFixed(1)}%</TableCell>
                  <TableCell className="tabular text-right">{currency(p.current_value, base)}</TableCell>
                  <TableCell className="tabular text-right">{p.volatility}%</TableCell>
                  <TableCell className="tabular text-right">{p.beta == null ? "—" : number(p.beta)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function AllocationSection({
  allocation,
  base,
}: {
  allocation: ReportAllocation | null;
  base: string;
}) {
  if (!allocation) return null;
  if (allocation.error) return <SectionError label="Allocation" message={allocation.error} />;

  const rows = allocation.allocations ?? [];

  return (
    <div className="space-y-3 p-4">
      <h3 className="text-xs font-medium">Suggested allocation</h3>
      <p className="text-[11px] text-muted-foreground">
        A target book across the current scan, not an instruction — nothing here places a trade.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Capital" value={currency(allocation.capital, base)} />
        <Metric label="Invested" value={currency(allocation.invested, base)} />
        <Metric label="Cash left" value={currency(allocation.cash_remaining, base)} />
        <Metric label="Deployed" value={allocation.invested_pct == null ? "—" : `${allocation.invested_pct}%`} />
      </div>

      <Narration analysis={allocation.analysis} />

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Shares</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.ticker}>
                  <TableCell className="font-medium">
                    {a.ticker}
                    <span className="ml-2 text-[11px] text-muted-foreground">{a.name}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.sector}</TableCell>
                  <TableCell className="tabular text-right">{currency(a.price, base)}</TableCell>
                  <TableCell className="tabular text-right">{(a.target_weight * 100).toFixed(1)}%</TableCell>
                  <TableCell className="tabular text-right">{a.shares}</TableCell>
                  <TableCell className="tabular text-right">{currency(a.cost, base)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** The agent's plain-language read. Absent when the narration call failed or was skipped. */
function Narration({
  analysis,
  benchmark,
}: {
  analysis?: RiskNarration | AllocationNarration;
  benchmark?: string;
}) {
  if (!analysis) return null;
  if (analysis.error) {
    return <p className="text-[11px] text-muted-foreground">Narration unavailable — {analysis.error}</p>;
  }

  const risk = analysis as RiskNarration;
  const alloc = analysis as AllocationNarration;
  const bullets = [
    ...(risk.concentration_risks ?? []),
    ...(risk.suggestions ?? []),
    ...(alloc.notes ?? []),
  ];
  const aside = risk.volatility_comment || alloc.diversification;

  return (
    <div className="space-y-1.5 bg-muted/50 p-3 text-xs ring-1 ring-inset ring-border">
      <p>{analysis.summary}</p>
      {aside && <p className="text-[11px] text-muted-foreground">{aside}</p>}
      {bullets.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {benchmark && <p className="text-[11px] text-muted-foreground">Benchmark: {benchmark}</p>}
      {risk.valid === false && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          The model didn&apos;t return usable JSON — this is the fallback text.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular text-sm font-medium">{value}</p>
    </div>
  );
}
