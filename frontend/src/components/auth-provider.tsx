"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
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
  // The token lives outside React, so read it as an external store rather than mirroring it.
  const token = useSyncExternalStore(onTokenChange, getToken, () => null);
  const [user, setUser] = useState<api.AuthUser | null>(null);
  const queryClient = useQueryClient();

  // Holding a token is not the same as it working, and the shell must not flash before /auth/me answers.
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
        // The 401 interceptor already dropped it; this covers network failures and 500s.
        if (!cancelled) clearToken();
      });

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  // Cached queries belong to whoever was signed in when they were fetched.
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
      // Guard on the token too: after the interceptor clears it, `user` lingers for one tick.
      value={{ user: token ? user : null, status, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
