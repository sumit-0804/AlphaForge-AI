"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react";

import { money, num, sentence, tickerName } from "@/lib/format";
import type { ScanCandidate, TriageEntry } from "@/lib/api";

const SIGNAL_WORDS: Record<string, string> = {
  breakout: "breaking out",
  oversold: "oversold",
  overbought: "overbought",
  golden_cross: "golden cross",
  death_cross: "death cross",
  volume_spike: "unusual volume",
  momentum: "momentum",
};

function readSignals(signals: string[]): string {
  const words = signals.map((s) => SIGNAL_WORDS[s.toLowerCase()] ?? s.replace(/_/g, " ").toLowerCase());
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function ScanCandidateRow({
  candidate,
  triage,
  rank,
}: {
  candidate: ScanCandidate;
  triage?: TriageEntry;
  rank: number;
}) {
  const signals = readSignals(candidate.signals);

  return (
    <div className="border-b border-border py-4 last:border-0">
      <div className="flex items-baseline gap-2.5">
        <span className="tnum text-[13px] text-ink-3">{String(rank).padStart(2, "0")}</span>
        <Link href={`/stock/${encodeURIComponent(candidate.symbol)}`} className="text-[15px] font-medium">
          {tickerName(candidate.symbol)}
        </Link>
        {triage && <span className="text-[13px] text-ink-3">{sentence(triage.conviction)} conviction</span>}
        <span className="tnum ml-auto text-[15px]">{money(candidate.price, candidate.currency)}</span>
      </div>

      <p className="mt-1.5 text-sm text-ink-2">
        {triage?.thesis ??
          (signals
            ? `It is ${signals}${candidate.rsi != null ? `, RSI ${candidate.rsi.toFixed(0)}` : ""}.`
            : "It cleared the scan filters.")}
      </p>

      <p className="tnum mt-1 text-[13px] text-ink-3">
        {candidate.rsi != null && `RSI ${candidate.rsi.toFixed(0)}`}
        {candidate.volume_ratio != null && ` · ${candidate.volume_ratio.toFixed(1)}× usual volume`}
        {candidate.score != null && ` · score ${num(candidate.score)}`}
      </p>

      {triage?.invalidation && (
        <p className="mt-1.5 text-[13px] text-ink-3">Wrong if {lowerFirst(triage.invalidation)}</p>
      )}

      {triage?.worth_deep_analysis && (
        <Link
          href={`/stock/${encodeURIComponent(candidate.symbol)}`}
          className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg bg-accent-soft px-3.5 text-sm text-primary"
        >
          Run the full analysis
          <ArrowRightIcon size={15} />
        </Link>
      )}
    </div>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
