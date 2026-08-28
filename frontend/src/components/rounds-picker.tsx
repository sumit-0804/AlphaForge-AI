"use client";

import { cn } from "@/lib/utils";

// The backend clamps to this range, so offering more would silently do nothing.
const ROUNDS = [1, 2, 3, 4, 5];

export function RoundsPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (rounds: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] text-ink-3">Debate rounds</span>
      <div
        role="radiogroup"
        aria-label="Debate rounds"
        className="ml-auto flex gap-1 rounded-lg bg-muted p-1"
      >
        {ROUNDS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={cn(
              "tnum h-8 w-9 rounded-md text-[13px] font-medium transition-colors disabled:opacity-45",
              value === n ? "bg-card text-foreground" : "text-ink-3"
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
