"use client";

import { useState } from "react";
import { SpinnerIcon } from "@phosphor-icons/react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signingUp = mode === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Matches the backend's min_length=8, so the common case fails here rather
    // than as a 422 with a Pydantic error body.
    if (signingUp && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      // On success the provider flips status to "authenticated" and AppShell
      // navigates away — no redirect needed here.
      await (signingUp ? signUp(email, password) : signIn(email, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center bg-primary text-primary-foreground">
            <span className="text-sm font-bold">α</span>
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">AlphaForge</span>
            <span className="text-[10px] text-muted-foreground">paper trading</span>
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm p-6">
          <div className="mb-5">
            <h1 className="text-lg font-semibold tracking-tight">
              {signingUp ? "Create an account" : "Sign in"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {signingUp
                ? "Your book, lessons and past calls are private to this account."
                : "Welcome back."}
            </p>
          </div>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="email"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="password"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                // Tells password managers to offer a new password rather than autofill
                // the existing one when the form is in sign-up mode.
                autoComplete={signingUp ? "new-password" : "current-password"}
                required
                minLength={signingUp ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={signingUp ? "at least 8 characters" : "••••••••"}
              />
            </div>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy} className="mt-1 w-full">
              {busy && <SpinnerIcon size={14} className="animate-spin" />}
              {signingUp ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            {signingUp ? "Already have an account?" : "No account yet?"}{" "}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setMode(signingUp ? "signin" : "signup");
                setError(null);
              }}
            >
              {signingUp ? "Sign in" : "Create one"}
            </button>
          </p>
        </Card>
      </main>

      <footer className="border-t px-4 py-3 text-center text-[10px] text-muted-foreground">
        Educational analysis — not financial advice.
      </footer>
    </div>
  );
}
