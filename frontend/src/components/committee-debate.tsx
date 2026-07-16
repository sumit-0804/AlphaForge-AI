"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    streamDebate,
    type DebateArgument,
    type DebateDecision,
    type DebateEvent,
    type DebateMemory,
} from "@/lib/api";

/* ---------- streaming state ---------- */

type RoundView = {
    round: number;
    bull: DebateArgument;
    bear: DebateArgument;
    converged?: boolean;
};

export type DebateState = {
    running: boolean;
    ticker: string | null;
    status: string;
    memory: DebateMemory | null;
    rounds: RoundView[];
    decision: DebateDecision | null;
    model: string | null;
    error: string | null;
};

export const initialDebateState: DebateState = {
    running: false,
    ticker: null,
    status: "",
    memory: null,
    rounds: [],
    decision: null,
    model: null,
    error: null,
};

export function debateReduce(prev: DebateState, ev: DebateEvent): DebateState {
    switch (ev.type) {
        case "status":
            return { ...prev, status: ev.message };
        case "memory":
            return { ...prev, memory: ev.memory };
        case "opening":
            return {
                ...prev,
                status: "Opening statements",
                rounds: [{ round: ev.round, bull: ev.bull, bear: ev.bear }],
            };
        case "rebuttal":
            return {
                ...prev,
                status: `Rebuttal round ${ev.round}`,
                rounds: [
                    ...prev.rounds,
                    { round: ev.round, bull: ev.bull, bear: ev.bear, converged: ev.converged },
                ],
            };
        case "decision":
            return { ...prev, decision: ev.decision, model: ev.model, status: "Verdict" };
        case "done":
            return { ...prev, running: false, status: "Complete" };
        case "error":
            return { ...prev, running: false, error: ev.message };
        default:
            return prev;
    }
}

/** Hook that drives one streaming debate and accumulates its rounds. */
export function useDebateStream() {
    const [state, setState] = useState<DebateState>(initialDebateState);
    const abortRef = useRef<AbortController | null>(null);

    const run = useCallback((ticker: string, opts: { news?: boolean; rounds?: number }) => {
        abortRef.current?.abort();
        const ac = new AbortController();
        abortRef.current = ac;
        setState({ ...initialDebateState, running: true, ticker: ticker.toUpperCase() });

        streamDebate(ticker, opts, (ev) => setState((prev) => debateReduce(prev, ev)), ac.signal)
            .then(() => setState((prev) => ({ ...prev, running: false })))
            .catch((e: unknown) => {
                if (ac.signal.aborted) return;
                setState((prev) => ({ ...prev, running: false, error: (e as Error).message }));
            });
    }, []);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
        setState((prev) => ({ ...prev, running: false, status: "Cancelled" }));
    }, []);

    useEffect(() => () => abortRef.current?.abort(), []);

    return { state, run, cancel };
}

/* ---------- chat pieces ---------- */

