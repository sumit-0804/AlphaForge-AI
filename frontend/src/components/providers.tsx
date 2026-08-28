"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser session, created lazily so it survives re-renders.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      {/* Inside the provider: signing out clears the cache, so the next account cannot read it. */}
      <AuthProvider>{children}</AuthProvider>
      <Toaster position="top-center" offset={12} />
    </QueryClientProvider>
  );
}
