"use client";

import { Empty, ErrorNote, PageTitle, RowsSkeleton, Section } from "@/components/page";
import { useTransactions } from "@/lib/queries";
import { dayAndTime, money, num, tickerName } from "@/lib/format";
import type { Transaction } from "@/lib/api";

export default function TransactionsPage() {
  const transactions = useTransactions(100);

  return (
    <>
      <PageTitle>History</PageTitle>

      {transactions.isPending && <RowsSkeleton rows={5} />}
      {transactions.isError && (
        <ErrorNote error={transactions.error} retry={() => transactions.refetch()} />
      )}

      {transactions.data &&
        (transactions.data.length === 0 ? (
          <Empty>No trades yet. Every paper fill you place will show up here.</Empty>
        ) : (
          <Section>
            <div className="flex flex-col">
              {transactions.data.map((tx, i) => (
                <Row key={`${tx.ticker}-${tx.timestamp}-${i}`} tx={tx} />
              ))}
            </div>
          </Section>
        ))}
    </>
  );
}

function Row({ tx }: { tx: Transaction }) {
  const total = tx.quantity * tx.price;
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-border py-3 last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px]">
          {tx.action === "buy" ? "Bought" : "Sold"} {tickerName(tx.ticker)}
        </span>
        <span className="tnum block text-[13px] text-ink-3">
          {num(tx.quantity)} at {money(tx.price, tx.currency)} · {dayAndTime(tx.timestamp)}
        </span>
      </span>
      <span className="tnum text-right text-[15px]">{money(total, tx.currency)}</span>
    </div>
  );
}
