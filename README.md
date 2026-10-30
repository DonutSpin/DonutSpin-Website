# Donutcash

Donutcash is a self-hosted **casino for DonutSMP money**, with a player lobby, six server-authoritative games, a support desk, and an administration console.

> **Built for DonutSMP.** Balances are tracked in DonutSMP money. The cashier is the single place to deposit money into the game or withdraw it again; owners and administrators review every request.

## What is included

- **Players** — registration with email verification, wallet and ledger history, six games, daily/streak rewards, support tickets, cashier requests, notifications, and profile settings.
- **Rewards** — a manual daily claim with configurable reset timezone, an increasing streak, milestone bonuses, grace-day handling, claim history, and a countdown to the next reset.
- **Games** — Coinflip, Mines, Blackjack, Roulette, Towers, and Plinko. Wagers, randomness, outcomes, and payouts are settled by the server; animations only reveal settled results. Roulette players choose their own chip value, which scales every wager and payout without changing the table's odds.
- **Game analytics** — per-game settled-round statistics, date-range filters, win-rate and payout trends, per-round configuration snapshots, sample-aware deviation warnings, and audited win-chance configuration.
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
| `npm run test:watch` | Run tests in watch mode |
| `npm run build` | Type-check, build the client into `dist/`, and compile the server to `build/server/index.js` |
| `npm run build:server` | Rebuild only the production server bundle |
| `npm start` | Start the production server (`node server.js`) |
| `npm run db:migrate` | Create/migrate the database and print schema status |
| `npm run db:backup -- --out App_Data/backups` | Take an online SQLite backup and verify it |
| `npm run deploy:check` | Read-only check of the live database, persistent settings, game configs, and Git hygiene |
| `npm run owner -- --email …` | Bootstrap an owner account |

## Configuration

Configuration lives in `.env`. The server loads it on startup, and environment variables already set by the process take precedence.

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `4000` | API/production server port. Falls back to `HTTP_PLATFORM_PORT`, which IIS assigns. |
| `APP_NAME` | `Donutcash` | Initial platform name seed |
| `APP_URL` | production: `https://donutcash.runasp.net`; development: `http://localhost:5173` | Public client origin used in every email link, reset URL, and session cookie decision. In production it is also the only allowed mutation origin. A missing, invalid, or loopback value falls back to the production default rather than sending localhost links. |
| `DATABASE_PATH` | first existing of `app.db`, `data/app.db`, `data/aurum.db`, `App_Data/app.db`, `App_Data/aurum.db`; new installs use `App_Data/aurum.db` | SQLite file. Parent directories are created automatically. Leave unset in production so an existing database is always found before a new one is created. |
| `DONUTCASH_DATA_DIR` | `App_Data` | Persistent directory for backups, the generated session secret, and generated owner credentials. It must not be inside `src/`, `server/`, `dist/`, or `build/`. Set an absolute path outside `/wwwroot` if the host exposes one. |
| `ALLOW_NEW_DATABASE` | `false` | Production refuses to boot when no existing database is found, because creating an empty one would hide all balances and settings. Set to `true` once only for a genuinely new installation, then remove it. |
| `DB_BACKUP_BEFORE_MIGRATION` | `true` | Takes a verified `VACUUM INTO` snapshot before applying pending migrations and aborts startup if the snapshot fails. |
| `DB_BACKUP_KEEP` | `10` | Number of automatic pre-migration snapshots kept in `App_Data/backups/`. |
| `SESSION_SECRET` | generated | At least 32 characters. If unset in production, a random secret is generated once and persisted to the data directory (`App_Data/.session-secret` by default). Existing `data/.session-secret` files are reused so an upgrade does not sign everyone out. |
| `SESSION_DAYS` | `7` | Session lifetime |
| `STARTING_CREDITS` | `5000000` | Initial DonutSMP money grant |
| `EXPOSE_RESET_TOKEN` | development only | Returns reset paths in the API response for local testing. Keep `false` in production. |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Optional fallback SMTP host. Admin → Email settings overrides it. |
| `SMTP_PORT` | `587` | STARTTLS port. |
| `SMTP_USER` | empty | Brevo SMTP login, for example `c05ccf001@smtp-brevo.com`. |
| `SMTP_PASS` | empty | Brevo SMTP key. Prefer saving it in Admin → Email settings; never commit it. |
| `SMTP_FROM` | `Donutcash <no-reply@example.com>` | Sender identity. Use a domain authenticated in Brevo. |
| `EMAIL_ENCRYPTION_KEY` | `SESSION_SECRET` | Stable secret used to encrypt the SMTP key saved from the admin panel. Set a separate value in production. |
| `TURNSTILE_SITE_KEY` | built-in public key | Public Cloudflare Turnstile widget key. Safe to expose. |
| `TURNSTILE_SECRET_KEY` | empty | Server-only Turnstile secret. Set it in the hosting panel or local `.env`; never commit it. CAPTCHA stays disabled while empty. |
| `TURNSTILE_ENABLED` | `true` | Set to `false` to disable the widget and server checks without removing keys. |
| `TURNSTILE_EXPECTED_HOSTNAME` | empty | Optional extra hostname check on Siteverify responses, for example `donutcash.runasp.net`. |

