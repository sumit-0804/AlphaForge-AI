import axios, { AxiosError } from "axios";

import { authHeader, clearToken, getToken } from "@/lib/auth";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const client = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

// Read the token per request: a client built at import time would hold the one from before login.
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ detail?: string }>) => {
    const status = error.response?.status;
    // Drop a credential the server already rejected; AuthProvider hears the clear and redirects.
    if (status === 401 && !isAuthPath(error.config?.url)) clearToken();
    const detail = error.response?.data?.detail;
    throw new Error(detail ?? error.message ?? `Request failed${status ? `: ${status}` : ""}`);
  }
);

// A 401 here means "wrong password", so clearing would sign out someone who simply mistyped.
function isAuthPath(url?: string): boolean {
  return !!url && (url.startsWith("/auth/login") || url.startsWith("/auth/register"));
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await client.get<T>(path);
  return res.data;
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await client.post<T>(path, body);
  return res.data;
}

/* ---- HEALTH ---- */

export type HealthResponse = {
  status: string;
  service: string;
  environment: string;
  mongodb: string;
  timestamp: string;
};

export const fetchHealth = () => getJSON<HealthResponse>("/health");

/* ---- MARKET ---- */

export type StockInfo = {
  symbol: string | null;
  shortName: string | null;
  longName: string | null;
  sector: string | null;
  industry: string | null;
  currentPrice: number | null;
  marketCap: number | null;
  volume: number | null;
  averageVolume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  exchange: string | null;
  exchangeName: string | null;
  country: string | null;
  currency: string;
};

export const fetchStockInfo = (ticker: string) =>
  getJSON<StockInfo>(`/market/info/${ticker.toUpperCase()}`);

export type SymbolResult = {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
};

export const searchSymbols = (query: string, limit = 10) =>
  getJSON<SymbolResult[]>(`/market/search?q=${encodeURIComponent(query)}&limit=${limit}`);

export type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const fetchHistory = (ticker: string, period = "6mo", interval = "1d") =>
  client
    .get<Candle[]>(`/market/history/${ticker.toUpperCase()}`, { params: { period, interval } })
    .then((res) => res.data);

export type MarketKey = "IN" | "US";

export type MarketSession = {
  market: MarketKey;
  label: string;
  timezone: string;
  local_time: string;
  opens: string;
  closes: string;
  is_open: boolean;
};

export const fetchMarketSessions = () =>
  getJSON<Record<MarketKey, MarketSession>>("/market/sessions");

/* ---- PORTFOLIO / TRADING ---- */

export type PositionSummary = {
  ticker: string;
  quantity: number;
  /** The stock's own listing currency, INR for .NS/.BO and USD for US names. */
  currency: string;
  average_buy_price: number;
  current_price: number;
  current_value: number;
  pnl: number;
  pnl_percent: number;
  base_currency: string;
  fx_rate: number | null;
  current_value_base: number | null;
  cost_basis_base: number | null;
  pnl_base: number | null;
};

export type PortfolioSummary = {
  user_id: string;
  base_currency: string;
  cash_balance: number;
  total_portfolio_value: number;
  total_pnl: number;
  /** Tickers left out of the total because no FX rate was available. */
  unconverted: string[];
  positions: PositionSummary[];
};

export const fetchPortfolio = () => getJSON<PortfolioSummary>("/trading/portfolio");

export type Transaction = {
  ticker: string;
  action: "buy" | "sell";
  quantity: number;
  price: number;
  currency: string | null;
  fx_rate: number | null;
  base_currency: string | null;
  total_base: number | null;
  timestamp: string;
};

export const fetchTransactions = (limit = 50) =>
  getJSON<Transaction[]>(`/trading/transactions?limit=${limit}`);

export type TradeRequest = { ticker: string; action: "buy" | "sell"; quantity: number };

export const executeTrade = (trade: TradeRequest) =>
  postJSON<Transaction>("/trading/execute", trade);

/* ---- SCANNER ---- */

export type UniverseKey = "ALL" | "IN" | "NSE" | "BSE" | "US";

