"use client";

import { useState } from "react";

import { Empty, ErrorNote, PageTitle, RowsSkeleton, Section } from "@/components/page";
import { ScanCandidateRow } from "@/components/scan-list";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarketSessions, useScan } from "@/lib/queries";
import { num } from "@/lib/format";
import type { UniverseKey } from "@/lib/api";

const UNIVERSES: { value: UniverseKey; label: string }[] = [
  { value: "ALL", label: "Everything" },
  { value: "IN", label: "India" },
  { value: "US", label: "US" },
];

const SOURCE_LINE: Record<string, string> = {
  discovery: "from today's live movers",
  fallback: "from the offline list, since the live screener was unavailable",
  explicit: "from the list you asked for",
};

export default function ScannerPage() {
  const [market, setMarket] = useState<UniverseKey>("ALL");
  const sessions = useMarketSessions();
  const scan = useScan(10, market);

  const open = sessions.data
    ? Object.values(sessions.data).filter((s) => s.is_open).map((s) => s.label)
    : [];

  return (
    <>
      <PageTitle>Ideas</PageTitle>

      <Section>
        {sessions.data && (
          <p className="text-sm text-ink-3">
            <span aria-hidden>{open.length ? "🟢" : "🌙"}</span>{" "}
            {open.length ? `${open.join(" and ")} open right now.` : "Both markets are closed right now."}
          </p>
        )}

        <Tabs
          value={market}
          onValueChange={(value) => setMarket(value as UniverseKey)}
          className="mt-4"
        >
          <TabsList>
            {UNIVERSES.map((u) => (
              <TabsTrigger key={u.value} value={u.value}>
                {u.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          variant="tinted"
          className="mt-4"
          disabled={scan.isFetching}
          onClick={() => scan.refetch()}
        >
          {scan.isFetching ? "Scanning…" : scan.data ? "Scan again" : "Run a scan"}
        </Button>
      </Section>

      {scan.isFetching && (
        <Section>
          <RowsSkeleton rows={3} />
        </Section>
      )}

      {scan.isError && !scan.isFetching && (
        <Section>
          <ErrorNote error={scan.error} retry={() => scan.refetch()} />
        </Section>
      )}

      {scan.data && !scan.isFetching && (
        <>
          <Section title="What it found">
            {scan.data.triage?.summary && (
              <p className="text-[15px] text-ink-2">{scan.data.triage.summary}</p>
            )}
            <p className="mt-1.5 text-sm text-ink-3">
              {num(scan.data.scanned)} scanned, {num(scan.data.matched)} matched
              {scan.data.universe_source ? `, ${SOURCE_LINE[scan.data.universe_source]}` : ""}.
            </p>
          </Section>

          <Section>
            {scan.data.candidates.length === 0 ? (
              <Empty>Nothing cleared the filters in this market today.</Empty>
            ) : (
              <div className="flex flex-col">
                {scan.data.candidates.map((candidate, i) => (
                  <ScanCandidateRow
                    key={candidate.symbol}
                    candidate={candidate}
                    rank={i + 1}
                    triage={scan.data.triage?.ranked.find((t) => t.symbol === candidate.symbol)}
                  />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
