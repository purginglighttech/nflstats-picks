# Auth library (`src/lib/auth/`)

Server-only modules implementing the Phase-1 identity workstream. Nothing
here may be imported from client components.

## Modules

| File | Owns |
|---|---|
| `password.ts` | argon2id hashing (`hashPassword`) / verification (`verifyPassword`); `verifyAgainstDummy()` for enumeration-safe sign-in timing |
| `tokens.ts` | 32-byte random token generation, SHA-256 storage hashing, `timingSafeEqual` comparison |
| `cookies.ts` | Session cookie: `pl_session`, httpOnly, `SameSite=Lax`, `Secure` when `APP_URL` is https, `Path=/`, 30-day Max-Age |
| `session.ts` | Session lifecycle against `sessions(id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at)` — create / rotate / revoke / validate with sliding 30-day refresh |
| `users.ts` | Identity store against `users` + `profiles` (display name lives in `profiles`, UNIQUE), verification tokens (24h) and reset tokens (1h, single-use) |
| `me-store.ts` | `user_settings`, `team_follows` (abbreviation ↔ uuid resolution), `notification_preferences`, `push_devices` (tokens write-only) |
| `email.ts` | `EmailSender` interface + Phase-1 dev-outbox sender |

Database tables are owned by sibling B (`app/db/migrations/`); the exact
column contracts are repeated in each module's header comment. Column names
here are verbatim from `001_core.sql` / `002_competition.sql` /
`004_notifications.sql` — do not rename on one side without coordinating.

## Session model

- The cookie carries the raw token; the DB stores only its SHA-256 hash.
- Sessions rotate after authentication (sign-in, register, email verify when
  a session exists) and after sensitive changes (password reset revokes **all**
  sessions, then issues a fresh one).
- Sliding refresh: every validated request bumps `last_seen_at`; when fewer
  than 15 days of life remain, `expires_at` extends another 30 days.
- `validateSessionToken()` returns null for unknown / expired / revoked tokens.

## Account-enumeration protection

`register`, `signin`, and `forgot-password` always return the identical
success-shaped response (and padded timing via `ensureMinLatency()` plus a
dummy argon2 verify for unknown emails). `signin` failures are a single
`invalid_credentials` 401 whether the email is unknown or the password is
wrong. Display-name conflicts are the one deliberate exception: a taken
display name returns 409 `display_name_taken`, which reveals nothing about
email-account existence.

## Email delivery (Phase 1: dev outbox)

`getEmailSender()` currently returns `DevOutboxEmailSender`, which writes
each verification/reset link to `apps/web/.dev-outbox/` (gitignored — see
`apps/web/.gitignore`) and echoes it to the console in non-production.

**Plugging in a real provider later** (no route changes needed):

1. Implement `EmailSender` (`sendVerificationEmail`, `sendPasswordResetEmail`)
   against the chosen SMTP/API provider.
2. In `email.ts`, select it from env (e.g. `SMTP_HOST` present → SMTP sender,
   else dev outbox) inside `getEmailSender()`.
3. Keep secrets in the hosting platform's protected store — never in code,
   logs, or the repo. Never log token values or email bodies.

## Rate limiting

`withApi` enforces per-IP + route token buckets on the auth endpoints
(budgets live in `@pickem/contracts`' `ROUTES_V1`). The buckets are
in-process memory: fine for Phase 1, replaced by a shared limiter when
horizontal scale arrives.

## CSRF

Phase 1 relies on `SameSite=Lax` session cookies plus JSON-only state-changing
APIs (native HTML forms can't produce `application/json` bodies), which
blocks the classic cross-site form POST. A synchronizer token can be added
if a cookie-authenticated non-JSON mutation surface ever appears.

## Verified-email gate

`requireVerified()` (in `src/lib/api/with-api.ts`) is exported for Phase 3+
(picks affecting standings, forum access). It is deliberately **not**
enforced by any Phase-1 route.
