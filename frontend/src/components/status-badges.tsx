import { cn } from "@/lib/utils";

// Small coloured pills for the domain's enums. Kept in one place so BUY is always
// the same green, HIGH risk always the same red, everywhere in the app.

const TONE = {
  positive: "bg-positive/12 text-positive ring-positive/25",
  negative: "bg-negative/12 text-negative ring-negative/25",
  warn: "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400",
  muted: "bg-muted text-muted-foreground ring-border",
  brand: "bg-primary/12 text-primary ring-primary/25",
} as const;

type Tone = keyof typeof TONE;

function Pill({
  tone,
  children,
  className,
  title,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ring-1 ring-inset",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function ActionBadge({ value, className }: { value: string; className?: string }) {
  const v = (value ?? "").toUpperCase();
  const tone: Tone = v === "BUY" || v === "ADD" ? "positive" : v === "SELL" ? "negative" : v === "TRIM" ? "warn" : "muted";
  return (
    <Pill tone={tone} className={className}>
      {v || "HOLD"}
    </Pill>
  );
}

export function ConfidenceBadge({ value, className }: { value: string; className?: string }) {
  const v = (value ?? "").toUpperCase();
  const tone: Tone = v === "HIGH" ? "positive" : v === "MEDIUM" ? "warn" : "muted";
  return (
    <Pill tone={tone} className={className}>
      {v || "LOW"}
    </Pill>
  );
}

export function SentimentBadge({ value, className }: { value: string; className?: string }) {
  const v = (value ?? "").toUpperCase();
  const tone: Tone = v === "BULLISH" ? "positive" : v === "BEARISH" ? "negative" : "muted";
  return (
    <Pill tone={tone} className={className}>
      {v || "NEUTRAL"}
    </Pill>
  );
}

export function RiskBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  const v = (value ?? "").toUpperCase();
  const tone: Tone = v === "HIGH" ? "negative" : v === "MODERATE" ? "warn" : v === "LOW" ? "positive" : "muted";
  return (
    <Pill tone={tone} className={className}>
      {v || "UNKNOWN"}
    </Pill>
  );
}

export function UrgencyBadge({ value, className }: { value: string; className?: string }) {
  const v = (value ?? "").toUpperCase();
  const tone: Tone = v === "HIGH" ? "negative" : v === "MEDIUM" ? "warn" : "muted";
  return (
    <Pill tone={tone} className={className}>
      {v}
    </Pill>
  );
}

// One signal's directional vote (▲ bullish / ▼ bearish / – neutral).
export function VoteBadge({ signal, vote }: { signal: string; vote: number }) {
  const tone: Tone = vote > 0 ? "positive" : vote < 0 ? "negative" : "muted";
  return (
    <Pill tone={tone} className="normal-case">
      {signal} {vote > 0 ? "▲" : vote < 0 ? "▼" : "–"}
    </Pill>
  );
}