export type ScanCandidate = {
  symbol: string;
  market: MarketKey;
  currency: string;
  signals: string[];
  score: number;
  price: number | null;
  rsi: number | null;
  ema_20: number | null;
  ema_50: number | null;
  volume: number | null;
  volume_ratio: number | null;
};

export type TriageEntry = {
  symbol: string;
  rank: number;
  conviction: "HIGH" | "MEDIUM" | "LOW";
  thesis: string;
  invalidation: string;
  worth_deep_analysis: boolean;
};

/** Whether the universe came from live movers, the offline fallback list, or the caller. */
export type UniverseSource = "discovery" | "fallback" | "explicit";

export type ScanResult = {
  scanned: number;
  matched: number;
  market: string;
  universe_source?: UniverseSource;
  sessions: Record<MarketKey, MarketSession>;
  candidates: ScanCandidate[];
  triage?: { ranked: TriageEntry[]; summary: string; valid: boolean };
};

export const fetchScan = (limit = 10, triage = true, market: UniverseKey = "ALL") =>
  getJSON<ScanResult>(`/scanner/?limit=${limit}&triage=${triage}&market=${market}`);

/* ---- ADVISOR ---- */

export type AdvisorPosition = {
  ticker: string;
  quantity: number;
  currency: string | null;
  avg_buy_price: number;
  current_price: number;
  pnl: number;
  pnl_percent: number;
  weight_pct: number;
  bearish_signals: string[];
  bearish_score: number;
};

export type AdvisorSuggestion = {
  ticker: string;
  action: "HOLD" | "SELL" | "TRIM" | "ADD";
  urgency: "HIGH" | "MEDIUM" | "LOW";
  rationale: string;
  suggested_quantity: number;
};

export type AdvisorResult = {
  positions: AdvisorPosition[];
  suggestions: AdvisorSuggestion[];
  portfolio_summary: string;
  valid: boolean;
};

export const fetchAdvisorSuggestions = () => getJSON<AdvisorResult>("/advisor/suggestions");

/* ---- RECOMMENDATIONS ---- */

export type TechnicalLatest = {
  price: number | null;
  rsi: number | null;
  ema_20: number | null;
  ema_50: number | null;
  macd: number | null;
  adx: number | null;
};

export type RiskBlock = {
  volatility: number | null;
  beta: number | null;
  risk_level: string | null;
  benchmark?: string | null;
  /** True when high volatility or beta pulled confidence down from HIGH to MEDIUM. */
  confidence_capped?: boolean;
};

/** A lesson learned on a different ticker that was in a similar setup. */
export type CrossTickerLesson = { ticker: string | null; content: string };

export type LearningStatus =
  | "ok"
  | "no_lessons_yet"
  | "index_unavailable"
  | "index_degraded"
  | "unavailable"
  | "unknown";

export type PastRecommendation = {
  action: string;
  confidence: string;
  rationale: string | null;
  at: string;
};

export type RecommendationExplanation = {
  confidence: string;
  technical_reasons: string[];
  news_summary: string;
  news_sentiment: string;
  fundamental_analysis: {
    health_score: number | null;
    health_label: string | null;
    passed_checks: string[];
    failed_checks: string[];
  };
  debate_outcome: {
    decision: string;
    rationale: string | null;
    bull_case: string | null;
    bear_case: string | null;
    rounds?: number | null;
    converged?: boolean | null;
    decision_valid?: boolean;
  };
  evidence: Record<string, unknown>;
  risk?: RiskBlock;
  learned_context?: {
    prior_lessons: string[];
    cross_ticker_lessons?: CrossTickerLesson[];
    past_recommendations: PastRecommendation[];
    status?: LearningStatus;
  };
  routing?: {
    path: "debate" | "quick_decision";
    signal_votes: Record<string, number>;
    independent_votes?: Record<string, number>;
    unanimous: boolean;
    research_dissent?: boolean;
  };
};

export type Recommendation = {
  symbol: string;
  action: string;
  confidence: string;
  rationale: string | null;
  explanation: RecommendationExplanation;
  catalysts: string[];
  risks: string[];
};

export type StoredRecommendation = {
  id?: string;
  symbol: string;
  action: string;
  confidence: string;
  rationale: string | null;
  explanation: RecommendationExplanation;
  created_at: string;
};

