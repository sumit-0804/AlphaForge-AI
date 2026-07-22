/* ---------- money ----------
 * Every amount belongs to a currency, so `code` is required at the call site —
 * a defaulted "USD" is what let ₹ positions render as dollars.
 */

// INR reads naturally with lakh/crore grouping (₹1,23,456); others keep en-US.
const localeFor = (code: string) => (code === "INR" ? "en-IN" : "en-US");

export const currency = (n: number | null | undefined, code: string) => {
  if (n == null) return "—";
  if (!code) return number(n);
  try {
    return n.toLocaleString(localeFor(code), { style: "currency", currency: code });
  } catch {
    // Unknown/non-ISO code — show the number with the code appended, don't throw.
    return `${number(n)} ${code}`;
  }
};

export const number = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");

export const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const compact = (n: number | null | undefined, code?: string) => {
  if (n == null) return "—";
  return Intl.NumberFormat(code ? localeFor(code) : "en-US", {
    notation: "compact",
    ...(code ? { style: "currency", currency: code } : {}),
  }).format(n);
};

// Green for gains, red for losses — the semantic money colours, not the brand accent.
export const pnlClass = (n: number | null | undefined) =>
  n == null || n === 0 ? "text-muted-foreground" : n > 0 ? "text-positive" : "text-negative";

/* ---------- time ----------
 * The API sends UTC instants with an explicit offset, so `new Date(iso)` resolves
 * them unambiguously and toLocale* renders in the viewer's own timezone.
 */

/** The viewer's IANA timezone, e.g. "Asia/Calcutta". */
export const localTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";

/** The viewer's current UTC offset, e.g. "+05:30". */
export function localOffset(at: Date = new Date()): string {
  // getTimezoneOffset is minutes BEHIND UTC, so invert the sign.
  const mins = -at.getTimezoneOffset();
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** "Asia/Calcutta (+05:30)" — for labelling a column of timestamps. */
export const localTimeZoneLabel = (): string => `${localTimeZone()} (${localOffset()})`;

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function timeOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Renders an instant in a SPECIFIC market's timezone, e.g. NSE local time. */
export function inTimeZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleString([], { timeZone, hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toLocaleString();
  }
}
