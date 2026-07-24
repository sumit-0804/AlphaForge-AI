"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SpinnerIcon } from "@phosphor-icons/react";

import { useAuth } from "@/components/auth-provider";
import { Nav } from "@/components/nav";

const LOGIN_ROUTE = "/login";

/** Decides what a visitor sees: the sign-in screen, a spinner while the stored
 *  token is checked, or the app with its navigation. Everything behind this is a
 *  convenience — the API rejects unauthenticated requests regardless. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const onLogin = pathname === LOGIN_ROUTE;

  useEffect(() => {
    if (status === "loading") return;
    // replace(), not push(): an expired session shouldn't leave a page in history
    // that the back button returns to.
    if (status === "anonymous" && !onLogin) router.replace(LOGIN_ROUTE);
    if (status === "authenticated" && onLogin) router.replace("/");
  }, [status, onLogin, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <SpinnerIcon size={20} className="animate-spin text-muted-foreground" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  // Render nothing for the frame between deciding to redirect and arriving — the
  // alternative is the dashboard flashing its empty state at a signed-out user.
  if (status === "anonymous" && !onLogin) return null;
  if (status === "authenticated" && onLogin) return null;

  if (onLogin) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav />
      <main className="flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
