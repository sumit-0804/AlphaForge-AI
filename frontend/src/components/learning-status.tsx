import { type LearningStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

// Plain-English text for the memory/learning-loop status. Separates "nothing
// learned yet" (normal) from "the index is broken" (needs a reindex).
const TEXT: Record<LearningStatus, string> = {
  ok: "Learning loop healthy.",
  no_lessons_yet: "No lessons yet — close a paper trade to start teaching it.",
  index_unavailable: "Lessons exist but the search index is missing — a reindex is needed.",
  index_degraded: "Some lessons failed to index — the learning loop is degraded.",
  unavailable: "Memory was unavailable for this run.",
  unknown: "Learning status unknown.",
};

const BROKEN: LearningStatus[] = ["index_unavailable", "index_degraded"];

// Inline sentence — used inside the committee's memory note.
export function LearningStatusNote({
  status,
  empty,
}: {
  status?: LearningStatus;
  empty: string;
}) {
  if (!status || status === "ok" || status === "no_lessons_yet") return <>{empty}</>;
  return <span className={BROKEN.includes(status) ? "text-negative" : undefined}>{TEXT[status]}</span>;
}

// A small standalone chip — used on the Analyze page and recommendation card.
export function LearningStatusChip({ status }: { status?: LearningStatus }) {
  if (!status) return null;
  const broken = BROKEN.includes(status);
  const dot = status === "ok" ? "bg-positive" : broken ? "bg-negative" : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1.5 bg-muted px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-inset ring-border">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {TEXT[status]}
    </span>
  );
}
