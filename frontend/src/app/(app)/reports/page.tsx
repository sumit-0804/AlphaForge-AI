"use client";

import { toast } from "sonner";

import { Empty, ErrorNote, PageTitle, RowsSkeleton, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useGenerateReport, useLatestReport } from "@/lib/queries";
import { money, num, percent, sentence } from "@/lib/format";
import type { DailyReport, ReportAllocation, ReportRisk } from "@/lib/api";

export default function ReportsPage() {
  const latest = useLatestReport();
  const generate = useGenerateReport();

  function run() {
    generate.mutate(undefined, {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "The report could not be built."),
    });
  }

  return (
    <>
      <PageTitle>Daily report</PageTitle>

      <Section>
        <Button variant="tinted" disabled={generate.isPending} onClick={run}>
          {generate.isPending ? "Building…" : "Build today's report"}
        </Button>
      </Section>

      {latest.isPending && (
        <Section>
          <RowsSkeleton rows={3} />
        </Section>
      )}
      {latest.isError && (
        <Section>
          <ErrorNote error={latest.error} retry={() => latest.refetch()} />
        </Section>
      )}
      {latest.data === null && !latest.isPending && (
        <Section>
          <Empty>No report yet. Build one and it will keep the most recent here.</Empty>
        </Section>
      )}

      {latest.data && <ReportBody report={latest.data} />}
    </>
  );
}

function ReportBody({ report }: { report: DailyReport }) {
  return (
    <>
      <Section title={`Report for ${report.date}`}>
        {report.portfolio?.error ? (
          <p className="text-sm text-ink-3">The portfolio section failed to build.</p>
        ) : (
          report.portfolio?.total_portfolio_value != null && (
            <p className="text-[15px] text-ink-2">
              The book was worth{" "}
              <span className="tnum text-foreground">
                {money(report.portfolio.total_portfolio_value, report.portfolio.base_currency)}
              </span>{" "}
              when this ran.
            </p>
          )
        )}
      </Section>

      {report.risk && <RiskSection risk={report.risk} />}
      {report.allocation && <AllocationSection allocation={report.allocation} />}

      {report.scan && !report.scan.error && report.scan.triage?.summary && (
        <Section title="What the scanner saw">
          <p className="text-[15px] text-ink-2">{report.scan.triage.summary}</p>
        </Section>
      )}
    </>
  );
}

function RiskSection({ risk }: { risk: ReportRisk }) {
  if (risk.error) {
    return (
      <Section title="Risk">
        <p className="text-sm text-ink-3">This section failed to build.</p>
      </Section>
    );
  }
  if (risk.message) {
    return (
      <Section title="Risk">
        <p className="text-sm text-ink-3">{risk.message}</p>
      </Section>
    );
  }

  const p = risk.portfolio;

  return (
    <Section title="Risk">
      {risk.analysis?.summary && <p className="text-[15px] text-ink-2">{risk.analysis.summary}</p>}
      {p && (
        <p className="tnum mt-2 text-sm text-ink-3">
          Volatility {percent(p.volatility)}
          {p.beta != null && ` · beta ${p.beta.toFixed(2)}`}
          {p.sharpe_ratio != null && ` · Sharpe ${p.sharpe_ratio.toFixed(2)}`} ·{" "}
          {sentence(p.risk_level)} overall
          {risk.benchmark ? `, against ${risk.benchmark}` : ""}.
        </p>
      )}
      {risk.analysis?.concentration_risks?.length ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {risk.analysis.concentration_risks.map((r, i) => (
            <li key={i} className="text-sm text-ink-2">
              {r}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function AllocationSection({ allocation }: { allocation: ReportAllocation }) {
  if (allocation.error) {
    return (
      <Section title="Where money would go">
        <p className="text-sm text-ink-3">This section failed to build.</p>
      </Section>
    );
  }

  return (
    <Section title="Where money would go">
      {allocation.analysis?.summary && (
        <p className="text-[15px] text-ink-2">{allocation.analysis.summary}</p>
      )}
      {allocation.invested_pct != null && (
        <p className="tnum mt-2 text-sm text-ink-3">
          {percent(allocation.invested_pct, 0)} of the capital put to work
          {allocation.cash_remaining != null && `, ${money(allocation.cash_remaining)} left in cash`}.
        </p>
      )}

      {allocation.allocations?.length ? (
        <div className="mt-3 flex flex-col">
          {allocation.allocations.map((a) => (
            <div
              key={a.ticker}
              className="flex min-h-12 items-center gap-3 border-b border-border py-2.5 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{a.ticker}</span>
                <span className="block truncate text-[13px] text-ink-3">{a.sector}</span>
              </span>
              <span className="tnum text-right text-sm">
                {num(a.shares)} shares
                <span className="block text-[13px] text-ink-3">
                  {percent(a.actual_weight * 100, 0)}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}
