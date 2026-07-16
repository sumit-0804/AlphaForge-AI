export const currency = (n: number | null | undefined, code: string = "USD") =>
    n == null ? "-" : n.toLocaleString("en-US", { style: "currency", currency: code });

export const number = (n: number | null | undefined) =>
    n == null ? "-" : n.toLocaleString("en-US")

export const percent = (n: number | null | undefined) => n==null ? "-" : `${ n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const compact = (n: number | null | undefined) => 
    n== null ? "-" : Intl.NumberFormat("en-US",{ notation: "compact"}).format(n);

export const pnlClass = (n: number) =>
    n>0 ? "text-emerald-600" : n<0 ? "text-red-600" : "text-muted-foreground";

/* ---------- time ----------
 * Everything is rendered in the VIEWER's timezone. The API sends UTC instants
 * with an explicit offset, so `new Date(iso)` resolves them unambiguously and
 * toLocale* renders wherever the browser actually is — +05:30 in India, and
 * correct elsewhere without any per-region code.
 */

/** The viewer's IANA timezone, e.g. "Asia/Calcutta". */
export const localTimeZone = (): string =>
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";

/** The viewer's current UTC offset, e.g. "+05:30". */
export function localOffset(at: Date = new Date()): string {
    // getTimezoneOffset is minutes BEHIND UTC, so the sign is inverted.
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
