# Donutcash

Donutcash is a self-hosted **casino for DonutSMP money**, with a player lobby, six server-authoritative games, a support desk, and an administration console.

> **Built for DonutSMP.** Balances are tracked in DonutSMP money. The cashier is the single place to deposit money into the game or withdraw it again; owners and administrators review every request.

## What is included

- **Players** — registration with email verification, wallet and ledger history, six games, daily/streak rewards, support tickets, cashier requests, notifications, and profile settings.
- **Rewards** — a manual daily claim with configurable reset timezone, an increasing streak, milestone bonuses, grace-day handling, claim history, and a countdown to the next reset.
- **Games** — Coinflip, Mines, Blackjack, Roulette, Towers, and Plinko. Wagers, randomness, outcomes, and payouts are settled by the server; animations only reveal settled results.
- **Cashier** — the only place for DonutSMP money requests: amount-only deposit and withdrawal requests with a conversation thread and owner/admin decisions.
- **Support desk** — ticket queue, assignment, internal notes, replies, status and priority workflow, and staff activity views. Money requests are not accepted in tickets.
- **Administration** — user and role management, wallet adjustments, ticket oversight, game configuration, reward configuration, email settings and delivery log, platform settings, announcements, and an audit log.
- **Email** — queued Brevo SMTP delivery with responsive HTML + plain-text templates, retries, and per-user notification preferences.
- **Maintenance mode** — a platform-wide pause for players, enforced by both the UI and the API, with staff access preserved.
- **Legal and consent** — English and Dutch Terms, Privacy Policy, and Responsible Gambling pages, versioned acceptance with timestamp and IP, a re-acceptance gate, footer disclaimer, and irreversible self-exclusion.

## Stack

| Layer | Technology |
| --- | --- |
| Client | React 19, React Router 7, Vite 6, Tailwind CSS 4 |
| Server | Node.js 22, Express 5, Zod |
| Database | SQLite via `better-sqlite3`, WAL mode |
| Auth | Opaque httpOnly session cookies, scrypt password hashing |
| Tests | Vitest, Supertest, temporary SQLite databases |

TypeScript is shared between the client, server, and tests through [`shared/types.ts`](shared/types.ts).

## Requirements

- Node.js **22 or newer**
- npm
- A persistent filesystem for the SQLite database

## Quick start

```bash
npm install
cp .env.example .env
```

For local development, set a session secret in `.env`. A random value can be generated with:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Create the first owner account. The server creates the database, applies migrations, and seeds the games and support categories on first boot.

```bash
npm run owner -- --email you@example.com --username owner
```

If `--password` is omitted, a strong temporary password is printed **once**. Store it securely and change it after signing in.

Start the development servers:

```bash
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000>
- Vite proxies `/api` to the API.

The default `.env.example` grants 5,000,000 DonutSMP money to each new account. Change `STARTING_CREDITS` before creating accounts if you want a different welcome grant.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and Vite together |
| `npm run dev:api` | Run only the API with file watching |
| `npm run dev:web` | Run only the Vite client |
| `npm run typecheck` | Type-check the whole repository |
| `npm test` | Run the integration test suite once |
| `npm run test:watch` | Run tests in watch mode | | `npm run build` | Type-check and build the client into `dist/` |
| `npm start` | Start the production server |
| `npm run db:migrate` | Create/migrate the database and print schema status |
| `npm run db:backup -- --out data/backups` | Take an online SQLite backup and verify it |
| `npm run owner -- --email …` | Bootstrap an owner account |

## Configuration

Configuration lives in `.env`. The server loads it on startup, and environment variables already set by the process take precedence.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | API/production server port |
| `APP_NAME` | `Donutcash` | Initial platform name seed |
| `APP_URL` | `http://localhost:5173` | Public client origin. In production this is the only allowed mutation origin and is used in reset links. Set it to the exact external URL. |
| `DATABASE_PATH` | `data/aurum.db` | SQLite file. Parent directories are created automatically. |
| `SESSION_SECRET` | empty | At least 32 characters in production; startup fails closed otherwise. |
| `SESSION_DAYS` | `7` | Session lifetime |
| `STARTING_CREDITS` | `5000000` | Initial DonutSMP money grant |
| `EXPOSE_RESET_TOKEN` | development only | Returns reset paths in the API response for local testing. Keep `false` in production. |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Optional fallback SMTP host. Admin → Email settings overrides it. |
| `SMTP_PORT` | `587` | STARTTLS port. |
| `SMTP_USER` | empty | Brevo SMTP login, for example `c05ccf001@smtp-brevo.com`. |
| `SMTP_PASS` | empty | Brevo SMTP key. Prefer saving it in Admin → Email settings; never commit it. |
| `SMTP_FROM` | `Donutcash <no-reply@example.com>` | Sender identity. Use a domain authenticated in Brevo. |
| `EMAIL_ENCRYPTION_KEY` | `SESSION_SECRET` | Stable secret used to encrypt the SMTP key saved from the admin panel. Set a separate value in production. |

