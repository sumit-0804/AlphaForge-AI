"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import { ErrorNote, PageTitle, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChangePassword, useMemoryHealth, useQuota } from "@/lib/queries";
import { num, percent } from "@/lib/format";
import type { LearningStatus, QuotaSnapshot } from "@/lib/api";

const LEARNING_LINE: Record<LearningStatus, string> = {
  ok: "The learning loop is working — past trades feed into new calls.",
  no_lessons_yet: "Nothing learned yet. Close a paper trade and it will start writing lessons.",
  index_unavailable: "Lessons are being written, but the search index is not answering, so they cannot be recalled.",
  index_degraded: "Some lessons have no vector yet, so recall is only seeing part of them.",
  unavailable: "Memory is unavailable right now.",
  unknown: "The state of the learning loop is unclear.",
};

// The backend keys memory counts by singular type name, so the label has to agree with the number.
function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const quota = useQuota();
  const memory = useMemoryHealth();

  return (
    <>
      <PageTitle>Settings</PageTitle>

      <Section title="Account">
        <p className="text-[15px]">{user?.email}</p>
      </Section>

      <Section title="Learning">
        {memory.isError && <ErrorNote error={memory.error} retry={() => memory.refetch()} />}
        {memory.data && (
          <>
            <p className="text-[15px] text-ink-2">
              {LEARNING_LINE[memory.data.status] ?? LEARNING_LINE.unknown}
            </p>
            <p className="tnum mt-2 text-sm text-ink-3">
              {Object.entries(memory.data.counts)
                .map(([kind, count]) => `${num(count)} ${plural(kind.replace(/_/g, " "), count)}`)
                .join(" · ")}
              {memory.data.unindexed_entries > 0 &&
                ` · ${num(memory.data.unindexed_entries)} not yet searchable`}
            </p>
          </>
        )}
      </Section>

      <Section title="Model budget">
        {quota.isError && <ErrorNote error={quota.error} retry={() => quota.refetch()} />}
        {quota.data && (
          <div className="flex flex-col gap-4">
            <Budget label="Analysis and chat" snapshot={quota.data.chat} />
            <Budget label="Memory embeddings" snapshot={quota.data.embedding} />
          </div>
        )}
      </Section>

      <Section title="Password">
        <PasswordForm />
      </Section>

      <Section>
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </Section>
    </>
  );
}

function Budget({ label, snapshot }: { label: string; snapshot: QuotaSnapshot }) {
  const used = snapshot.rpd ? Math.min(100, (snapshot.requests_today / snapshot.rpd) * 100) : null;

  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-sm">{label}</span>
        <span className="tnum ml-auto text-[13px] text-ink-3">
          {snapshot.rpd
            ? `${num(snapshot.requests_today)} of ${num(snapshot.rpd)} today`
            : `${num(snapshot.requests_today)} today`}
        </span>
      </div>
      {used != null && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full bg-primary" style={{ width: `${used}%` }} />
        </div>
      )}
      <p className="tnum mt-1.5 text-[13px] text-ink-3">
        {num(snapshot.requests)} of {num(snapshot.rpm)} in the last minute
        {used != null && ` · ${percent(used, 0)} of today's budget used`}
      </p>
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = useChangePassword();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !next) {
      setError("Fill in both fields.");
      return;
    }
    setError(null);
    change.mutate(
      { current, next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          toast.success("Password changed");
        },
        onError: (err) =>
          setError(err instanceof Error ? err.message : "That password change did not go through."),
      }
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        type="password"
        autoComplete="current-password"
        placeholder="Current password"
        aria-label="Current password"
        value={current}
        onChange={(e) => {
          setCurrent(e.target.value);
          setError(null);
        }}
      />
      <Input
        type="password"
        autoComplete="new-password"
        placeholder="New password"
        aria-label="New password"
        value={next}
        onChange={(e) => {
          setNext(e.target.value);
          setError(null);
        }}
      />
      {error && <p className="text-sm text-down">{error}</p>}
      <Button type="submit" variant="outline" disabled={change.isPending} className="self-start">
        {change.isPending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
