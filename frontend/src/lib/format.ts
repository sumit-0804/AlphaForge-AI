const SYMBOL: Record<string, string> = { INR: "\u20b9", USD: "$", EUR: "\u20ac", GBP: "\u00a3" };

export function currencySymbol(code?: string | null): string {
  if (!code) return "";
  return SYMBOL[code] ?? `${code} `;
}

// Indian listings are quoted in lakhs and crores, so let the locale decide the grouping.
function localeFor(code?: string | null): string {
  return code === "INR" ? "en-IN" : "en-US";
}

// Paise on a five-figure total is noise, so decimals only survive while they still carry meaning.
function decimalsFor(value: number): number {
  return Math.abs(value) >= 1000 ? 0 : 2;
}

export function money(value: number | null | undefined, code?: string | null, decimals?: number): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  const places = decimals ?? decimalsFor(value);
  const n = value.toLocaleString(localeFor(code), {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  return `${currencySymbol(code)}${n}`;
}

export function signedMoney(value: number | null | undefined, code?: string | null): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return `${value < 0 ? "\u2212" : "+"}${money(Math.abs(value), code)}`;
}

export function percent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return `${value.toFixed(decimals)}%`;
}

export function signedPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return `${value < 0 ? "\u2212" : "+"}${Math.abs(value).toFixed(decimals)}%`;
}

export function num(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "\u2014";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

const UNITS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [3600, "minute"],
  [86400, "hour"],
  [604800, "day"],
];

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = (Date.now() - then) / 1000;
  if (secs < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (let i = 0; i < UNITS.length; i++) {
    const [limit, unit] = UNITS[i];
    if (secs < limit) {
      const divisor = i === 0 ? 1 : UNITS[i - 1][0];
      return rtf.format(-Math.round(secs / divisor), unit);
    }
  }
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dayAndTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Sentence-case a backend enum without touching acronyms the agents emit as words.
export function sentence(value: string | null | undefined): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

export function tickerName(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/i, "");
}
