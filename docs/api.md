# API and accounts

Every endpoint, and how authentication and account scoping work.

## API reference

Everything is under `/api`. Interactive docs are at `/docs`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | — | Create an account and its opening book (403 if `ALLOW_REGISTRATION=false`, 409 on duplicate email) |
| POST | `/auth/login` | — | Exchange email + password for a bearer token |
| GET | `/auth/me` | ✓ | Validate a stored token |
| POST | `/auth/change-password` | ✓ | Change password (204) |
| GET | `/health` | — | Uptime and Mongo connectivity |
| GET | `/market/sessions` | ✓ | Open/closed state per market |
| GET | `/market/search?q=` | ✓ | Symbol search |
| GET | `/market/info/{ticker}` | ✓ | Quote and profile |
| GET | `/market/history/{ticker}` | ✓ | OHLCV (`period`, `interval`) |
| WS | `/live` | ✓ subprotocol | Live ticks for one subscribed symbol |
| GET | `/scanner/` | ✓ | Discover, scan and (with `triage=true`) rank a market (`market=ALL\|IN\|NSE\|BSE\|US`) |
| GET | `/workflow/{ticker}/stream` | ✓ | Full analysis over SSE (`news`, `rounds`, `fresh`) |
| GET | `/workflow/{ticker}` | ✓ | Full analysis, non-streaming |
| GET | `/workflow/history` | ✓ | Past recommendations (`ticker`, `limit`) |
| GET | `/debate/{ticker}/stream` | ✓ | Standalone committee debate over SSE |
| GET | `/advisor/suggestions` | ✓ | One suggested action per held position |
| GET | `/trading/portfolio` | ✓ | Book summary with native and base-currency values |
| POST | `/trading/execute` | ✓ | Paper BUY / SELL (`{ticker, action, quantity}`) |
| GET | `/trading/transactions` | ✓ | Trade history |
| GET | `/memory/recent` | ✓ | Recent memories (read-only; only agents write) |
| GET | `/memory/health` | ✓ | Learning-loop status |
| GET | `/reports/quota` | ✓ | Chat and embedding budgets |
| POST | `/reports/daily` | ✓ | Build the caller's daily report |
| GET | `/reports/latest`, `/reports/recent` | ✓ | Stored reports |

## Accounts

Every book, lesson, memory and past recommendation belongs to one account. The API
carries no ambient identity: `user_id` comes from the bearer token and nothing else,
so there is no code path that reads or writes another user's data.

- Registration creates the opening paper book in the same request, so a fresh
  account's first portfolio read isn't a special case.
- Passwords are bcrypt-hashed after a base64-encoded SHA-256 pre-hash, since bcrypt
  ignores anything past 72 bytes and truncates at NUL.
- Sessions are HS256 JWTs signed with `JWT_SECRET`, valid for
  `ACCESS_TOKEN_TTL_MINUTES` (7 days). There are no refresh tokens.
- A missing token is a `401` with `WWW-Authenticate: Bearer`, not a `403`.

Two consequences worth knowing:

- **There is no token revocation.** Changing a password stops future logins with the
  old one but doesn't invalidate tokens already issued. Deactivating a user
  (`is_active=false`) *does* take effect immediately on HTTP routes, since every
  request re-reads the account. The live-price socket only verifies the JWT.
- **The daily report is per-caller** and only ever user-triggered, so nothing spends
  model quota unattended.

The browser keeps its token in `localStorage` rather than an httpOnly cookie, because
the frontend and API sit on different origins and cookies would have to be
`SameSite=None`. That trades CSRF exposure for XSS exposure — the right call for a
paper-trading app holding no money and no PII, and worth revisiting if that changes.
For the same reason no credential ever goes in a URL: SSE is read with `fetch`, and
the WebSocket sends its token as a subprotocol (`bearer, <jwt>`).
