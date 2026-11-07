#!/usr/bin/env node
/**
 * Production smoke test.
 *
 * Runs the checks that matter against a live deployment: public config, CSRF,
 * authentication, payouts, double cash-out, wager limits, account wipe, role
 * permissions and rate limiting.
 *
 *   node scripts/smoke-production.mjs http://127.0.0.1:4000
 *   SMOKE_BASE=https://donutspin.runasp.net \
 *   SMOKE_ADMIN_EMAIL=owner@example.com SMOKE_ADMIN_PASSWORD=... \
 *   SMOKE_MUTATE_CONFIG=true node scripts/smoke-production.mjs
 *
 * Admin-only checks run when SMOKE_ADMIN_EMAIL/PASSWORD are set. The wager-limit
 * change is skipped unless SMOKE_MUTATE_CONFIG=true because it edits live game
 * configuration (it restores the original value afterwards).
 */

const base = (process.env.SMOKE_BASE || process.argv[2] || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const adminEmail = process.env.SMOKE_ADMIN_EMAIL || '';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || '';
const mutateConfig = process.env.SMOKE_MUTATE_CONFIG === 'true';
const PASSWORD = 'SmokeTest!2026';
const CSRF = { 'X-Requested-With': 'donutspin' };

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}

class Jar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
    for (const value of values) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }

  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

async function api(path, options = {}) {
  const { method = 'GET', body, jar, headers = {}, origin } = options;
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (method !== 'GET') requestHeaders['Content-Type'] = 'application/json';
  if (jar && jar.header()) requestHeaders.Cookie = jar.header();
  if (origin) requestHeaders.Origin = origin;

  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (jar) jar.absorb(response);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: response.status, body: json, text, headers: response.headers };
}

const unique = (prefix) => `${prefix}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
const rid = () => `smoke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const money = (value) => value.toLocaleString('en-US');

function payoutFor(bet, multiplier, cap = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(bet) || bet <= 0) return 0;
  const hundredths = BigInt(Math.round(Math.round(multiplier * 100)));
  const raw = (BigInt(Math.trunc(bet)) * hundredths) / 100n;
  return Number(raw < BigInt(cap) ? raw : BigInt(cap));
}

async function signIn(identifier, password, jar = new Jar()) {
  return api('/auth/login', { method: 'POST', body: { identifier, password }, jar, headers: CSRF });
}

