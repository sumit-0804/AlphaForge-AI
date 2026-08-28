// The token lives outside React so the axios interceptor and the socket can both read it synchronously.
// localStorage rather than an httpOnly cookie because the UI and API sit on different origins.

const TOKEN_KEY = "alphaforge.token";

type Listener = () => void;
const listeners = new Set<Listener>();

let cached: string | null = null;
let loaded = false;

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  if (!loaded) {
    cached = window.localStorage.getItem(TOKEN_KEY);
    loaded = true;
  }
  return cached;
}

export function setToken(token: string): void {
  cached = token;
  loaded = true;
  window.localStorage.setItem(TOKEN_KEY, token);
  listeners.forEach((fn) => fn());
}

export function clearToken(): void {
  cached = null;
  loaded = true;
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
  listeners.forEach((fn) => fn());
}

// Fires on the interceptor's mid-session clear too, which is how an expired session reaches the UI.
export function onTokenChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
