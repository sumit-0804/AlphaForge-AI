import { StockScreen } from "@/components/stock-screen";

// params arrives as a Promise in this version of Next, so the screen itself stays a client component.
export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <StockScreen ticker={decodeURIComponent(symbol).toUpperCase()} />;
}
