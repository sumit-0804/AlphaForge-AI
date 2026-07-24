// The session token, kept outside React so the axios interceptor and the SSE
// reader can both read it synchronously on every request.
//
// It lives in localStorage rather than an httpOnly cookie because the frontend and
// API are on different origins (Vercel vs. the API host), which would force
// SameSite=None cross-site cookies. The tradeoff is that any XSS on this page can
// read the token — acceptable for a paper-trading app with no real money or PII,
// and worth revisiting if that ever changes.

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

/** Notified when the token is set or cleared — including by the 401 interceptor,
 *  which is how an expired session propagates to the UI without a page reload. */
export function onTokenChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