Platform name, tagline, registration, maintenance, support categories, game limits, economy limits, reward rules, and email delivery are stored in the database and managed from the admin panel. The `economy.cashier_request_limit` setting is the maximum amount for a single cashier deposit or withdrawal request.

### Rewards and streaks

Open **Admin → Rewards** to enable the page, choose the reset hour and IANA timezone, set the base amount, per-day increase, maximum amount, optional milestone bonuses, and the missed-day policy (reset immediately or allow grace days). Every change is validated and written to the audit log.

Players claim from **Rewards** once per reward day. The claim is settled in a single database transaction with a unique `(user, day)` constraint, so double-clicks, multiple tabs, and parallel requests cannot pay twice. Claim history and the current streak are stored server-side.

### Email

Email is optional and disabled until an owner enables it in **Admin → Email**. The panel holds the SMTP host, port, login, SMTP key, sender name/address, and a test-send button. The key is encrypted with AES-256-GCM at rest and is never returned to the browser or written to logs.

The preconfigured Brevo relay is `smtp-relay.brevo.com:587` (STARTTLS) with login `c05ccf001@smtp-brevo.com`. Add the SMTP key in the admin panel, set a sender on a domain verified in Brevo, enable delivery, then send a test email. Delivery is queued in SQLite with exponential retries and an admin-visible delivery log; a mail failure never blocks registration, rewards, cashier decisions, or sign-in.

Templates cover welcome, email verification, password reset, password/email changes, new sign-ins, cashier decisions, daily rewards, and staff announcements. Each message has an HTML version and a plain-text fallback, with notification preferences linked in the footer.

### Bot protection (Cloudflare Turnstile)

Login, registration, and password-reset requests can require a Cloudflare Turnstile challenge. The widget is rendered on the client, but the server always calls Cloudflare's Siteverify endpoint before processing the request; a direct API submission without a valid, unused token is rejected. Tokens are single-use, expire after five minutes, and are checked against the form action and configured hostname when Cloudflare returns them.

The public site key is served by `/api/public/config` and is safe to expose. The secret key is read only by the server from `TURNSTILE_SECRET_KEY`; it is never returned by the API, embedded in the client bundle, or logged. If the secret is missing, the integration reports itself disabled and logs a production warning rather than locking users out. Set the secret in **Websites → environment variables** on MonsterASP, add `donutcash.runasp.net` to the widget's hostname list in the Cloudflare dashboard, and restart/publish. No Cloudflare DNS migration is required.

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

### Roulette chip values

Roulette has a per-player **chip value** setting in the table sidebar. The presets are 1, 5, 10, 25, 100, 500 and 1,000 money, and a custom whole amount can be entered up to the current table maximum. The choice is stored in `game_preferences` and loaded when the page opens.

- Each click places exactly **one chip**; the server multiplies the position's chip count by the round's chip value to get its wager.
- The request is rejected unless the chips, their money amounts and the declared total wager agree. Invalid values, fractional chip amounts and stacks above the table or platform limits are refused before any ledger entry is written.
- Payouts are calculated on chips first and then multiplied by the selected chip value, preserving the original 36×, 3× and 2× table and the single-zero house edge at every denomination.
- The chosen chip value and per-position chip counts are stored on the session, so a restored round settles and displays exactly as it started. Changing the chip value clears any unspun felt; settled results are never repriced.

### Game statistics and win chances

Staff and administrators have two separate surfaces:

