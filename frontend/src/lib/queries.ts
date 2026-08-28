"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import * as api from "@/lib/api";

export const keys = {
  portfolio: ["portfolio"] as const,
  transactions: (limit: number) => ["transactions", limit] as const,
  advisor: ["advisor"] as const,
  scan: (limit: number, market: api.UniverseKey) => ["scan", limit, market] as const,
  sessions: ["sessions"] as const,
  info: (ticker: string) => ["info", ticker] as const,
  history: (ticker: string, period: string) => ["history", ticker, period] as const,
  search: (q: string) => ["search", q] as const,
  calls: (ticker?: string) => ["calls", ticker ?? "all"] as const,
  report: ["report", "latest"] as const,
  quota: ["quota"] as const,
  memoryHealth: ["memory", "health"] as const,
  memory: (type?: string) => ["memory", "recent", type ?? "all"] as const,
};

export function usePortfolio() {
  return useQuery({ queryKey: keys.portfolio, queryFn: api.fetchPortfolio });
}

export function useTransactions(limit = 50) {
  return useQuery({
    queryKey: keys.transactions(limit),
    queryFn: () => api.fetchTransactions(limit),
  });
}

export function useAdvisor(enabled: boolean) {
  return useQuery({ queryKey: keys.advisor, queryFn: api.fetchAdvisorSuggestions, enabled });
}

export function useMarketSessions() {
  return useQuery({
    queryKey: keys.sessions,
    queryFn: api.fetchMarketSessions,
    refetchInterval: 60_000,
  });
}

// A scan costs two model calls, so it only runs when the user asks for one.
export function useScan(limit: number, market: api.UniverseKey) {
  return useQuery({
    queryKey: keys.scan(limit, market),
    queryFn: () => api.fetchScan(limit, true, market),
    enabled: false,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
}

export function useStockInfo(ticker: string) {
  return useQuery({
    queryKey: keys.info(ticker),
    queryFn: () => api.fetchStockInfo(ticker),
    enabled: !!ticker,
  });
}

export function useHistory(ticker: string, period = "6mo") {
  return useQuery({
    queryKey: keys.history(ticker, period),
    queryFn: () => api.fetchHistory(ticker, period, "1d"),
    enabled: !!ticker,
  });
}

export function useSymbolSearch(query: string) {
  return useQuery({
    queryKey: keys.search(query),
    queryFn: () => api.searchSymbols(query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60_000,
  });
}

export function usePastCalls(ticker?: string, limit = 20) {
  return useQuery({
    queryKey: keys.calls(ticker),
    queryFn: () => api.fetchRecommendationHistory(ticker, limit),
  });
}

export function useLatestReport() {
  return useQuery({ queryKey: keys.report, queryFn: api.fetchLatestReport });
}

export function useQuota() {
  return useQuery({ queryKey: keys.quota, queryFn: api.fetchQuota, refetchInterval: 30_000 });
}

export function useMemoryHealth() {
  return useQuery({ queryKey: keys.memoryHealth, queryFn: api.fetchMemoryHealth });
}

export function useRecentMemory(type?: string, limit = 20) {
  return useQuery({
    queryKey: keys.memory(type),
    queryFn: () => api.fetchRecentMemory(type, limit),
  });
}

// A fill changes cash, positions and history at once, so all three are invalidated together.
export function useTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.executeTrade,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.portfolio });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: keys.advisor });
    },
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.generateDailyReport,
    onSuccess: (report) => {
      qc.setQueryData(keys.report, report);
      qc.invalidateQueries({ queryKey: keys.quota });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      api.changePassword(current, next),
  });
}
