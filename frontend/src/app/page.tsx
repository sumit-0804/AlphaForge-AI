"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchPortfolio, fetchHealth } from "@/lib/api";
import { currency, percent, pnlClass } from "@/lib/format";

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${className}`}>{value}</p>
    </div>
  );
}

export default function HomePage() {
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: fetchPortfolio });
  const health = useQuery({ queryKey: ["health"], queryFn: fetchHealth });

  const p = portfolio.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <span className="text-xs text-muted-foreground">
          API: {health.data?.status ?? "…"} · DB: {health.data?.mongodb ?? "…"}
        </span>
      </div>

      {portfolio.isLoading && <p className="text-muted-foreground">Loading portfolio…</p>}
      {portfolio.isError && (
        <p className="text-red-600">Failed to load portfolio: {(portfolio.error as Error).message}</p>
      )}

      {p && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={`Total Value (${p.base_currency})`}
              value={currency(p.total_portfolio_value, p.base_currency)}
            />
            <Stat label="Cash Balance" value={currency(p.cash_balance, p.base_currency)} />
            <Stat
              label="Total P&L"
              value={currency(p.total_pnl, p.base_currency)}
              className={pnlClass(p.total_pnl)}
            />
            <Stat label="Positions" value={String(p.positions.length)} />
          </div>

          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-medium">Holdings</h2>
              <Link href="/portfolio" className="text-sm text-primary hover:underline">
                View all →
              </Link>
            </div>
            {p.positions.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No positions yet. Head to <Link href="/market" className="text-primary hover:underline">Market</Link> to buy.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">Ticker</th>
                    <th className="px-4 py-2 font-medium text-right">Qty</th>
                    <th className="px-4 py-2 font-medium text-right">Price</th>
                    <th className="px-4 py-2 font-medium text-right">Value</th>
                    <th className="px-4 py-2 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {p.positions.slice(0, 5).map((pos) => (
                    <tr key={pos.ticker} className="border-b last:border-0">
                      <td className="px-4 py-2 font-medium">{pos.ticker}</td>
                      <td className="px-4 py-2 text-right">{pos.quantity}</td>
                      <td className="px-4 py-2 text-right">
                        {currency(pos.current_price, pos.currency)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {currency(pos.current_value, pos.currency)}
                      </td>
                      <td className={`px-4 py-2 text-right ${pnlClass(pos.pnl)}`}>
                        {currency(pos.pnl, pos.currency)} ({percent(pos.pnl_percent)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}