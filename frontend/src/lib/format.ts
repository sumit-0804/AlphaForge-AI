export const currency = (n: number | null | undefined) => n==null ? "-" : n.toLocaleString("en-US", {style: "currency", currency:"USD"});

export const number = (n: number | null | undefined) =>
    n == null ? "-" : n.toLocaleString("en-US")

export const percent = (n: number | null | undefined) => n==null ? "-" : `${ n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const compact = (n: number | null | undefined) => 
    n== null ? "-" : Intl.NumberFormat("en-US",{ notation: "compact"}).format(n);

export const pnlClass = (n: number) =>
    n>0 ? "text-emerald-600" : n<0 ? "text-red-600" : "text-muted-foreground";