Platform name, tagline, registration, maintenance, support categories, game limits, economy limits, reward rules, and email delivery are stored in the database and managed from the admin panel. The `economy.cashier_request_limit` setting is the maximum amount for a single cashier deposit or withdrawal request.

### Rewards and streaks

Open **Admin → Rewards** to enable the page, choose the reset hour and IANA timezone, set the base amount, per-day increase, maximum amount, optional milestone bonuses, and the missed-day policy (reset immediately or allow grace days). Every change is validated and written to the audit log.

Players claim from **Rewards** once per reward day. The claim is settled in a single database transaction with a unique `(user, day)` constraint, so double-clicks, multiple tabs, and parallel requests cannot pay twice. Claim history and the current streak are stored server-side.

### Email

Email is optional and disabled until an owner enables it in **Admin → Email**. The panel holds the SMTP host, port, login, SMTP key, sender name/address, and a test-send button. The key is encrypted with AES-256-GCM at rest and is never returned to the browser or written to logs.

The preconfigured Brevo relay is `smtp-relay.brevo.com:587` (STARTTLS) with login `c05ccf001@smtp-brevo.com`. Add the SMTP key in the admin panel, set a sender on a domain verified in Brevo, enable delivery, then send a test email. Delivery is queued in SQLite with exponential retries and an admin-visible delivery log; a mail failure never blocks registration, rewards, cashier decisions, or sign-in.

Templates cover welcome, email verification, password reset, password/email changes, new sign-ins, cashier decisions, daily rewards, and staff announcements. Each message has an HTML version and a plain-text fallback, with notification preferences linked in the footer.

## Cashier: DonutSMP money in and out

The Cashier is deliberately separate from support tickets. It is for one thing only: a player asks to add DonutSMP money (**deposit**) or remove DonutSMP money (**withdrawal**). Amounts accept K, M, B, and T shorthand, so `100k` means 100,000, `2.5M` means 2,500,000, and `1T` means 1,000,000,000,000.

- The form asks for a direction and an amount. There is no subject or description field.
- A withdrawal cannot exceed the player's current balance or the configured per-request limit. The balance is checked again at approval time.
- Owners and administrators review the queue at **Admin panel → Cashier requests**.
- Approval writes an append-only ledger entry and changes the wallet immediately. Rejection requires a short reason.
- Deposits use the `credit_request` ledger type; withdrawals use `admin_adjustment`. Both carry the cashier reference and request metadata.
- Players and administrators can exchange public messages inside a request. Players may cancel a request while it is pending.
- Only `owner` and `admin` roles hold `credits.adjust`, the permission required to decide a cashier request. Support staff cannot approve these requests.
- Creating a cashier request is blocked during maintenance, while administrators can still review existing requests.

### One place for money requests

Tickets no longer accept money requests, grant money, or adjust balances. Every new money request must use the Cashier. The legacy ticket category is archived and cannot be selected, re-enabled, or created through the API; pending and historical ticket money requests remain visible inside their original tickets as read-only records with an explicit archived notice. No legacy pending request can be approved after the migration, and no dashboard or notification tells staff to review one.

Deposits and withdrawals are settled in DonutSMP money only. Every approval writes an append-only ledger entry and the balance changes immediately.

## Games and active rounds

- Every wager is settled by the server before the client animates it, so a wheel, ball, or coin can never disagree with the payout.
- A player can hold only **one active bet** across all games. Starting a second round returns `ACTIVE_ROUND` (“Finish your current game first.”) until the current round is finished or its result is cleared.
- Coinflip, roulette, and plinko are settled immediately. If the player reloads or navigates away before the animation ends, the result is restored from the server. The slot opens when they acknowledge it, or after five minutes so a closed tab cannot lock them out.
- Mines, towers, and blackjack resume the exact active round, including hidden state, instead of losing or duplicating the wager.
- Acknowledging an unfinished round is rejected; only a settled result can release the slot early.
- Unfinished sessions from databases created before the lock existed are adopted on the next active-round load or wager attempt, so legacy rounds cannot be bypassed.
- Amounts are displayed in K/M/B/T shorthand, and every amount input and server route accepts the same shorthand.