function Avatar({ side }: { side: "bull" | "bear" }) {
    const bull = side === "bull";
    return (
        <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ring-1 ${
                bull
                    ? "bg-emerald-500/15 ring-emerald-500/30"
                    : "bg-red-500/15 ring-red-500/30"
            }`}
            aria-hidden
        >
            {bull ? "🐂" : "🐻"}
        </div>
    );
}

function TypingDots({ tone }: { tone: "bull" | "bear" | "mod" }) {
    const color =
        tone === "bull" ? "bg-emerald-500" : tone === "bear" ? "bg-red-500" : "bg-amber-500";
    return (
        <span className="inline-flex items-center gap-1 py-0.5">
            {[0, 150, 300].map((delay) => (
                <span
                    key={delay}
                    className={`h-1.5 w-1.5 animate-bounce rounded-full ${color}`}
                    style={{ animationDelay: `${delay}ms` }}
                />
            ))}
        </span>
    );
}

/** One analyst's turn, rendered as a WhatsApp-style group of message bubbles. */
function MessageGroup({
    side,
    arg,
    isOpening,
}: {
    side: "bull" | "bear";
    arg: DebateArgument;
    isOpening: boolean;
}) {
    const bull = side === "bull";
    const points = isOpening ? arg.arguments ?? [] : arg.rebuttals ?? arg.arguments ?? [];
    const label = bull ? "Bull analyst" : "Bear analyst";

    const bubbleBase =
        "w-fit max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm animate-in fade-in duration-300";
    const bubbleTone = bull
        ? "bg-emerald-500/10 text-foreground rounded-tl-sm"
        : "bg-red-500/10 text-foreground rounded-tr-sm";

    return (
        <div className={`flex gap-2 ${bull ? "justify-start" : "flex-row-reverse justify-start"}`}>
            <Avatar side={side} />
            <div className={`flex min-w-0 max-w-[82%] flex-col gap-1 ${bull ? "items-start" : "items-end"}`}>
                <div className={`flex items-center gap-2 px-1 ${bull ? "" : "flex-row-reverse"}`}>
                    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                    {arg.concede && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-600">
                            concedes
                        </span>
                    )}
                    {arg.has_new_points === false && !arg.concede && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                            rests case
                        </span>
                    )}
                </div>

                {points.length === 0 && (
                    <div className={`${bubbleBase} ${bubbleTone} text-muted-foreground`}>…</div>
                )}
                {points.map((p, i) => (
                    <div
                        key={i}
                        className={`${bubbleBase} ${bubbleTone} ${bull ? "slide-in-from-left-2" : "slide-in-from-right-2"}`}
                        style={{ animationDelay: `${i * 90}ms` }}
                    >
                        {!isOpening && i === 0 && (
                            <span className={`mr-1 ${bull ? "text-emerald-600" : "text-red-600"}`}>↳</span>
                        )}
                        {p}
                    </div>
                ))}

                {arg.key_point && (
                    <div
                        className={`${bubbleBase} ${
                            bull
                                ? "bg-emerald-500/20 rounded-tl-sm"
                                : "bg-red-500/20 rounded-tr-sm"
                        } font-medium`}
                    >
                        <span className={bull ? "text-emerald-600" : "text-red-600"}>★ </span>
                        {arg.key_point}
                    </div>
                )}
            </div>
        </div>
    );
}

function RoundDivider({ round }: { round: number }) {
    return (
        <div className="my-1 flex justify-center">
            <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                {round === 1 ? "Opening statements" : `Rebuttal · round ${round}`}
            </span>
        </div>
    );
}

function SystemNote({ memory }: { memory: DebateMemory }) {
    const hasLessons = memory.prior_lessons.length > 0;
    return (
        <div className="mx-auto max-w-md animate-in fade-in duration-500">
            <div
                className={`rounded-xl px-3 py-2 text-center text-xs ${
                    hasLessons
                        ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                        : "bg-muted text-muted-foreground"
                }`}
            >
                {hasLessons ? (
                    <>
                        <p className="mb-1 font-medium">🧠 The committee recalls past trades</p>
                        <ul className="space-y-0.5 text-left">
                            {memory.prior_lessons.map((l, i) => (
                                <li key={i} className="leading-snug">
                                    • {l}
                                </li>
                            ))}
                        </ul>
                    </>
                ) : (
                    "🧠 No prior memory for this ticker — starting fresh."
                )}
            </div>
        </div>
    );
}

function ModeratorAnnouncement({
    decision,
    model,
}: {
    decision: DebateDecision;
    model: string | null;
}) {
    const v = (decision.decision ?? "HOLD").toUpperCase();
    const tone =
        v === "BUY"
            ? "bg-emerald-500/15 text-emerald-600 ring-emerald-500/40"
            : v === "SELL"
              ? "bg-red-500/15 text-red-600 ring-red-500/40"
              : "bg-amber-500/15 text-amber-600 ring-amber-500/40";

    return (
        <div className="mx-auto w-full max-w-lg animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    ⚖️ The moderator delivers the verdict
                </span>
            </div>
            <div className="mt-2 rounded-2xl border bg-card p-4 text-center shadow-sm">
                <div className="mb-2 flex items-center justify-center gap-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${tone}`}>
                        {v}
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {(decision.confidence ?? "LOW").toUpperCase()} confidence
                    </span>
                </div>
                {decision.rationale && (
                    <p className="text-sm text-muted-foreground">{decision.rationale}</p>
                )}

                {((decision.key_catalysts?.length ?? 0) > 0 ||
                    (decision.key_risks?.length ?? 0) > 0) && (
                    <div className="mt-3 grid gap-3 text-left sm:grid-cols-2">
                        {(decision.key_catalysts?.length ?? 0) > 0 && (
                            <div>
                                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Catalysts
                                </p>
                                <ul className="space-y-1 text-sm">
                                    {decision.key_catalysts!.map((c, i) => (
                                        <li key={i} className="flex gap-2">
                                            <span className="text-emerald-600">↑</span>
                                            <span>{c}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {(decision.key_risks?.length ?? 0) > 0 && (
                            <div>
                                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Risks
                                </p>
                                <ul className="space-y-1 text-sm">
                                    {decision.key_risks!.map((r, i) => (
                                        <li key={i} className="flex gap-2">
                                            <span className="text-red-600">↓</span>
                                            <span>{r}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
                {model && (
                    <p className="mt-3 text-[10px] text-muted-foreground">decided by {model}</p>
                )}
            </div>
        </div>
    );
}

/* ---------- the chat view ---------- */

export function CommitteeDebate({ state }: { state: DebateState }) {
    const bodyRef = useRef<HTMLDivElement | null>(null);

    // Auto-scroll to the latest message — but only if the reader is already near
    // the bottom, so scrolling up to re-read isn't yanked back down.
    useEffect(() => {
        const el = bodyRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (nearBottom) el.scrollTop = el.scrollHeight;
    }, [state.rounds.length, state.decision, state.memory, state.running, state.error]);

    if (!state.ticker) {
        return (
            <div className="rounded-xl border border-dashed bg-card p-12 text-center">
                <div className="mb-2 text-3xl">🐂 ⚖️ 🐻</div>
                <p className="text-sm text-muted-foreground">
                    Pick a ticker and open the floor — the Bull and Bear will argue it out live.
                </p>
            </div>
        );
    }

    const waitingForNextRound = state.running && !state.decision && state.rounds.length > 0;

    return (
        <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
            {/* chat header */}
            <div className="flex items-center gap-2 border-b bg-card px-4 py-2.5">
                <div className="flex -space-x-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-xs ring-2 ring-card">
                        🐂
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/15 text-xs ring-2 ring-card">
                        🐻
                    </span>
                </div>
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold leading-tight">
                        {state.ticker} committee
                    </p>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                                state.running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground"
                            }`}
                        />
                        {state.running ? state.status || "live" : state.status || "idle"}
                    </p>
                </div>
                {state.rounds.length > 0 && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                        {state.rounds.length} round{state.rounds.length > 1 ? "s" : ""}
                        {state.rounds.at(-1)?.converged ? " · converged" : ""}
                    </span>
                )}
            </div>

            {/* conversation */}
            <div
                ref={bodyRef}
                className="flex max-h-[65vh] min-h-[22rem] flex-col gap-3 overflow-y-auto bg-muted/20 p-4"
            >
                {state.memory && <SystemNote memory={state.memory} />}

                {state.rounds.length === 0 && state.running && (
                    <p className="mx-auto animate-pulse text-xs text-muted-foreground">
                        {state.status || "gathering evidence…"}
                    </p>
                )}

                {state.rounds.map((r) => (
                    <div key={r.round} className="flex flex-col gap-3">
                        <RoundDivider round={r.round} />
                        <MessageGroup side="bull" arg={r.bull} isOpening={r.round === 1} />
                        <MessageGroup side="bear" arg={r.bear} isOpening={r.round === 1} />
                    </div>
                ))}

                {/* both analysts "typing" the next round */}
                {waitingForNextRound && (
                    <div className="flex flex-col gap-3">
                        <div className="flex gap-2">
                            <Avatar side="bull" />
                            <div className="w-fit rounded-2xl rounded-tl-sm bg-emerald-500/10 px-3 py-2">
                                <TypingDots tone="bull" />
                            </div>
                        </div>
                        <div className="flex flex-row-reverse gap-2">
                            <Avatar side="bear" />
                            <div className="w-fit rounded-2xl rounded-tr-sm bg-red-500/10 px-3 py-2">
                                <TypingDots tone="bear" />
                            </div>
                        </div>
                    </div>
                )}

                {state.decision && <ModeratorAnnouncement decision={state.decision} model={state.model} />}

                {state.error && (
                    <div className="mx-auto max-w-md rounded-xl bg-red-500/10 px-3 py-2 text-center text-sm text-red-600">
                        {state.error}
                    </div>
                )}
            </div>
        </div>
    );
}