- **Staff workspace → Game statistics** (`/staff/games`) shows settled bets, wins/losses/pushes, actual win rate, configured chance, wagers, payouts, house profit/loss, RTP, and open rounds for all six games. Search, sort, and the 24h/7d/30d/90d/all-time filters are server-backed. Opening a game shows its win-rate and house-profit history, recent periods, and configuration history.
- **Admin panel → Game configuration** (`/admin/games`) edits each game independently. The win chance is validated server-side to 1–99% with at most two decimals. Only `games.manage` (administrator and owner) can change it, and every change writes both `game_config_history` and an audit entry with the administrator, timestamp, and previous/new values.

Every new round stores the exact validated game configuration and configured chance on the session. Existing rounds keep the configuration they started with; the migration deliberately leaves pre-existing sessions without a fabricated snapshot, so they are never judged against newer settings.

**Outcome control** is used only where a single binary result and a fixed payout make the percentage meaningful (Coinflip). The chance is applied once, at round creation. **Monitoring target** is used for Roulette, Plinko, Mines, Towers, and Blackjack: their fixed wheels, tables, cards, mine layouts, and trap rules still decide outcomes, while the configured percentage provides a baseline for drift monitoring. This avoids silently changing a skill/strategy game or breaking its payout mathematics.

Actual and configured percentages are always shown separately. A deviation warning requires at least 50 settled non-push rounds carrying a configuration snapshot, a two-sided 3σ z-score, and a difference of at least 5 percentage points. The UI also shows the Wilson 95% interval and the sample size. Warnings are descriptive only; no code path changes a probability automatically from short-term results.

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

On Windows, use a path such as `D:\donutcash-backups`. The default output is `App_Data/backups`. The script uses SQLite's online backup API, runs `integrity_check` on the copy, removes empty sidecar files, and prints user and ledger counts. Schedule it with the operator's normal job runner and keep copies on a volume outside the application directory.

To restore:

1. Stop the server.
2. Run `npm run deploy:check` and note the exact database path it prints (for example `app.db`, `data/aurum.db`, or `App_Data/aurum.db`).
3. Keep a copy of the current database file.
4. Replace that database file with the chosen backup file.
5. Remove the stale `-wal` and `-shm` files beside it.
6. Start the server and run `npm run db:migrate` to confirm migrations and row counts.

Back up `.env` or the host environment variables separately because they hold the session secret. The server can start against an existing database without re-running seeds; seed inserts only fill missing rows and never overwrites a setting that already exists.

## Production notes

```bash
npm ci
npm run build
NODE_ENV=production \
APP_URL=https://your-domain.example \
SESSION_SECRET="<at-least-32-random-characters>" \
npm start
```

- `npm run build` writes the client to `dist/`; the Express server serves it with a SPA fallback.

- Put the app behind a TLS-terminating reverse proxy and forward `/api` and the SPA to the Node process.
- `APP_URL` must exactly match the browser origin. Production mutation requests with an unexpected `Origin` header are rejected.
- Session cookies are `httpOnly`, `SameSite=Lax`, and `Secure` whenever the resolved public origin is `https://` (`COOKIE_SECURE` overrides). In production the default origin is `https://donutcash.runasp.net`, so cookies are secure even when `APP_URL` is omitted.
- Rate-limit windows live in the SQLite database whenever a file database is used, so two Node workers on the same host cannot each allow a full quota. SQLite still prefers a single writer; do not scale to multiple hosts.
- Keep `App_Data/`, `data/`, `app.db`, `.env`, `web.config`, and backups out of version control, and never place the database in a folder served by `express.static` (`dist/`).
- `SESSION_SECRET` is optional at runtime: when it is missing in production the server generates a random secret once and persists it to `App_Data/.session-secret` (or the configured data directory). Existing `data/.session-secret` and root `.session-secret` files are reused. Set it explicitly to control rotation. A provided value shorter than 32 characters still fails closed.
- Production refuses to start when it would create a brand-new empty database. This prevents a mistyped `DATABASE_PATH` from presenting a blank casino and hiding every existing account and setting. Set `ALLOW_NEW_DATABASE=true` once only for a genuinely new installation.
- `PORT` is read first, then `HTTP_PLATFORM_PORT` (the port IIS assigns). The app never hard-codes a listening port.
- Production mutation requests must be same-origin or match the resolved public origin. A missing or loopback `APP_URL` resolves to `https://donutcash.runasp.net`, not localhost.

### Deploying to MonsterASP (Windows / IIS + HttpPlatformHandler)

This is a **Node** app, not a static site. Publishing only `dist/` produces a site that renders and then says “The server is not answering”, because IIS serves the HTML but no process answers `/api`. Use **Node.js SSR app**, not **Node.js SPA**.

