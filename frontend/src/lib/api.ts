import axios, { AxiosError } from "axios";

// The FastAPI backend. Everything the UI needs comes through here.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const client = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

// Surface the backend's error detail as a plain Error message.
client.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ detail?: string }>) => {
    const detail = error.response?.data?.detail;
    const status = error.response?.status;
    throw new Error(detail ?? error.message ?? `Request failed${status ? `: ${status}` : ""}`);
  }
);

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

/* ---- PORTFOLIO / TRADING ---- */

export type PositionSummary = {
  ticker: string;
  quantity: number;
  /** The stock's own listing currency — "INR" for .NS/.BO, "USD" for US. */
  currency: string;
  average_buy_price: number;
  current_price: number;
  current_value: number;
  pnl: number;
  pnl_percent: number;
  /** Denominated in base_currency; null when the FX lookup failed. */
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
  /** Tickers excluded from the total because no FX rate was available. */
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

/** Universe selector accepted by the scanner. */
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

/** Where the scanned universe came from: live movers, the offline fallback list, or caller-supplied. */
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

/* ---- PORTFOLIO ADVISOR ---- */

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

/* ---- WORKFLOW / EXPLAINABLE RECOMMENDATION ---- */

export type TechnicalLatest = {
  price: number | null;
  rsi: number | null;
  ema_20: number | null;
  ema_50: number | null;
  macd: number | null;
  adx: number | null;
};

/** Per-ticker risk block (volatility %, beta vs its market index, and the level). */
export type RiskBlock = {
  volatility: number | null;
  beta: number | null;
  risk_level: string | null; // LOW | MODERATE | HIGH | UNKNOWN
  benchmark?: string | null;
  /** True when high vol/beta pulled confidence down from HIGH to MEDIUM. */
  confidence_capped?: boolean;
};

/** A lesson learned on a DIFFERENT ticker that was in a similar setup. */
export type CrossTickerLesson = { ticker: string | null; content: string };

/** Why the lesson lists look the way they do — see the backend's _lesson_status. */
export type LearningStatus =
  | "ok"
  | "no_lessons_yet"
  | "index_unavailable"
  | "index_degraded"
  | "unavailable"
  | "unknown";

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

export type PastRecommendation = {
  action: string;
  confidence: string;
  rationale: string | null;
  at: string;
};

export type Recommendation = {
  symbol: string;
  action: string; // BUY | HOLD | SELL
  confidence: string; // LOW | MEDIUM | HIGH
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

/* ---- SCHEDULER ---- */

export type SchedulerJob = { id: string; next_run: string | null };

export type SchedulerStatus = {
  running: boolean;
  timezone: string;
  sessions: Record<MarketKey, MarketSession>;
  last_runs: Record<string, Record<string, unknown>>;
};

export const fetchSchedulerJobs = () => getJSON<SchedulerJob[]>("/scheduler/jobs");
export const fetchSchedulerStatus = () => getJSON<SchedulerStatus>("/scheduler/status");
export const runSchedulerJob = (jobId: string) =>
  postJSON<Record<string, unknown>>(`/scheduler/run/${jobId}`, {});

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

/** Is the learning loop alive? Compares Mongo counts against the FAISS index. */
export type MemoryHealth = {
  user_id: string;
  status: LearningStatus;
  counts: Record<string, number>;
  index_exists: boolean;
  unindexed_entries: number;
};

export const fetchMemoryHealth = () => getJSON<MemoryHealth>("/memory/health");

/* ---- STREAMING (Server-Sent Events) ---- */

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

// Events from GET /debate/{ticker}/stream.
export type DebateEvent =
  | { type: "status"; phase: string; message: string }
  | { type: "memory"; memory: DebateMemory }
  | { type: "opening"; round: number; bull: DebateArgument; bear: DebateArgument }
  | { type: "rebuttal"; round: number; bull: DebateArgument; bear: DebateArgument; converged: boolean }
  | { type: "decision"; model: string | null; decision: DebateDecision; decision_valid?: boolean }
  | { type: "done"; symbol: string }
  | { type: "error"; message: string };

// Read a Server-Sent Events stream, calling onEvent for each parsed payload.
async function consumeSSE<T>(
  path: string,
  onEvent: (ev: T) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // SSE wire format: events separated by a blank line, payload on `data:` lines.
  while (true) {
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
        // ignore malformed keep-alive/comment lines
      }
    }
  }
}

/** Stream a live Bull-vs-Bear committee debate. */
export function streamDebate(
  ticker: string,
  opts: { news?: boolean; rounds?: number },
  onEvent: (ev: DebateEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    news: String(opts.news ?? false),
    rounds: String(opts.rounds ?? 2),
  });
  return consumeSSE<DebateEvent>(`/debate/${ticker.toUpperCase()}/stream?${params}`, onEvent, signal);
}

/* ---- STREAMING WORKFLOW (full analysis pipeline) ---- */

// The five data-gathering nodes that run in parallel before the routing gate.
export type WorkflowNode = "research" | "technical" | "fundamental" | "news" | "risk";

export type Consensus = {
  votes: Record<string, number>;
  independent_votes: Record<string, number>;
  score: number;
  signals: number;
  unanimous: boolean;
  research_dissent: boolean;
  route: "quick" | "debate";
  action: string | null;
  confidence: string | null;
};

// Events from GET /workflow/{ticker}/stream.
export type WorkflowEvent =
  | { type: "status"; message: string }
  | {
      type: "node";
      node: WorkflowNode;
      status: "running" | "done" | "error";
      data?: Record<string, unknown>;
      error?: string[];
    }
  | { type: "routing"; consensus: Consensus }
  | { type: "quick_decision"; decision: DebateDecision; memory: DebateMemory }
  | { type: "debate_start" }
  | { type: "debate"; event: DebateEvent }
  | { type: "recommendation"; recommendation: Recommendation }
  | { type: "warn"; message: string }
  | { type: "done"; symbol: string; errors?: string[] }
  | { type: "error"; message: string };

/** Stream the full analysis pipeline (data-gathering → routing → debate → recommendation). */
export function streamWorkflow(
  ticker: string,
  opts: { news?: boolean; rounds?: number },
  onEvent: (ev: WorkflowEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const params = new URLSearchParams({
    news: String(opts.news ?? false),
    rounds: String(opts.rounds ?? 2),
  });
  return consumeSSE<WorkflowEvent>(`/workflow/${ticker.toUpperCase()}/stream?${params}`, onEvent, signal);
}
