import axios, { AxiosError } from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const client = axios.create({
    baseURL: `${API_URL}/api`,
    headers: { "Content-Type": "application/json" },
});

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

export type HealthResponse = {
    status: string;
    service: string;
    environment:string,
    mongodb:string;
    timestamp:string;
}

export const fetchHealth = () => getJSON<HealthResponse>("/health")

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
}

export const fetchStockInfo = (ticker: string) => {
    return getJSON<StockInfo>(`/market/info/${ticker.toUpperCase()}`);
}

export type Candle = {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export const fetchHistory = (ticker: string, period="1mo", interval="1d")=>{
    client.get<Candle[]>(`/market/history/${ticker.toUpperCase()}`, {
        params: {period, interval}
    }). then((res)=> res.data);
}

export type PositionSummary = {
    ticker:string;
    quantity: string;
    average_buy_price: number;
    current_price : number;
    current_value: number;
    pnl: number;
    pnl_percent: number;
}
export type PortfolioSummary= {
    user_id: string;
    cash_balance: number;
    total_portfolio_value: number;
    total_pnl: number;
    positions: PositionSummary[];
}

export const fetchPortfolio = () =>{
    return getJSON<PortfolioSummary>("/trading/portfolio");
}

export type Transaction = {
    ticker: string;
    action: "buy" | "sell";
    quantity: number;
    price: number;
    timestamp: string;
}

export const fetchTransactions = (limit = 50) =>{
    return getJSON<Transaction[]>(`/trading/transactions?limit=${limit}`)
}

export type TradeRequest ={
    ticker: string;
    action: "buy" | "sell";
    quantity: number;
}

export const executeTrade = (trade: TradeRequest)=>{
    return postJSON<Transaction>("/trading/execute", trade);
}