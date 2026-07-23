"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTransactions } from "@/lib/api";
import { currency, dateTime, localTimeZoneLabel } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionBadge } from "@/components/status-badges";
import { PageHeader, EmptyState } from "@/components/ui-bits";

export default function TransactionsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["transactions"],
    queryFn: () => fetchTransactions(100),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Transactions" subtitle={`Times in ${localTimeZoneLabel()}`} />

      {isError && <p className="text-xs text-negative">{(error as Error).message}</p>}

      <Card className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : data && data.length === 0 ? (
          <EmptyState title="No transactions yet." hint="Paper trades you make on the Market page show up here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((tx, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{dateTime(tx.timestamp)}</TableCell>
                    <TableCell className="font-medium">{tx.ticker}</TableCell>
                    <TableCell>
                      <ActionBadge value={tx.action} />
                    </TableCell>
                    <TableCell className="tabular text-right">{tx.quantity}</TableCell>
                    <TableCell className="tabular text-right">{currency(tx.price, tx.currency ?? "USD")}</TableCell>
                    <TableCell className="tabular text-right">
                      {currency(tx.price * tx.quantity, tx.currency ?? "USD")}
                      {tx.total_base != null && tx.base_currency !== tx.currency && (
                        <span className="block text-[11px] text-muted-foreground">
                          {currency(tx.total_base, tx.base_currency ?? "USD")}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
