"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTrade } from "@/lib/queries";
import { money, tickerName } from "@/lib/format";
import { cn } from "@/lib/utils";

type Props = {
  ticker: string;
  price: number | null;
  currency?: string | null;
  /** How many shares are held, so a sell can be capped at what exists. */
  held?: number;
  action?: "buy" | "sell";
  /** Pre-filled share count, so a suggested trim opens at the size that was suggested. */
  quantity?: number;
  /** Rendered as the trigger itself, so the button keeps its native semantics. */
  children: React.ReactElement<Record<string, unknown>>;
};

export function TradeSheet({ ticker, price, currency, held, action = "buy", quantity: suggested, children }: Props) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">(action);
  const [quantity, setQuantity] = useState(String(suggested ?? 1));
  const [error, setError] = useState<string | null>(null);
  const trade = useTrade();

  const qty = Number(quantity);
  const valid = Number.isInteger(qty) && qty > 0;
  const estimate = valid && price != null ? qty * price : null;

  function reset(next: boolean) {
    setOpen(next);
    if (next) {
      setSide(action);
      setQuantity(String(suggested ?? 1));
      setError(null);
    }
  }

  function submit() {
    if (!valid) {
      setError("Enter a whole number of shares.");
      return;
    }
    if (side === "sell" && held != null && qty > held) {
      setError(`You only hold ${held} share${held === 1 ? "" : "s"}.`);
      return;
    }
    trade.mutate(
      { ticker, action: side, quantity: qty },
      {
        onSuccess: (tx) => {
          setOpen(false);
          toast.success(
            `${side === "buy" ? "Bought" : "Sold"} ${tx.quantity} ${tickerName(ticker)} at ${money(tx.price, tx.currency)}`
          );
        },
        onError: (err) => setError(err instanceof Error ? err.message : "The trade did not go through."),
      }
    );
  }

  return (
    <Sheet open={open} onOpenChange={reset}>
      <SheetTrigger render={children} />

      <SheetContent>
        <SheetHeader>
          <SheetTitle>{tickerName(ticker)}</SheetTitle>
          <SheetDescription>
            {price != null ? `Trading around ${money(price, currency)} a share.` : "No live price right now."}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSide(s);
                  setError(null);
                }}
                className={cn(
                  "h-10 flex-1 rounded-md text-sm font-medium capitalize transition-colors",
                  side === s ? "bg-card text-foreground" : "text-ink-3"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] text-ink-3">How many shares</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setError(null);
              }}
            />
          </label>

          {side === "sell" && held != null && (
            <p className="-mt-2 text-[13px] text-ink-3">You hold {held} right now.</p>
          )}

          {estimate != null && (
            <p className="text-sm text-ink-2">
              That is about <span className="tnum text-foreground">{money(estimate, currency)}</span>{" "}
              {side === "buy" ? "out of your cash." : "back into your cash."}
            </p>
          )}

          {error && <p className="text-sm text-down">{error}</p>}
        </SheetBody>

        <SheetFooter>
          <Button variant={side} size="lg" disabled={trade.isPending} onClick={submit}>
            {trade.isPending ? "Placing…" : side === "buy" ? "Buy shares" : "Sell shares"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
