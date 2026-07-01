"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPortfolio } from "@/lib/api";
import { currency, percent, pnlClass } from "@/lib/format";

export default function PortfolioPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {isError && <p className="text-red-600">{(error as Error).message}</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">Total Value</p>
              <p className="mt-1 text-2xl font-semibold">{currency(data.total_portfolio_value)}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">Cash</p>
              <p className="mt-1 text-2xl font-semibold">{currency(data.cash_balance)}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">Total P&L</p>
              <p className={`mt-1 text-2xl font-semibold ${pnlClass(data.total_pnl)}`}>
                {currency(data.total_pnl)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-3 font-medium">Ticker</th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Buy</th>
                  <th className="px-4 py-3 font-medium text-right">Current</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                  <th className="px-4 py-3 font-medium text-right">P&L</th>
                  <th className="px-4 py-3 font-medium text-right">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      No open positions.
                    </td>
                  </tr>
                ) : (
                  data.positions.map((p) => (
                    <tr key={p.ticker} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{p.ticker}</td>
                      <td className="px-4 py-3 text-right">{p.quantity}</td>
                      <td className="px-4 py-3 text-right">{currency(p.average_buy_price)}</td>
                      <td className="px-4 py-3 text-right">{currency(p.current_price)}</td>
                      <td className="px-4 py-3 text-right">{currency(p.current_value)}</td>
                      <td className={`px-4 py-3 text-right ${pnlClass(p.pnl)}`}>{currency(p.pnl)}</td>
                      <td className={`px-4 py-3 text-right ${pnlClass(p.pnl)}`}>{percent(p.pnl_percent)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}