export const fetchRecommendationHistory = (ticker?: string, limit = 20) =>
  getJSON<StoredRecommendation[]>(
    `/workflow/history?limit=${limit}${ticker ? `&ticker=${ticker.toUpperCase()}` : ""}`
  );

/* ---- REPORTS ---- */

/** One limiter's budget: requests and tokens are the last 60s, requests_today is the day. */
export type QuotaSnapshot = {
  requests: number;
  rpm: number;
  tokens: number;
  tpm: number;
  requests_today: number;
  rpd: number | null;
  day: string | null;
  /** When the daily budget rolls over, midnight US Pacific, as ISO. */
  resets_at: string | null;
};

export type QuotaResponse = { chat: QuotaSnapshot; embedding: QuotaSnapshot };

export const fetchQuota = () => getJSON<QuotaResponse>("/reports/quota");

/* Each report section is built in its own try/except, so any one can arrive as just { error }. */

export type RiskNarration = {
  summary: string;
  volatility_comment?: string;
  concentration_risks?: string[];
  suggestions?: string[];
  valid?: boolean;
  error?: string;
};

export type PortfolioRiskMetrics = {
  total_equity: number;
  volatility: number;
  beta: number | null;
  sharpe_ratio: number | null;
  annualized_return: number;
  risk_level: string;
};

export type ReportRiskPosition = {
  ticker: string;
  sector: string;
  weight: number;
  current_value: number;
  volatility: number;
  beta: number | null;
};

export type ReportRisk = {
  benchmark?: string;
  portfolio?: PortfolioRiskMetrics | null;
  positions?: ReportRiskPosition[];
  sector_exposure?: Record<string, number>;
  /** Set when the book is empty and there was nothing to analyse. */
  message?: string;
  analysis?: RiskNarration;
  error?: string;
};

export type AllocationNarration = {
  summary: string;
  diversification?: string;
  concentration_risks?: string[];
  notes?: string[];
  error?: string;
};

export type AllocationItem = {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  conviction: number;
  target_weight: number;
  shares: number;
  cost: number;
  actual_weight: number;
};

export type ReportAllocation = {
  capital?: number;
  invested?: number;
  cash_remaining?: number;
  invested_pct?: number;
  sector_exposure?: Record<string, number>;
  allocations?: AllocationItem[];
  analysis?: AllocationNarration;
  error?: string;
};

export type DailyReport = {
  id?: string;
  date: string;
  portfolio: (Partial<PortfolioSummary> & { error?: string }) | null;
  risk: ReportRisk | null;
  scan: (Partial<ScanResult> & { error?: string }) | null;
  allocation: ReportAllocation | null;
};

/** Spends two chat calls; throws on 409 (already running) and 429 (out of quota). */
export const generateDailyReport = () => postJSON<DailyReport>("/reports/daily", {});

export const fetchLatestReport = () => getJSON<DailyReport | null>("/reports/latest");

export const fetchRecentReports = (limit = 10) =>
  getJSON<DailyReport[]>(`/reports/recent?limit=${limit}`);

/* ---- MEMORY ---- */

