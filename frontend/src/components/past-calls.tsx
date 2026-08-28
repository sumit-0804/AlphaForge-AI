"use client";

import Link from "next/link";

import { Empty, ErrorNote, RowsSkeleton } from "@/components/page";
import { usePastCalls } from "@/lib/queries";
import { ago, sentence, tickerName } from "@/lib/format";
import { cn } from "@/lib/utils";

function tone(action: string): string {
  const a = action.toUpperCase();
  if (a === "BUY") return "text-up";
  if (a === "SELL") return "text-down";
  return "text-ink-2";
}

/** Past calls on one ticker, or across the whole book when no ticker is given. */
export function PastCalls({ ticker, limit = 10 }: { ticker?: string; limit?: number }) {
  const calls = usePastCalls(ticker, limit);

  if (calls.isPending) return <RowsSkeleton rows={2} />;
  if (calls.isError) return <ErrorNote error={calls.error} retry={() => calls.refetch()} />;
  if (!calls.data?.length) {
    return <Empty>{ticker ? "No calls on this one yet." : "Nothing analysed yet."}</Empty>;
  }

  return (
    <div className="flex flex-col">
      {calls.data.map((call, i) => {
        const body = (
          <>
            <span className="flex items-baseline gap-2">
              <span className={cn("text-[15px] font-medium", tone(call.action))}>
                {sentence(call.action)}
              </span>
              {!ticker && <span className="text-[15px]">{tickerName(call.symbol)}</span>}
              <span className="ml-auto shrink-0 text-[13px] text-ink-3">{ago(call.created_at)}</span>
            </span>
            {call.rationale && (
              <span className="mt-1 block text-sm text-ink-2">{call.rationale}</span>
            )}
          </>
        );

        return ticker ? (
          <div key={call.id ?? i} className="border-b border-border py-3 last:border-0">
            {body}
          </div>
        ) : (
          <Link
            key={call.id ?? i}
            href={`/stock/${encodeURIComponent(call.symbol)}`}
            className="border-b border-border py-3 last:border-0"
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}
