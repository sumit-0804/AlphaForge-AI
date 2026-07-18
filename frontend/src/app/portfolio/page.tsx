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
              <p className="text-xs uppercase text-muted-foreground">
                Total Value ({data.base_currency})
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {currency(data.total_portfolio_value, data.base_currency)}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">Cash</p>
              <p className="mt-1 text-2xl font-semibold">
                {currency(data.cash_balance, data.base_currency)}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <p className="text-xs uppercase text-muted-foreground">Total P&L</p>
              <p className={`mt-1 text-2xl font-semibold ${pnlClass(data.total_pnl)}`}>
                {currency(data.total_pnl, data.base_currency)}
              </p>
            </div>
          </div>

          {data.unconverted.length > 0 && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              No exchange rate available for {data.unconverted.join(", ")} — excluded
              from the {data.base_currency} total above.
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="px-4 py-3 font-medium">Ticker</th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Buy</th>
                  <th className="px-4 py-3 font-medium text-right">Current</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                  <th className="px-4 py-3 font-medium text-right">
                    Value ({data.base_currency})
                  </th>
                  <th className="px-4 py-3 font-medium text-right">P&L</th>
                  <th className="px-4 py-3 font-medium text-right">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                      No open positions.
                    </td>
                  </tr>
                ) : (
                  data.positions.map((p) => (
                    <tr key={p.ticker} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">
                        {p.ticker}
                        <span className="ml-2 text-xs text-muted-foreground">{p.currency}</span>
                      </td>
                      <td className="px-4 py-3 text-right">{p.quantity}</td>
                      {/* Prices stay in the stock's own currency so they match
                          what the exchange and a broker statement show. */}
                      <td className="px-4 py-3 text-right">
                        {currency(p.average_buy_price, p.currency)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {currency(p.current_price, p.currency)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {currency(p.current_value, p.currency)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.current_value_base == null ? (
                          <span className="text-muted-foreground" title="No exchange rate available">
                            —
                          </span>
                        ) : (
                          currency(p.current_value_base, p.base_currency)
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right ${pnlClass(p.pnl)}`}>
                        {currency(p.pnl, p.currency)}
                      </td>
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