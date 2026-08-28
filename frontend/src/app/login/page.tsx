"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const { status, signIn, signUp } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await (mode === "in" ? signIn(email.trim(), password) : signUp(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <span
        aria-hidden
        className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-card ring-1 ring-border"
      >
        <svg viewBox="0 0 32 32" className="size-9 text-primary drop-shadow-[0_0_10px_currentColor]" fill="none">
          <path
            d="M8.6 22.4 16 9.4l7.4 13"
            stroke="currentColor"
            strokeWidth="3.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <h1 className="font-heading text-2xl font-medium">
        {mode === "in" ? "Welcome back" : "Start your book"}
      </h1>
      <p className="mt-1.5 text-sm text-ink-2">
        {mode === "in"
          ? "Sign in to pick up where your research left off."
          : "Paper trading only, so nothing here costs real money."}
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-3">
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="name@example.com"
          aria-label="Email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
        />
        <Input
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />

        {error && <p className="text-sm text-down">{error}</p>}

        <Button type="submit" size="lg" disabled={busy} className="mt-2">
          {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        className="mt-6 h-11 text-sm text-ink-2"
        onClick={() => {
          setMode(mode === "in" ? "up" : "in");
          setError(null);
        }}
      >
        {mode === "in" ? (
          <>
            New here? <span className="text-primary">Create an account</span>
          </>
        ) : (
          <>
            Already have one? <span className="text-primary">Sign in</span>
          </>
        )}
      </button>
    </main>
  );
}