## Maintenance mode

Maintenance is a database-backed platform switch managed by an administrator.

1. Sign in as an owner or administrator.
2. Open **Admin panel → Settings → Access & maintenance**.
3. Set an optional maintenance message.
4. Turn on **Platform maintenance** and save the group.

While maintenance is active:

- Players with the `user` role see a full-screen maintenance page with the configured message, a refresh/check-again button, and a sign-out action.
- Open player tabs pick up the change within 30 seconds, immediately when the tab becomes visible, or when **Check again** is used.
- The server rejects registration, game wagers, game actions, new support tickets, and new cashier requests with HTTP `503` and error code `MAINTENANCE`.
- Reads such as the wallet, ledger, notifications, and existing ticket history remain available to signed-in players through the API; the player UI is intentionally paused.
- Staff, moderators, admins, and owners retain access and see a persistent maintenance banner.
- Existing wallet balances and ledger entries are not changed by enabling the switch. Staff support and cashier review workflows remain available.

Turn the switch off and save to restore player access. A player tab recovers on its next config refresh. The public configuration endpoint (`GET /api/public/config`) is served with `Cache-Control: no-store`, so no stale maintenance state is cached.

## Roles

| Role | Capabilities |
| --- | --- |
| `user` | Play games, manage their own wallet view, open tickets, and request money only through the Cashier |
| `support` | Everything a player can do, plus the support queue, replies, notes, assignment, and status/priority changes. Cannot decide cashier requests. |
| `moderator` | Support capabilities, plus admin access, ticket management, and user restrictions |
| `admin` | Games, settings, economy, cashier decisions, announcements, audit, staff, and role management |
| `owner` | Every permission, including owner bootstrap, cashier decisions, and all administrative controls |

Role hierarchy checks prevent self-escalation above the actor's own role. Credit adjustments, role changes, and staff actions are written to the audit log.

## Backup and restore

The database runs in WAL mode. Use the backup script rather than copying only the main file:

```bash
npm run db:backup -- --out /var/backups/donutcash
```

On Windows, use a path such as `D:\donutcash-backups`. The default output is `data/backups`. The script uses SQLite's online backup API, runs `integrity_check` on the copy, removes empty sidecar files, and prints user and ledger counts. Schedule it with the operator's normal job runner and keep copies on a volume outside the application directory.

To restore:

1. Stop the server.
2. Keep a copy of the current `data/aurum.db`.
3. Replace `data/aurum.db` with the chosen backup file.
4. Remove stale `data/aurum.db-wal` and `data/aurum.db-shm` files.
5. Start the server and run `npm run db:migrate` to confirm migrations and row counts.

Back up `.env` separately because it holds the session secret. The server can start against an existing database without re-running seeds; seed inserts only fill missing rows.

## Production notes

```bash
npm ci
npm run build
NODE_ENV=production \
APP_URL=https://your-domain.example \
SESSION_SECRET="<at-least-32-random-characters>" \
npm start
``` - `npm run build` writes the client to `dist/`; the Express server serves it with a SPA fallback.

- Put the app behind a TLS-terminating reverse proxy and forward `/api` and the SPA to the Node process.
- `APP_URL` must exactly match the browser origin. Production mutation requests with an unexpected `Origin` header are rejected.
- Session cookies are `httpOnly`, `SameSite=Lax`, and `Secure` in production.
- Run a single API process against a given SQLite file. SQLite and the in-process rate limiters are not designed for horizontal scaling with multiple writers. - Keep `data/`, `.env`, and backups out of version control and public web roots.

### Deploying to Windows/IIS hosts that run Node behind HttpPlatformHandler

Some hosts, such as MonsterASP, run Node.js behind IIS and assign the listening port through `process.env.PORT`. If yours is one of those:

- Do not hard-code the listening port; let the server use `process.env.PORT`.
- Make sure the host runs `npm start` (or an equivalent `NODE_ENV=production` start command), not just the static files from `dist/`.
- Put `web.config` and the Node entry point where the host expects them, with `web.config` handed to `HttpPlatformHandler` so the Node process starts.
- Confirm the host’s Node startup logs if sign-in or registration fails, because missing server startup is a common cause of “server not answering”.

If your host only serves static files from `dist/`, this app will render but its `/api/...` routes will not exist. In that case you still need a running Node backend for login, registration, games, wallet, tickets, and cashier requests.


## Legal, consent and self-exclusion

