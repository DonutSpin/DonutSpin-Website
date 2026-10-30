import express, { type ErrorRequestHandler, type Request } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ZodError } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db/index.ts';
import { config } from './config.ts';
import { ApiError } from './lib/core.ts';
import { authMiddleware } from './auth.ts';
import { callerKey, mutationLimiter } from './lib/rate-limit.ts';
import { createPublicRouter } from './routes/public.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createLegalRouter } from './routes/legal.ts';
import { createMeRouter } from './routes/me.ts';
import { createGamesRouter } from './routes/games.ts';
import { createTicketsRouter } from './routes/tickets.ts';
import { createCashierRouter, createAdminCashierRouter } from './routes/cashier.ts';
import { createStaffRouter } from './routes/staff.ts';
import { createAdminRouter } from './routes/admin.ts';
import { createAdminConfigRouter } from './routes/admin-config.ts';
import { createRewardsRouter } from './routes/rewards.ts';
import { createAdminRewardsRouter } from './routes/admin-rewards.ts';
import { createAdminEmailRouter } from './routes/admin-email.ts';

/**
 * A request is same-origin when the browser's Origin host matches the host the
 * request was actually addressed to. Proxies such as IIS forward the public
 * host in Host or X-Forwarded-Host, so both are considered.
 */
function isSameOrigin(req: Request, origin: string): boolean {
  try {
    const target = new URL(origin);
    const candidates = [req.get('host'), req.get('x-forwarded-host')?.split(',')[0]?.trim()];
    return candidates.some((host) => Boolean(host) && target.host.toLowerCase() === host!.toLowerCase());
  } catch {
    return false;
  }
}

/** Paths that must never be answered by the SPA fallback. */
const PRIVATE_PREFIXES = ['/data', '/server', '/build', '/node_modules', '/shared', '/tests', '/src', '/.git', '/logs'];

function isPrivatePath(urlPath: string): boolean {
  const segments = urlPath.toLowerCase().split('?')[0] ?? '';
  if (segments === '/.env' || segments.startsWith('/.env')) return true;
  return PRIVATE_PREFIXES.some((prefix) => segments === prefix || segments.startsWith(`${prefix}/`));
}

export function createApp(db: DB): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '128kb' }));
  app.use(cookieParser(config.sessionSecret || undefined));

  // CSRF hardening: state-changing requests must come from the app, carry a
  // custom header, and not originate from another site.
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('x-requested-with') !== 'donutcash') {
      return next(new ApiError(403, 'CSRF_HEADER', 'This request is missing the required application header.'));
    }
    const origin = req.get('origin');
    if (origin && !config.allowedOrigins.includes(origin) && !isSameOrigin(req, origin)) {
      return next(new ApiError(403, 'ORIGIN_BLOCKED', 'This origin is not allowed to perform that action.'));
    }
    if (config.isProduction && !mutationLimiter.consume(callerKey(req, 'mutate')).allowed) {
      return next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.'));
    }
    next();
  });

  app.use(authMiddleware(db));

  // Authenticated accounts must accept the current legal versions before any
  // private API becomes available. Public config, auth, and legal actions must
  // stay reachable so the consent screen can render and be submitted.
  app.use('/api', (req, _res, next) => {
    if (!req.user?.legalAcceptanceRequired) return next();
    if (req.path.startsWith('/auth') || req.path.startsWith('/legal') || req.path.startsWith('/public')) return next();
    // Self-exclusion must stay reachable even when new terms are pending.
    if (req.method === 'POST' && req.path === '/me/self-exclusion') return next();
    return next(
      new ApiError(
        403,
        'LEGAL_ACCEPTANCE_REQUIRED',
        'Accept the current Terms of Service and Privacy Policy to continue.',
      ),
    );
  });

  app.use('/api/public', createPublicRouter(db));
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/legal', createLegalRouter(db));
  app.use('/api/me', createMeRouter(db));
  app.use('/api/games', createGamesRouter(db));
  app.use('/api/rewards', createRewardsRouter(db));
  app.use('/api/tickets', createTicketsRouter(db));
  app.use('/api/cashier', createCashierRouter(db));
  app.use('/api/staff', createStaffRouter(db));
  app.use('/api/admin', createAdminRouter(db));
  app.use('/api/admin', createAdminConfigRouter(db));
  app.use('/api/admin', createAdminRewardsRouter(db));
  app.use('/api/admin', createAdminEmailRouter(db));
  app.use('/api/admin/cashier', createAdminCashierRouter(db));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
  });

  // Serve the built client whenever it is present. On IIS/HttpPlatformHandler the
  // Node process is the only thing in front of the site, so the SPA fallback has
  // to live here instead of in web.config.
  const clientDir = path.resolve(config.clientDist);
  const clientIndex = path.join(clientDir, 'index.html');
  if (fs.existsSync(clientIndex)) {
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      if (isPrivatePath(req.path)) return next();
      res.sendFile(clientIndex, (error) => {
        if (error) next(error);
      });
    });
  } else if (config.isProduction) {
    console.warn(`[api] no client build found at ${clientIndex}; only the API will be served. Run \`npm run build\`.`);
  }

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ApiError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details ?? undefined },
      });
      return;
    }
    if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.length ? issue.path.join('.') : '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Please check the highlighted fields.', details: { fields } },
      });
      return;
    }
    const type = (error as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' } });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read.' } });
      return;
    }
    console.error(`[api] ${req.method} ${req.originalUrl} failed:`, error);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' },
    });
  };
  app.use(errorHandler);

  return app;
}
