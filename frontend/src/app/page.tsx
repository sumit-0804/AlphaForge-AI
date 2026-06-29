import { fetchHealth } from "@/lib/api";

export default async function HomePage() {
  let health: Awaited<ReturnType<typeof fetchHealth>> | null = null;
  let error: string | null = null;

  try {
    health = await fetchHealth();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">AlphaForge AI</h1>
      <p className="text-muted-foreground text-sm">
        Autonomous Investment Research & Paper Trading
      </p>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          Backend unreachable: {error}
        </div>
      )}

      {health && (
        <div className="rounded-md border px-4 py-3 text-sm space-y-1">
          <p>
            <span className="font-medium">API:</span> {health.status}
          </p>
          <p>
            <span className="font-medium">MongoDB:</span> {health.mongodb}
          </p>
          <p>
            <span className="font-medium">Env:</span> {health.environment}
          </p>
        </div>
      )}
    </main>
  );
}