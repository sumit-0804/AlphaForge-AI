"use client";

import { cn } from "@/lib/utils";
import type { DebateArgument } from "@/lib/api";

export type DebateRound = {
  round: number;
  bull: DebateArgument;
  bear: DebateArgument;
  converged?: boolean;
};

/** The debate reads as a conversation, because that is what it is. */
export function DebateThread({ rounds }: { rounds: DebateRound[] }) {
  if (rounds.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {rounds.map((round) => (
        <div key={round.round} className="flex flex-col gap-3">
          <Divider>{round.round === 1 ? "Opening arguments" : `Round ${round.round}`}</Divider>
          <Bubble stance="bull" argument={round.bull} />
          <Bubble stance="bear" argument={round.bear} />
          {round.converged && <Divider>They stopped finding new ground</Divider>}
        </div>
      ))}
    </div>
  );
}

function Divider({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-center text-[11px] text-ink-3">{children}</p>;
}

function Bubble({ stance, argument }: { stance: "bull" | "bear"; argument: DebateArgument }) {
  const bull = stance === "bull";
  // Rebuttals replace the opening points once a side has heard the other out.
  const points = (argument.rebuttals?.length ? argument.rebuttals : argument.arguments) ?? [];

  return (
    <div className={cn("flex gap-2", !bull && "flex-row-reverse")}>
      <span aria-hidden className="shrink-0 text-lg leading-6">
        {bull ? "🐂" : "🐻"}
      </span>
      <div
        className={cn(
          "max-w-[84%] rounded-2xl border px-3 py-2.5",
          bull
            ? "rounded-bl-sm border-up/22 bg-tint-up"
            : "rounded-br-sm border-down/22 bg-tint-down"
        )}
      >
        <p
          className={cn(
            "text-[11px]",
            bull ? "text-up" : "text-right text-down"
          )}
        >
          {bull ? "Bull" : "Bear"}
          {argument.concede && " · conceded"}
        </p>
        {argument.key_point && (
          <p className="mt-1 text-sm leading-relaxed text-foreground">{argument.key_point}</p>
        )}
        {points.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {points.map((point, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink-2">
                {point}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
