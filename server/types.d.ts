import type { SessionUser } from '../shared/types.ts';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

export {};