async function main() {
  console.log(`\nSmoke test against ${base}\n`);

  /* ---------------------------- public surface ---------------------------- */
  const config = await api('/public/config');
  check('public config responds', config.status === 200 && config.body?.name, config.body?.name ?? `HTTP ${config.status}`);
  const maintenance = config.body?.maintenance === true;

  const home = await fetch(`${base}/?smoke=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
  const html = await home.text();
  const bundle = /assets\/index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0] ?? '';
  check('site serves a client bundle', Boolean(bundle), bundle);
  const csp = home.headers.get('content-security-policy') ?? '';
  check('CSP restricts scripts to self', csp.includes("script-src 'self'"), csp.slice(0, 60));
  check('server does not advertise Express', !home.headers.get('x-powered-by'));

  const noCsrf = await api('/auth/login', { method: 'POST', body: { identifier: 'x', password: 'y' } });
  check('mutations without the app header are rejected', noCsrf.status === 403 && noCsrf.body?.error?.code === 'CSRF_HEADER');

  const badOrigin = await api('/auth/login', {
    method: 'POST',
    body: { identifier: 'x', password: 'y' },
    headers: CSRF,
    origin: 'https://evil.example',
  });
  check('cross-origin mutations are rejected', badOrigin.status === 403, badOrigin.body?.error?.code ?? '');

  /* ------------------------------ registration ---------------------------- */
  const username = unique('smk');
  const email = `${username}@smoke.local`;
  const player = new Jar();
  const register = await api('/auth/register', {
    method: 'POST',
    jar: player,
    headers: CSRF,
    body: {
      username,
      email,
      password: PASSWORD,
      ageConfirmed: true,
      acceptTerms: true,
      acknowledgeDonutRules: true,
    },
  });
  check('registration succeeds', register.status === 201, `HTTP ${register.status}`);
  const startingCredits = register.body?.user?.balance ?? 0;
  check('starting balance is credited', startingCredits > 0, money(startingCredits));

  const sessionCookie = String(register.headers.get('set-cookie') ?? '');
  check('session cookie is httpOnly', /HttpOnly/i.test(sessionCookie));
  check('session cookie is SameSite', /SameSite=Lax/i.test(sessionCookie));
  if (base.startsWith('https://')) {
    check('session cookie is Secure on HTTPS', /Secure/i.test(sessionCookie));
  }

  if (maintenance) {
    console.log('\nMaintenance mode is on: skipping gameplay checks.');
  } else {
    /* -------------------------------- payouts ------------------------------- */
    const games = await api('/games', { jar: player });
    const mines = games.body?.games?.find((game) => game.slug === 'mines');
    const coinflip = games.body?.games?.find((game) => game.slug === 'coinflip');
    check('game catalogue loads', Boolean(mines && coinflip), `${games.body?.games?.length ?? 0} games`);

    if (mines) {
      const tooHigh = await api('/games/mines/play', {
        method: 'POST',
        jar: player,
        headers: CSRF,
        body: { requestId: rid(), bet: mines.maxBet + 1, mines: 3 },
      });
      check('wager above the configured maximum is rejected', tooHigh.status === 400 && tooHigh.body?.error?.code === 'WAGER_TOO_HIGH');

      // Small enough that six attempts cannot exhaust the starting balance.
      const bet = Math.max(mines.minBet, Math.min(100_000, mines.maxBet));
      let session = null;
      let view = null;
      let sessionBalance = 0;
      for (let attempt = 0; attempt < 6 && !session; attempt += 1) {
        const play = await api('/games/mines/play', {
          method: 'POST',
          jar: player,
          headers: CSRF,
          body: { requestId: rid(), bet, mines: 3 },
        });
        if (play.status !== 201) break;
        let current = play.body;
        let alive = current.session.status === 'active';
        // Reveal until one safe tile is open (or the round is lost).
        for (let tile = 0; tile < 25 && alive; tile += 1) {
          const reveal = await api(`/games/sessions/${current.session.id}/action`, {
            method: 'POST',
            jar: player,
            headers: CSRF,
            body: { requestId: rid(), action: 'reveal', tile },
          });
          if (reveal.status !== 200) break;
          current = reveal.body;
          if (current.session.status !== 'active') alive = false;
          else if (current.revealed.length > 0) break;
        }
        if (alive) {
          session = current.session.id;
          view = current;
          sessionBalance = current.balance;
        } else {
          // Close the finished round before starting another.
          await api(`/games/sessions/${current.session.id}/acknowledge`, { method: 'POST', jar: player, headers: CSRF, body: {} });
        }
      }

      check('mines round opens and reveals a tile', Boolean(session), session ?? 'no active round');
      if (session && view) {
        const expected = payoutFor(bet, view.multiplier);
        check('displayed potential uses wager × multiplier', view.potential === expected, `${money(view.potential)} at ${view.multiplier}x`);
        const cashout = await api(`/games/sessions/${session}/action`, {
          method: 'POST',
          jar: player,
          headers: CSRF,
          body: { requestId: rid(), action: 'cashout' },
        });
        check('cash-out pays the displayed amount', cashout.status === 200 && cashout.body?.session?.payout === expected, `${money(cashout.body?.session?.payout ?? 0)}`);
        check(
          'cash-out increases the balance by wager × multiplier',
          cashout.body?.balance === sessionBalance + expected,
          money(cashout.body?.balance ?? 0),
        );

        const second = await api(`/games/sessions/${session}/action`, {
          method: 'POST',
          jar: player,
          headers: CSRF,
          body: { requestId: rid(), action: 'cashout' },
        });
        check('a second cash-out is refused', second.status === 409, second.body?.error?.code ?? `HTTP ${second.status}`);
        await api(`/games/sessions/${session}/acknowledge`, { method: 'POST', jar: player, headers: CSRF, body: {} });
      }
    }

    if (coinflip) {
      const bet = Math.max(coinflip.minBet, Math.min(50_000, coinflip.maxBet));
      const seen = new Set();
      let consistent = true;
      let detail = '';
      for (let round = 0; round < 40 && seen.size < 2; round += 1) {
        const pick = round % 2 === 0 ? 'heads' : 'tails';
        const play = await api('/games/coinflip/play', {
          method: 'POST',
          jar: player,
          headers: CSRF,
          body: { requestId: rid(), bet, pick },
        });
        if (play.status !== 201) {
          consistent = false;
          detail = `HTTP ${play.status}`;
          break;
        }
        const body = play.body;
        seen.add(body.outcome);
        const expected = body.won ? payoutFor(bet, body.multiplier) : 0;
        if (body.won !== (body.pick === body.outcome) || body.session.payout !== expected) {
          consistent = false;
          detail = `${body.outcome} pick ${body.pick} paid ${body.session.payout}`;
        }
        await api(`/games/sessions/${body.session.id}/acknowledge`, { method: 'POST', jar: player, headers: CSRF, body: {} });
      }
      check('coinflip result drives the payout', consistent, detail);
      check('both heads and tails are reachable', seen.size === 2, [...seen].join(', '));
    }
  }

  /* ------------------------------ rate limiting --------------------------- */
  const rateIdentifier = unique('ratelimit');
  const rateStatuses = [];
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const res = await api('/auth/login', {
      method: 'POST',
      headers: { ...CSRF, 'X-Forwarded-For': `192.0.2.${attempt + 1}`, 'X-Real-IP': `192.0.2.${attempt + 1}` },
      body: { identifier: rateIdentifier, password: 'definitely-wrong' },
    });
    rateStatuses.push(res.status);
  }
  check(
    'login limiter cannot be reset with spoofed X-Forwarded-For',
    rateStatuses.slice(0, 10).every((status) => status === 401) && rateStatuses[10] === 429,
    rateStatuses.join(','),
  );

  const forgot = await api('/auth/forgot-password', { method: 'POST', headers: CSRF, body: { email: 'nobody@example.com' } });
  check('password reset does not leak links', forgot.status === 200 && !JSON.stringify(forgot.body).includes('token='), Object.keys(forgot.body ?? {}).join(','));

  /* -------------------------------- admin --------------------------------- */
  if (!adminEmail || !adminPassword) {
    console.log('SKIP  admin checks (set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD)');
  } else {
    const admin = new Jar();
    const login = await signIn(adminEmail, adminPassword, admin);
    check('admin can sign in', login.status === 200, `HTTP ${login.status} ${login.body?.error?.code ?? ''}`);

    if (login.status === 200) {
      // A freshly bootstrapped owner must accept the current legal terms before
      // the admin API unlocks; that gate is intentional.
      if (login.body?.user?.legalAcceptanceRequired) {
        const accept = await api('/legal/accept', {
          method: 'POST',
          jar: admin,
          headers: CSRF,
          body: { ageConfirmed: true, acceptTerms: true, acknowledgeDonutRules: true },
        });
        check('admin accepts the current legal terms', accept.status === 200, `HTTP ${accept.status}`);
      }

      const users = await api(`/admin/users?q=${encodeURIComponent(username)}`, { jar: admin });
      const target = users.body?.items?.find((item) => item.username === username);
      check(
        'admin can read the test account',
        Boolean(target),
        `HTTP ${users.status}${users.body?.error?.code ? ` ${users.body.error.code}` : ''}`,
      );

      if (target) {
        const promote = await api(`/admin/users/${target.id}/role`, {
          method: 'PATCH',
          jar: admin,
          headers: CSRF,
          body: { role: 'support', reason: 'Production smoke test' },
        });
        check('admin can change a role', promote.status === 200, `HTTP ${promote.status}`);

        const supportJar = new Jar();
        await signIn(username, PASSWORD, supportJar);
        const forbidden = await api('/admin/users', { jar: supportJar });
        check('support role cannot read the user administration API', forbidden.status === 403, `HTTP ${forbidden.status}`);

        const demote = await api(`/admin/users/${target.id}/role`, {
          method: 'PATCH',
          jar: admin,
          headers: CSRF,
          body: { role: 'user', reason: 'Production smoke test cleanup' },
        });
        check('admin can restore the role', demote.status === 200, `HTTP ${demote.status}`);

        const wrongConfirm = await api(`/admin/users/${target.id}/wipe`, {
          method: 'POST',
          jar: admin,
          headers: CSRF,
          body: { confirmUsername: 'not-the-username' },
        });
        check('wipe refuses a wrong confirmation', wrongConfirm.status === 400, wrongConfirm.body?.error?.code ?? `HTTP ${wrongConfirm.status}`);

        const wipe = await api(`/admin/users/${target.id}/wipe`, {
          method: 'POST',
          jar: admin,
          headers: CSRF,
          body: { confirmUsername: username },
        });
        check('admin can wipe the account', wipe.status === 200 && wipe.body?.balance === 0, `balance ${wipe.body?.balance}`);
        check('wiped account can still sign in', (await signIn(username, PASSWORD)).status === 200);

        const audit = await api('/admin/audit?action=user.wipe&pageSize=5', { jar: admin });
        check(
          'wipe is recorded in the audit log',
          Boolean(audit.body?.items?.some((item) => item.targetId === target.id)),
          audit.body?.items?.[0]?.action ?? `HTTP ${audit.status}`,
        );

        if (mutateConfig) {
          // The account was just wiped to zero, so fund it through the admin
          // adjustment path before betting at the raised limit.
          const before = await api('/admin/games', { jar: admin });
          const current = before.body?.games?.find((game) => game.slug === 'mines');
          if (current) {
            const raised = Math.max(current.maxBet * 2, 5_000_000);
            const patch = await api('/admin/games/mines', {
              method: 'PATCH',
              jar: admin,
              headers: CSRF,
              body: { enabled: current.enabled, minBet: current.minBet, maxBet: raised, config: current.config },
            });
            const stored = patch.body?.game ?? {};
            const publicGames = await api('/games', { jar: player });
            const enforced = publicGames.body?.games?.find((game) => game.slug === 'mines')?.maxBet;
            check('wager limit change is stored and served', patch.status === 200 && stored.maxBet === raised && enforced === raised, `${money(current.maxBet)} → ${money(enforced ?? 0)}`);

            const topUp = await api(`/admin/users/${target.id}/adjust`, {
              method: 'POST',
              jar: admin,
              headers: CSRF,
              body: { amount: raised, reason: 'Smoke test: fund the wager-limit check', requestId: rid() },
            });
            check('admin can credit the wiped account', topUp.status === 200 && topUp.body?.balance === raised, `balance ${topUp.body?.balance}`);

            const highBet = await api('/games/mines/play', {
              method: 'POST',
              jar: player,
              headers: CSRF,
              body: { requestId: rid(), bet: raised, mines: 3 },
            });
            const accepted = highBet.status === 201;
            check(
              'the new limit is enforced by the API',
              accepted,
              `HTTP ${highBet.status}${highBet.body?.error?.code ? ` ${highBet.body.error.code}` : ''}`,
            );
            if (highBet.body?.session?.id) {
              // Close the round so the account is not left mid-hand.
              const sessionId = highBet.body.session.id;
              const firstTile = await api(`/games/sessions/${sessionId}/action`, {
                method: 'POST',
                jar: player,
                headers: CSRF,
                body: { requestId: rid(), action: 'reveal', tile: 0 },
              });
              if (firstTile.body?.session?.status === 'active') {
                await api(`/games/sessions/${sessionId}/action`, {
                  method: 'POST',
                  jar: player,
                  headers: CSRF,
                  body: { requestId: rid(), action: 'cashout' },
                });
              } else {
                await api(`/games/sessions/${sessionId}/acknowledge`, { method: 'POST', jar: player, headers: CSRF, body: {} });
              }
            }

            const restore = await api('/admin/games/mines', {
              method: 'PATCH',
              jar: admin,
              headers: CSRF,
              body: { enabled: current.enabled, minBet: current.minBet, maxBet: current.maxBet, config: current.config },
            });
            check('original wager limit restored', restore.status === 200 && restore.body?.game?.maxBet === current.maxBet);
          }
        } else {
          console.log('SKIP  wager-limit mutation (set SMOKE_MUTATE_CONFIG=true to include it)');
        }
      }
    }
  }

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} checks passed${failures ? `, ${failures} failed` : ''}.\n`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exitCode = 1;
});
