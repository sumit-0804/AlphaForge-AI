"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api";
import { clearToken, getToken, onTokenChange, setToken } from "@/lib/auth";

type Status = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  user: api.AuthUser | null;
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The token lives outside React (the axios interceptor writes to it), so read it
  // as an external store rather than mirroring it into state. This also means an
  // interceptor-driven logout re-renders the tree without any extra plumbing.
  // The server snapshot is null so prerendering agrees with the pre-hydration DOM.
  const token = useSyncExternalStore(onTokenChange, getToken, () => null);
  const [user, setUser] = useState<api.AuthUser | null>(null);
  const queryClient = useQueryClient();

  // Having a token isn't the same as it working: until /auth/me confirms it we're
  // still deciding, which is what keeps the app frame from flashing for a user
  // whose session expired while the tab was closed.
  const status: Status = !token ? "anonymous" : user ? "authenticated" : "loading";

  useEffect(() => {
    if (!token || user) return;

    let cancelled = false;
    api
      .fetchMe()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        // The 401 interceptor already dropped the token; this covers the rest
        // (network failure, a 500). Either way the credential is unusable.
        if (!cancelled) clearToken();
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  // Every cached query belongs to whoever was signed in when it was fetched, so
  // wipe the cache whenever there's no session — otherwise the next account
  // briefly sees the previous one's portfolio out of cache before a refetch lands.
  // Covers signOut and the interceptor's mid-session clear alike.
  useEffect(() => {
    if (!token) queryClient.clear();
  }, [token, queryClient]);

  const accept = useCallback(
    (res: api.TokenResponse) => {
      queryClient.clear();
      setToken(res.access_token);
      setUser(res.user);
    },
    [queryClient]
  );

  const signIn = useCallback(
    async (email: string, password: string) => accept(await api.login(email, password)),
    [accept]
  );

  const signUp = useCallback(
    async (email: string, password: string) => accept(await api.register(email, password)),
    [accept]
  );

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        // Guard on the token as well: after the interceptor clears it, `user` is
        // still set until the effect above runs, and a stale identity must never
        // be readable in that window.
        user: token ? user : null,
        status,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