#### Why Git Pull used to fail

`web.config` was tracked in Git while MonsterASP's Node.js SSR deployment **generates `/wwwroot/web.config` on every Build & publish**. The generated file differs from the committed copy, so the next pull sees a locally modified tracked file and refuses to overwrite it. The host build also runs `npm install`, which can rewrite `package-lock.json` when the lockfile and `package.json` are out of sync.

The fix is architectural, not a workaround:

- `web.config` is no longer tracked. It is generated by MonsterASP and ignored by Git. A tracked template remains at [`deploy/web.config.example`](deploy/web.config.example) for manual IIS/Plesk setups.
- The database, WAL sidecars, automatic backups, generated session secret, generated owner credentials, and IIS logs are ignored and live outside the code paths that Git replaces.
- Every startup seed uses `ON CONFLICT DO NOTHING`, so it only creates missing rows. It never updates an existing game multiplier, win chance, economy limit, reward rule, or admin setting.
- Pending migrations take a verified snapshot first and abort if the snapshot fails. A production process refuses to boot if it would create a brand-new empty database.
- `package-lock.json` stays committed and in sync with `package.json`. Run `npm install` locally after changing dependencies, commit the updated lockfile, then push.

#### MonsterASP configuration

1. In **Websites → Git deploy**, choose **Node.js SSR app**.
2. Build command: `npm ci && npm run build` if the panel exposes a command field; otherwise `npm run build` (MonsterASP installs dependencies first). `npm ci` installs exactly the committed lockfile and never rewrites it; `npm run build` type-checks, writes the client to `dist/`, and compiles the server to `build/server/index.js`.
3. Start command: **`server.js`**. The field wants a JavaScript file Node can run, not an npm script. `server.js` loads `build/server/index.js` and pins the working directory to the app root.
4. Set these under **Websites → Environment variables** (not in a committed file):

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://donutcash.runasp.net` (the public origin used in email links and secure cookies) |
| `SESSION_SECRET` | 64+ random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret, if CAPTCHA is enabled |
| `SMTP_PASS` | Optional fallback only; prefer saving the SMTP key in Admin → Email |
| `OWNER_*` | Optional owner bootstrap/recovery values |

Leave `DATABASE_PATH` unset so the server finds the existing database automatically. Do **not** set `ALLOW_NEW_DATABASE` on this site.

5. Never edit or protect `web.config` on MonsterASP. The platform regenerates it. The server itself refuses `/App_Data`, `/data`, `/logs`, `/server`, `/src`, `/web.config`, and other private paths in the SPA fallback.

#### Activate this deployment once

1. Commit and push these changes from development:

   ```bash
   git status
   git add -A
   git commit -m "Stop tracking generated web.config and isolate persistent data"
   git push origin main
   ```

2. In **Websites → Git deploy → Protected files**, add one path per line, relative to `/wwwroot`:

   ```text
   app.db
   app.db-wal
   app.db-shm
   data/
   App_Data/
   .env
   ```

   Include only the entries that exist. If the database is at `data/app.db` or `App_Data/aurum.db`, the folder entry covers it. Protection is a second line of defence; all of these paths are already ignored by Git. If `web.config` is currently in the list, remove it. Do **not** protect `web.config`, `dist/`, `build/`, `node_modules/`, `server.js`, `package.json`, or `package-lock.json`.

3. Click **Pull latest**. If the old tracked `web.config` still blocks this one final pull, use **Danger zone → Reset (hard)** once, then **Pull latest** again. Reset (hard) resets only the staged Git checkout; per MonsterASP it does not touch `/wwwroot` or the live database. Do not disable and re-enable Git deploy.

4. Click **Build & publish**. MonsterASP leaves untracked `App_Data/`, `data/`, and `app.db` in place.

5. Verify the deployment:
   - The site loads and sign-in still works.
   - Existing balances, game limits, multipliers, rewards, and admin settings are unchanged.
   - **Control Panel → Websites → Logs → HttpPlatform** shows `database: ... (source: ...)` and that the real database file was found.
   - If the plan gives you a command console, run `npm run deploy:check`. It is read-only and prints the database path, schema version, row counts, persistent settings, game configs, and Git hygiene.
   - Request `/App_Data/aurum.db` and `/data/aurum.db` in a browser; both must return 404, not a file.

