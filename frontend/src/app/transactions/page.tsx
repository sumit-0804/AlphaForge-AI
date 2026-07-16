"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTransactions } from "@/lib/api";
import { currency, dateTime, localTimeZoneLabel } from "@/lib/format";

export default function TransactionsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => fetchTransactions(100),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-xs text-muted-foreground">
          Times shown in {localTimeZoneLabel()}
        </p>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {isError && <p className="text-red-600">{(error as Error).message}</p>}

      {data && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Ticker</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium text-right">Qty</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No transactions yet.
                  </td>
                </tr>
              ) : (
                data.map((tx, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-3 text-muted-foreground">
                      {dateTime(tx.timestamp)}
                    </td>
                    <td className="px-4 py-3 font-medium">{tx.ticker}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          tx.action === "buy"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {tx.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{tx.quantity}</td>
                    <td className="px-4 py-3 text-right">{currency(tx.price)}</td>
                    <td className="px-4 py-3 text-right">{currency(tx.price * tx.quantity)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}