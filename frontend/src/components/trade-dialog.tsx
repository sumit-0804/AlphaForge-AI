"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { executeTrade } from "@/lib/api";
import { currency as fmtCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// A small confirm-first buy/sell box. Reused wherever we want inline trading —
// it shows the quantity and estimated cost before anything executes.
export function TradeDialog({
  ticker,
  currency,
  currentPrice,
  maxSell,
  trigger,
}: {
  ticker: string;
  currency: string;
  currentPrice: number | null;
  /** Shares currently held — caps the sell quantity. */
  maxSell?: number;
  trigger: React.ReactElement;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);

  const trade = useMutation({
    mutationFn: (action: "buy" | "sell") => executeTrade({ ticker, action, quantity: qty }),
    onSuccess: (tx) => {
      toast.success(`${tx.action.toUpperCase()} ${tx.quantity} ${tx.ticker} @ ${fmtCurrency(tx.price, tx.currency ?? currency)}`);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["advisor-suggestions"] });
      setOpen(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const estCost = fmtCurrency((currentPrice ?? 0) * qty, currency);
  const sellTooMuch = maxSell != null && qty > maxSell;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Trade {ticker}</DialogTitle>
          <DialogDescription>
            {currentPrice != null ? `${fmtCurrency(currentPrice, currency)} per share` : "Price unavailable"}
            {maxSell != null ? ` · ${maxSell} held` : ""}
          </DialogDescription>
        </DialogHeader>

        <label className="block text-xs">
          <span className="text-muted-foreground">Quantity</span>
          <Input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            className="mt-1"
          />
        </label>
        <p className="tabular text-xs text-muted-foreground">Est. cost: {estCost}</p>
        {sellTooMuch && (
          <p className="text-[11px] text-negative">You only hold {maxSell} share{maxSell === 1 ? "" : "s"} to sell.</p>
        )}

        <DialogFooter className="grid grid-cols-2 gap-2">
          <Button
            disabled={trade.isPending}
            onClick={() => trade.mutate("buy")}
            className={cn("bg-positive text-white hover:bg-positive/90")}
          >
            Buy {qty}
          </Button>
          <Button variant="destructive" disabled={trade.isPending || sellTooMuch} onClick={() => trade.mutate("sell")}>
            Sell {qty}
          </Button>
        </DialogFooter>
        <DialogClose
          render={
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