If the server refuses to start with “Refusing to start: no existing database was found”, the path is wrong or the file is missing. Restore the file or set `DATABASE_PATH` to its real location. Do not set `ALLOW_NEW_DATABASE=true` on a site that has data.

#### Future updates

```bash
# development machine
git status
git add -A
git commit -m "Describe the change"
git push origin main
```

Then in the MonsterASP panel: **Pull latest → Build & publish**. No server-side file edits, no web.config changes, no database re-import, and no disable/enable cycle. If you change dependencies, run `npm install` locally first so `package-lock.json` is committed in sync.

#### Persistent data layout

| Path | Contents | Git | MonsterASP |
| --- | --- | --- | --- |
| `app.db` or `data/` or `App_Data/` | SQLite database and WAL sidecars | Ignored | Persisted; protect the exact path |
| `App_Data/backups/` | Verified automatic pre-migration snapshots | Ignored | Persisted |
| `App_Data/.session-secret` | Generated session secret when `SESSION_SECRET` is unset | Ignored | Persisted; legacy `data/.session-secret` and root `.session-secret` are reused |
| `App_Data/owner-credentials.txt` | Generated first-owner password, printed once | Ignored | Delete after changing the password |
| `logs/` | IIS/HttpPlatform stdout logs | Ignored | Managed by the host |
| `web.config` | Generated IIS startup configuration | Ignored | Generated on every publish |
| `src/`, `server/`, `shared/`, `scripts/`, `deploy/` | Application code | Tracked | Replaced by Git |

The database resolver checks, in order: `DATABASE_PATH`, `DONUTCASH_DATA_DIR`, root `app.db`, `data/app.db`, `data/aurum.db`, `App_Data/app.db`, `App_Data/aurum.db`, then the new default `App_Data/aurum.db`. It never renames or deletes a database it finds. If more than one exists it logs every candidate and uses the first match; set `DATABASE_PATH` explicitly if that is not the one you want.

#### Moving an existing app.db (optional)

You do **not** need to move your current `app.db`; it is detected and protected where it is. If you later want it under `App_Data/`:

1. Stop the app (or place `app_offline.htm` in `/wwwroot`).
2. Take a verified backup: `npm run db:backup -- --out App_Data`.
3. Rename the printed `App_Data/donutcash-<timestamp>.db` snapshot to `App_Data/aurum.db` while the app is stopped. Do not overwrite an existing `App_Data/aurum.db`; if one exists, confirm it is the same database or choose another path.
4. Set `DATABASE_PATH=App_Data/aurum.db` in the panel environment variables and restart.
5. Sign in and verify balances/settings, then keep the old `app.db` for at least one backup cycle. Never delete the old file until the new one is proven.

The old database is copied, never overwritten or deleted by the application. If you cannot run npm scripts on the host, download the database plus its `-wal` and `-shm` files while the app is stopped and restore them together.

#### Client IPs behind IIS

HttpPlatformHandler connects to Node from loopback and does **not** sanitise `X-Forwarded-For`. If the site forwards it untouched, a caller can choose any address: rotating that header would reset their rate-limit bucket and forge audit-log IPs. The app therefore ignores forwarded headers by default and records no IP rather than a fake one.

To get real client IPs, have the host (or you, in the panel) make IIS **replace** the header before it reaches Node, for example with ARR's “preserve client IP in the following header” set to `X-Forwarded-For` after TLS terminates at IIS, or an approved URL Rewrite rule that sets `HTTP_X_FORWARDED_FOR` to `{REMOTE_ADDR}`. Only then set:

| Variable | Purpose |
| --- | --- |
| `TRUST_PROXY_HEADERS` | `true` to trust forwarded headers from loopback (and `TRUSTED_PROXY_IPS`) |
| `TRUSTED_PROXY_IPS` | Extra trusted proxy addresses, comma separated (loopback is always included) |

After changing it, sign in as an admin and call `GET /api/admin/diagnostics/request` with a browser or `curl`. It reports `socketAddress`, `resolvedClientIp`, the raw forwarding headers, and whether trust is on. If `resolvedClientIp` still differs from your public IP, the proxy is not overwriting the header and trust must stay off. Note that a site-level `web.config` normally cannot grant itself permission to set `HTTP_X_FORWARDED_FOR`; that needs the hosting provider's IIS administrator.

If you must stay on static hosting, host the API on a separate Node instance and point the client at it; a static deploy alone cannot process registration, games, wallet, tickets or cashier requests.


### Owner account on a hosted deployment

Never commit an owner password. The repository contains no credentials; the owner is created from the host's environment instead.

