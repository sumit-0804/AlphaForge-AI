"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";

// A labelled number tile for the dashboards. `tone` colours the value.
export function StatCard({
  label,
  value,
  numeric,
  format,
  sub,
  tone,
}: {
  label: string;
  value: string;
  /** Pass the raw number to count the tile up on mount; `value` stays the fallback. */
  numeric?: number | null;
  format?: (n: number) => string;
  sub?: string;
  tone?: "default" | "positive" | "negative";
}) {
  // Key metrics are one of the few places a gradient is allowed to carry text.
  const valueTone =
    tone === "positive"
      ? "grad-text-positive"
      : tone === "negative"
        ? "grad-text-negative"
        : "grad-text";
  return (
    <Card className="gap-1.5 p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("tabular text-2xl font-semibold leading-none", valueTone)}>
        {numeric != null ? (
          <NumberTicker
            value={numeric}
            decimalPlaces={2}
            format={format}
            className="leading-none"
          />
        ) : (
          value
        )}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

// A friendly placeholder for empty lists / no-data states.
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// A small section heading used on the data-dense pages.
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
