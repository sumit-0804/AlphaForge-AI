"use client";

import { AnalysisRun } from "@/components/analysis-run";
import { PastCalls } from "@/components/past-calls";
import { Section } from "@/components/page";
import { StockHeader } from "@/components/stock-header";

export function StockScreen({ ticker }: { ticker: string }) {
  return (
    <>
      <StockHeader ticker={ticker} />
      {/* Keyed on the ticker so navigating between two stocks never shows the previous run. */}
      <AnalysisRun key={ticker} ticker={ticker} />
      <Section title="Earlier calls">
        <PastCalls ticker={ticker} />
      </Section>
    </>
  );
}