**Preferred: set environment variables in the hosting panel**

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAIL` | Email of the owner account |
| `OWNER_USERNAME` | Username to create (3–20 letters, numbers, underscores). Defaults to `owner` |
| `OWNER_PASSWORD` | Password, at least 10 characters with a letter and a number |
| `OWNER_RESET_PASSWORD` | Set to `true` to overwrite that account's password on boot |

On startup the server creates the owner if no account uses `OWNER_EMAIL`, promotes it if the account exists with a lower role, and optionally resets its password. The password is never logged. This makes the variables safe to keep configured, and it is the recovery path for a forgotten owner password.

**Fallback: no configuration and no owner in the database**

If `OWNER_EMAIL`/`OWNER_PASSWORD` are unset and the database has no owner at all, one is generated with a strong random password. The credentials are printed once to the process log (on IIS: the HttpPlatform log) and written to `App_Data/owner-credentials.txt`, which is ignored by Git and refused by the SPA fallback. Sign in, change the password, then delete that file.

In both cases the new owner must accept the current Terms of Service and Privacy Policy on first sign-in before the admin panel unlocks. That gate is intentional and applies to every account.

## Legal, consent and self-exclusion

The legal pages live at `/terms`, `/privacy`, and `/responsible-gambling`, with a `?lang=nl` Dutch version. They are templates and carry a visible notice that a qualified legal professional must review them before publication. Replace the placeholder operator, jurisdiction, and contact details in [`shared/legal.ts`](shared/legal.ts) and [`src/content/legal.ts`](src/content/legal.ts) first.

Consent is versioned in [`shared/legal.ts`](shared/legal.ts). Bump `LEGAL_TERMS_VERSION` or `LEGAL_PRIVACY_VERSION` whenever the published text changes: every account is then required to accept the new version before private API access resumes. Each acceptance stores the version, timestamp, IP address, and user agent in `legal_acceptances`; registration also records consent in the same transaction that creates the account.

The self-exclusion endpoint is `POST /api/me/self-exclusion` with `{ duration: '24h' | '7d' | '30d' | 'permanent', reason?: string }`. It revokes every session immediately, blocks future logins until the period ends, and cannot be lifted early. Players can start it from **Settings → Responsible play**.

## Tests

The integration suite exercises authentication, sessions, CSRF headers, registration policy, legal consent versioning and gating, self-exclusion, email verification and preferences, roles, ticket workflows, archived legacy money-request records, cashier deposits/withdrawals and messages, ledger integrity, all six games, daily/streak rewards, claim concurrency, reward configuration and audit records, game statistics and win-chance permissions, per-round configuration snapshots, date-range and trend calculations, deviation thresholds and sample-size handling, roulette chip-value settlement and payout arithmetic, idempotency, admin controls, public configuration, and maintenance blocking.

```bash
npm run typecheck
npm test
npm run build
```

Tests use temporary SQLite databases and do not modify `app.db` or `data/aurum.db`. `npm run deploy:check` is read-only and is safe to run against production.

## Project layout

```text
src/                 React client
  components/        Shell, UI primitives, game and cashier helpers
  context/           Auth, notifications/toasts
  pages/             Player, staff, and admin pages
  pages/cashier.tsx  Player deposit/withdrawal requests
  pages/games/       Six game screens
server/              Express API
  db/                SQLite connection, schema migrations, seeds, pre-migration safety
  games/             Server-authoritative game modules and validated game configs
  lib/               Auth helpers, wallet ledger, tickets, cashier, rewards, email queue/templates, game statistics, audit, maintenance guard, active-round lock
  routes/            Public, auth, player, game, ticket, cashier, rewards, staff, admin APIs
  scripts/           Owner bootstrap, migration status, backups, deployment verification
deploy/              Tracked web.config.example for manual IIS (live web.config is generated)
shared/              Shared TypeScript types, permissions, and K/M/B/T amount helpers
tests/               Vitest + Supertest integration tests
App_Data/            Persistent runtime data: database (new installs), backups, secret,
                     generated owner credentials (ignored by Git)
data/                Legacy runtime SQLite database (ignored by Git; still auto-detected)
dist/                 Generated client build output (ignored by Git)
build/                Generated server build output (ignored by Git)
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
- Turnstile tokens are validated server-side with Cloudflare Siteverify; the secret key is never sent to the browser, and missing/invalid tokens are rejected when CAPTCHA is enabled.

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