export type MemoryEntry = {
  id?: string;
  type: string;
  ticker: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export const fetchRecentMemory = (type?: string, limit = 20) =>
  getJSON<MemoryEntry[]>(`/memory/recent?limit=${limit}${type ? `&type=${type}` : ""}`);

/** index_exists means the Atlas vector index answered; unindexed entries are invisible to search. */
export type MemoryHealth = {
  user_id: string;
  status: LearningStatus;
  counts: Record<string, number>;
  index_exists: boolean;
  unindexed_entries: number;
};

export const fetchMemoryHealth = () => getJSON<MemoryHealth>("/memory/health");

/* ---- STREAMING ---- */

export type DebateArgument = {
  stance: "BULL" | "BEAR";
  arguments?: string[];
  rebuttals?: string[];
  key_point?: string;
  has_new_points?: boolean;
  concede?: boolean;
};

export type DebateDecision = {
  decision: string;
  confidence: string;
  rationale: string | null;
  bull_summary?: string;
  bear_summary?: string;
  key_catalysts?: string[];
  key_risks?: string[];
};

export type DebateMemory = {
  prior_lessons: string[];
  cross_ticker_lessons?: CrossTickerLesson[];
  past_recommendations: PastRecommendation[];
  status?: LearningStatus;
};

export type DebateEvent =
  | { type: "status"; phase: string; message: string }
  | { type: "memory"; memory: DebateMemory }
  | { type: "opening"; round: number; bull: DebateArgument; bear: DebateArgument }
  | {
      type: "rebuttal";
      round: number;
      bull: DebateArgument;
      bear: DebateArgument;
      converged: boolean;
    }
  | { type: "decision"; model: string | null; decision: DebateDecision; decision_valid?: boolean }
  | { type: "done"; symbol: string }
  | { type: "error"; message: string };

// fetch, not EventSource: EventSource cannot send headers, so the token would land in access logs.
async function consumeSSE<T>(
  path: string,
  onEvent: (ev: T) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { Accept: "text/event-stream", ...authHeader() },
    signal,
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("Your session expired. Sign in again.");
  }
  if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // SSE wire format: events separated by a blank line, payload on the data: lines.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as T);
      } catch {
        // keep-alive and comment lines are not JSON
      }
    }
  }
}

/** Stream a live bull-versus-bear committee debate. */
export function streamDebate(
  ticker: string,
  opts: { news?: boolean; rounds?: number },
  onEvent: (ev: DebateEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    news: String(opts.news ?? true),
    rounds: String(opts.rounds ?? 2),
  });
  return consumeSSE<DebateEvent>(
    `/debate/${ticker.toUpperCase()}/stream?${params}`,
    onEvent,
    signal
  );
}

// Five gathering nodes run in parallel, then recall and research run on their output before the gate.
export type WorkflowNode =
  | "profile"
  | "technical"
  | "fundamental"
  | "news"
  | "risk"
  | "recall"
  | "research";

export type Consensus = {
  votes: Record<string, number>;
  independent_votes: Record<string, number>;
  /** Voters with no opinion; an abstention alone is enough to force the committee. */
  abstained?: string[];
  score: number;
  signals: number;
  unanimous: boolean;
  research_dissent: boolean;
  /** A high-volatility or high-beta name never takes the fast path. */
  risk_veto: boolean;
  /** Gathering nodes that failed, which also blocks the fast path. */
  incomplete: string[];
  route: "quick" | "debate";
  action: string | null;
  confidence: string | null;
};

export type WorkflowEvent =
  | { type: "status"; message: string }
  | {
      type: "node";
      node: WorkflowNode;
      status: "running" | "done" | "error";
      data?: Record<string, unknown>;
      warnings?: string[];
    }
  | { type: "routing"; consensus: Consensus }
  | { type: "quick_decision"; decision: DebateDecision; memory: DebateMemory }
  | { type: "debate_start" }
  | { type: "debate"; event: DebateEvent }
  | { type: "recommendation"; recommendation: Recommendation }
  | { type: "warn"; message: string }
  | { type: "done"; symbol: string; errors?: string[] }
  | { type: "error"; message: string };

/** fresh=true starts a new thread instead of resuming today's checkpoint for this ticker. */
export function streamWorkflow(
  ticker: string,
  opts: { news?: boolean; rounds?: number; fresh?: boolean },
  onEvent: (ev: WorkflowEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    news: String(opts.news ?? true),
    rounds: String(opts.rounds ?? 2),
    fresh: String(opts.fresh ?? false),
  });
  return consumeSSE<WorkflowEvent>(
    `/workflow/${ticker.toUpperCase()}/stream?${params}`,
    onEvent,
    signal
  );
}

/* ---- AUTH ---- */

export type AuthUser = { id: string; email: string };

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
};

export const login = (email: string, password: string) =>
  postJSON<TokenResponse>("/auth/login", { email, password });

export const register = (email: string, password: string) =>
  postJSON<TokenResponse>("/auth/register", { email, password });

/** Validates a stored token on boot; the interceptor clears it if the server says no. */
export const fetchMe = () => getJSON<AuthUser>("/auth/me");

export const changePassword = (current_password: string, new_password: string) =>
  postJSON<void>("/auth/change-password", { current_password, new_password });
