"use client";

import Link from "next/link";
import { CaretRightIcon } from "@phosphor-icons/react";

import { Advisor } from "@/components/advisor";
import { Empty, ErrorNote, Move, PageTitle, RowsSkeleton, Section } from "@/components/page";
import { PositionList } from "@/components/positions";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolio } from "@/lib/queries";
import { money, num, signedMoney } from "@/lib/format";

export default function PortfolioPage() {
  const portfolio = usePortfolio();

  return (
    <>
      <PageTitle>Your book</PageTitle>

      {portfolio.isPending && (
        <>
          <Skeleton className="h-10 w-52" />
          <Skeleton className="mt-3 h-5 w-full max-w-sm" />
          <RowsSkeleton />
        </>
      )}

      {portfolio.isError && <ErrorNote error={portfolio.error} retry={() => portfolio.refetch()} />}

      {portfolio.data && (
        <>
          <Section>
            <p className="display">
              {money(portfolio.data.total_portfolio_value, portfolio.data.base_currency)}
            </p>
            {portfolio.data.positions.length === 0 ? (
              <p className="mt-2 text-[15px] text-ink-2">
                Nothing invested yet — all of it is still in cash, ready to put to work.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[15px] text-ink-2">
                  <Move value={portfolio.data.total_pnl}>
                    {signedMoney(portfolio.data.total_pnl, portfolio.data.base_currency)}
                  </Move>{" "}
                  since you started, across {num(portfolio.data.positions.length)}{" "}
                  {portfolio.data.positions.length === 1 ? "position" : "positions"}.
                </p>
                <p className="mt-1 text-sm text-ink-3">
                  {money(portfolio.data.cash_balance, portfolio.data.base_currency)} still in cash.
                </p>
              </>
            )}

            {portfolio.data.unconverted.length > 0 && (
              <p className="mt-3 text-sm text-ink-2">
                {portfolio.data.unconverted.join(", ")}{" "}
                {portfolio.data.unconverted.length === 1 ? "is" : "are"} left out of that total — no
                exchange rate was available.
              </p>
            )}
          </Section>

          <Section title="What the advisor thinks">
            <Advisor />
          </Section>

          <Section title="Positions">
            {portfolio.data.positions.length === 0 ? (
              <Empty>
                Nothing held yet. Look up a ticker and the analysis screen will let you place a paper
                trade.
              </Empty>
            ) : (
              <PositionList positions={portfolio.data.positions} />
            )}
          </Section>

          <Section>
            <Link
              href="/reports"
              className="flex min-h-14 items-center gap-3 text-sm text-ink-2"
            >
              <span className="flex-1">
                <span className="block text-foreground">Today&apos;s report</span>
                <span className="block text-[13px] text-ink-3">
                  Risk, allocation and the day&apos;s scan in one place
                </span>
              </span>
              <CaretRightIcon size={18} className="text-ink-3" />
            </Link>
          </Section>
        </>
      )}
    </>
  );
}
