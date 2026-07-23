"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchPortfolio, fetchHealth } from "@/lib/api";
import { currency, percent, pnlClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, PageHeader, EmptyState } from "@/components/ui-bits";
import { CrosshairIcon, BrainIcon, ArrowRightIcon } from "@phosphor-icons/react";

// Quick links to the two things you do most: find candidates, or analyze one.
function QuickActions() {
  const actions = [
    { href: "/scanner", label: "Scan the market", hint: "Live movers → signals → triage", icon: CrosshairIcon },
    { href: "/analyze", label: "Analyze a ticker", hint: "Full agent pipeline + committee", icon: BrainIcon },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {actions.map((a) => (
        <Link key={a.href} href={a.href}>
          <Card className="group gap-1 p-4 transition-colors hover:bg-accent/40">
            <div className="flex items-center gap-2">
              <a.icon size={18} className="text-primary" />
              <p className="text-sm font-medium">{a.label}</p>
              <ArrowRightIcon size={14} className="ml-auto text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="text-[11px] text-muted-foreground">{a.hint}</p>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: fetchPortfolio });
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });
  const p = portfolio.data;

  return (
    <div className="space-y-6">
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
            <StatCard label={`Total value (${p.base_currency})`} value={currency(p.total_portfolio_value, p.base_currency)} />
            <StatCard label="Cash balance" value={currency(p.cash_balance, p.base_currency)} />
            <StatCard
              label="Total P&L"
              value={currency(p.total_pnl, p.base_currency)}
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
                    Head to <Link href="/market" className="text-primary hover:underline">Market</Link> to buy your first.
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
                          <Link href={`/market?ticker=${pos.ticker}`} className="hover:text-primary hover:underline">
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
    </div>
  );
}
