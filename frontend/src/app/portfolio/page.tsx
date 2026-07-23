"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { fetchPortfolio } from "@/lib/api";
import { currency, percent, pnlClass } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard, PageHeader, EmptyState } from "@/components/ui-bits";
import { TradeDialog } from "@/components/trade-dialog";

export default function PortfolioPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Portfolio" subtitle="Your paper-trading book, converted to one base currency." />

      {isError && <p className="text-xs text-negative">{(error as Error).message}</p>}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={`Total value (${data.base_currency})`} value={currency(data.total_portfolio_value, data.base_currency)} />
            <StatCard label="Cash" value={currency(data.cash_balance, data.base_currency)} />
            <StatCard
              label="Total P&L"
              value={currency(data.total_pnl, data.base_currency)}
              tone={data.total_pnl > 0 ? "positive" : data.total_pnl < 0 ? "negative" : "default"}
            />
          </div>

          {data.unconverted.length > 0 && (
            <p className="bg-amber-500/10 px-4 py-3 text-xs text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              No exchange rate available for {data.unconverted.join(", ")} — excluded from the{" "}
              {data.base_currency} total above.
            </p>
          )}

          <Card className="p-0">
            {data.positions.length === 0 ? (
              <EmptyState
                title="No open positions."
                hint={
                  <>
                    Head to <Link href="/market" className="text-primary hover:underline">Market</Link> to buy.
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
                      <TableHead className="text-right">Avg buy</TableHead>
                      <TableHead className="text-right">Current</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Value ({data.base_currency})</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead className="text-right">P&L %</TableHead>
                      <TableHead className="text-right">Trade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.positions.map((p) => (
                      <TableRow key={p.ticker}>
                        <TableCell className="font-medium">
                          <Link href={`/market?ticker=${p.ticker}`} className="hover:text-primary hover:underline">
                            {p.ticker}
                          </Link>
                          <span className="ml-2 text-[11px] text-muted-foreground">{p.currency}</span>
                        </TableCell>
                        <TableCell className="tabular text-right">{p.quantity}</TableCell>
                        <TableCell className="tabular text-right">{currency(p.average_buy_price, p.currency)}</TableCell>
                        <TableCell className="tabular text-right">{currency(p.current_price, p.currency)}</TableCell>
                        <TableCell className="tabular text-right">{currency(p.current_value, p.currency)}</TableCell>
                        <TableCell className="tabular text-right">
                          {p.current_value_base == null ? (
                            <span className="text-muted-foreground" title="No exchange rate available">—</span>
                          ) : (
                            currency(p.current_value_base, p.base_currency)
                          )}
                        </TableCell>
                        <TableCell className={cn("tabular text-right", pnlClass(p.pnl))}>{currency(p.pnl, p.currency)}</TableCell>
                        <TableCell className={cn("tabular text-right", pnlClass(p.pnl))}>{percent(p.pnl_percent)}</TableCell>
                        <TableCell className="text-right">
                          <TradeDialog
                            ticker={p.ticker}
                            currency={p.currency}
                            currentPrice={p.current_price}
                            maxSell={p.quantity}
                            trigger={
                              <Button variant="outline" size="xs">
                                Trade
                              </Button>
                            }
                          />
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