The legal pages live at `/terms`, `/privacy`, and `/responsible-gambling`, with a `?lang=nl` Dutch version. They are templates and carry a visible notice that a qualified legal professional must review them before publication. Replace the placeholder operator, jurisdiction, and contact details in [`shared/legal.ts`](shared/legal.ts) and [`src/content/legal.ts`](src/content/legal.ts) first.

Consent is versioned in [`shared/legal.ts`](shared/legal.ts). Bump `LEGAL_TERMS_VERSION` or `LEGAL_PRIVACY_VERSION` whenever the published text changes: every account is then required to accept the new version before private API access resumes. Each acceptance stores the version, timestamp, IP address, and user agent in `legal_acceptances`; registration also records consent in the same transaction that creates the account.

The self-exclusion endpoint is `POST /api/me/self-exclusion` with `{ duration: '24h' | '7d' | '30d' | 'permanent', reason?: string }`. It revokes every session immediately, blocks future logins until the period ends, and cannot be lifted early. Players can start it from **Settings → Responsible play**.

## Tests

The integration suite exercises authentication, sessions, CSRF headers, registration policy, legal consent versioning and gating, self-exclusion, email verification and preferences, roles, ticket workflows, archived legacy money-request records, cashier deposits/withdrawals and messages, ledger integrity, all six games, daily/streak rewards, claim concurrency, reward configuration and audit records, idempotency, admin controls, public configuration, and maintenance blocking.

```bash
npm run typecheck
npm test
npm run build
```

Tests use temporary SQLite databases and do not modify `data/aurum.db`.

## Project layout

```text
src/                 React client
  components/        Shell, UI primitives, game and cashier helpers
  context/           Auth, notifications/toasts
  pages/             Player, staff, and admin pages
  pages/cashier.tsx  Player deposit/withdrawal requests
  pages/games/       Six game screens
server/              Express API
  db/                SQLite connection, schema migrations, seeds
  games/             Server-authoritative game modules
  lib/               Auth helpers, wallet ledger, tickets, cashier, rewards, email queue/templates, audit, maintenance guard, active-round lock
  routes/            Public, auth, player, game, ticket, cashier, rewards, staff, admin APIs
  scripts/           Owner bootstrap, migration status, backups
shared/              Shared TypeScript types, permissions, and K/M/B/T amount helpers
tests/               Vitest + Supertest integration tests
data/                Runtime SQLite database (ignored by Git)
dist/                 Production client build output
```

## Security notes

- Passwords are salted and hashed with scrypt.
- Session tokens are random, stored only as HMAC digests, and sent in httpOnly cookies.
- State-changing API requests require the `X-Requested-With: donutcash` header and are origin-checked outside development.
- Rate limits cover login, registration, password resets, mutations, ticket creation, and cashier request creation.
- Wallet changes run through an append-only ledger with idempotency keys and transaction boundaries.
- Game randomness comes from Node's `crypto.randomInt`, not `Math.random`.
- Daily reward claims are transactionally unique per user and reward day; the client cannot choose an amount or claim day.
- The SMTP key saved from the admin panel is encrypted with AES-256-GCM, never returned by an API, and never logged.
- Audit log entries record actor, action, target, reason where supplied, metadata, and IP.

## Limitations

- **Manual cashier review.** Cashier deposits and withdrawals are manual ledger movements settled by an owner or administrator; there is no automated payment rail. Game outcomes and balances are always server-authoritative.
- **Email needs an owner setup step.** Delivery stays off until an owner saves a valid SMTP key and sender in **Admin → Email**. Until then, verification and reset links are written to the server log (and reset links can be exposed locally with `EXPOSE_RESET_TOKEN=true`).
- **No attachments** in support tickets.
- **The email queue runs inside the API process.** It is durable in SQLite and retries safely, but run a single API process, as with the rest of the SQLite deployment.
- **SQLite is single-process oriented.** Use one server instance and a persistent volume; scale by snapshot/read replicas only with a proper migration, not by pointing multiple writers at the file.
- **Browser automation is not part of `npm test`.** The committed tests are API/integration tests; UI flows are verified manually.
- **Game sessions are server-side.** Reloading a page in the middle of a multi-step hand is not a supported resume flow in every game.
- **Maintenance pauses writes, not existing data.** Open game sessions, tickets, and pending cashier requests remain in the database and are not cancelled or refunded by toggling maintenance.
- **Cashier decisions are manual.** There is no automated payment processor, card flow, or external cash payout. Owners and administrators must review each amount.
- **Legacy ticket money requests are archived.** Data created before the move to the Cashier remains visible in the original tickets and administrator user records, but it cannot be approved, rejected, or recreated. Pending legacy rows keep their historical status and are not counted as pending cashier work.
