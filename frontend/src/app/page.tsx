"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchPortfolio, fetchHealth, fetchRecommendationHistory } from "@/lib/api";
import { currency, percent, pnlClass, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { MagicCard } from "@/components/ui/magic-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, PageHeader, EmptyState } from "@/components/ui-bits";
import { ActionBadge } from "@/components/status-badges";
import { CrosshairIcon, BriefcaseIcon, ArrowRightIcon } from "@phosphor-icons/react";

// Quick links to the two things you do most: find something to trade, or check the book.
function QuickActions() {
  const actions = [
    { href: "/scanner", label: "Scan the market", hint: "Movers → quote → chart → committee", icon: CrosshairIcon },
    { href: "/portfolio", label: "Review your book", hint: "Positions, risk and the daily report", icon: BriefcaseIcon },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {actions.map((a) => (
        <Link key={a.href} href={a.href}>
          <Card className="group gap-0 p-0">
            {/* Spotlight stops customised off Magic UI's violet/pink to our
                electric-violet → magenta-violet pair. */}
            <MagicCard
              gradientFrom="#b47aff"
              gradientTo="#cd57e0"
              gradientColor="#1a1424"
              gradientOpacity={0.55}
              gradientSize={220}
              className="p-4"
            >
              <div className="flex items-center gap-2">
                <a.icon size={18} className="text-primary" />
                <p className="text-sm font-medium">{a.label}</p>
                <ArrowRightIcon size={14} className="ml-auto text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{a.hint}</p>
            </MagicCard>
          </Card>
        </Link>
      ))}
    </div>
  );
}

// Moved off the retired /analyze page: this reads the whole book, not one stock.
function RecentRecommendations() {
  // Only pull a handful up front; "Load more" asks the API for a bigger slice.
  const [limit, setLimit] = useState(5);
  const history = useQuery({
    queryKey: ["recommendation-history", limit],
    queryFn: () => fetchRecommendationHistory(undefined, limit),
    // Keep the current rows while the bigger page loads so the list doesn't blank out.
    placeholderData: (prev) => prev,
  });
  const canLoadMore = (history.data?.length ?? 0) >= limit;

  return (
    <Card className="p-0">
      <div className="border-b p-4">
        <h2 className="text-sm font-medium">Recent recommendations</h2>
      </div>
      <div className="divide-y">
        {(history.data ?? []).map((h, i) => (
          <div key={h.id ?? i} className="p-4">
            <div className="flex items-center gap-2">
              <Link
                href={`/scanner?ticker=${h.symbol}`}
                className="text-xs font-medium hover:text-primary hover:underline"
              >
                {h.symbol}
              </Link>
              <ActionBadge value={h.action} />
              <span className="text-[11px] text-muted-foreground">{h.confidence}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{dateTime(h.created_at)}</span>
            </div>
            {h.rationale && (
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{h.rationale}</p>
            )}
          </div>
        ))}
        {history.data?.length === 0 && (
          <EmptyState
            title="No recommendations yet."
            hint={
              <>
                Pick a stock in <Link href="/scanner" className="text-primary hover:underline">Scanner</Link> and run a deep analysis.
              </>
            }
          />
        )}
      </div>
      {canLoadMore && (
        <div className="border-t p-3 text-center">
          <Button
            variant="ghost"
            size="sm"
            disabled={history.isFetching}
            onClick={() => setLimit((n) => n + 5)}
          >
            {history.isFetching ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: fetchPortfolio });
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const p = portfolio.data;

  return (
    <div className="space-y-6 p-4 sm:p-5 lg:p-6">
      <PageHeader title="Dashboard" subtitle="Your book at a glance.">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-block size-1.5 rounded-full",
              health.data?.status === "ok" ? "bg-positive" : "bg-muted-foreground"
            )}
          />
          API {health.data?.status ?? "…"} · DB {health.data?.mongodb ?? "…"}
        </span>
      </PageHeader>

      <QuickActions />

      {portfolio.isError && <p className="text-xs text-negative">{(portfolio.error as Error).message}</p>}

      {portfolio.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {p && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={`Total value (${p.base_currency})`}
              value={currency(p.total_portfolio_value, p.base_currency)}
              numeric={p.total_portfolio_value}
              format={(n) => currency(n, p.base_currency)}
            />
            <StatCard
              label="Cash balance"
              value={currency(p.cash_balance, p.base_currency)}
              numeric={p.cash_balance}
              format={(n) => currency(n, p.base_currency)}
            />
            <StatCard
              label="Total P&L"
              value={currency(p.total_pnl, p.base_currency)}
              numeric={p.total_pnl}
              format={(n) => currency(n, p.base_currency)}
              tone={p.total_pnl > 0 ? "positive" : p.total_pnl < 0 ? "negative" : "default"}
            />
            <StatCard label="Positions" value={String(p.positions.length)} />
          </div>

          <Card className="p-0">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="text-sm font-medium">Holdings</h2>
              <Link href="/portfolio" className="text-xs text-primary hover:underline">
                View all →
              </Link>
            </div>
            {p.positions.length === 0 ? (
              <EmptyState
                title="No positions yet."
                hint={
                  <>
                    Head to <Link href="/scanner" className="text-primary hover:underline">Scanner</Link> to buy your first.
                  </>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {p.positions.slice(0, 6).map((pos) => (
                      <TableRow key={pos.ticker}>
                        <TableCell className="font-medium">
                          <Link href={`/scanner?ticker=${pos.ticker}`} className="hover:text-primary hover:underline">
                            {pos.ticker}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular text-right">{pos.quantity}</TableCell>
                        <TableCell className="tabular text-right">{currency(pos.current_price, pos.currency)}</TableCell>
                        <TableCell className="tabular text-right">{currency(pos.current_value, pos.currency)}</TableCell>
                        <TableCell className={cn("tabular text-right", pnlClass(pos.pnl))}>
                          {currency(pos.pnl, pos.currency)} ({percent(pos.pnl_percent)})
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Outside the `p &&` guard: past calls are worth seeing on an empty book too. */}
      <RecentRecommendations />
    </div>
  );
}
