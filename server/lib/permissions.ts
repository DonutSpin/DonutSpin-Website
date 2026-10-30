import { roleHasPermission, type Permission, type Role } from '../../shared/types.ts';
import { forbidden, unauthorized, type ApiError } from './core.ts';
import { isSelfExclusionActive } from './legal.ts';
import type { Request, Response, NextFunction } from 'express';

export function can(role: Role, permission: Permission): boolean {
  return roleHasPermission(role, permission);
}

export function requireAuth(req: Request): NonNullable<Request['user']> {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requirePermission(req: Request, permission: Permission) {
  const user = requireAuth(req);
  if (!can(user.role, permission)) throw forbidden('Your role does not include this permission.');
  return user;
}

export function permissionMiddleware(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      requirePermission(req, permission);
      next();
    } catch (error) {
      next(error as ApiError);
    }
  };
}

export function requireActive(req: Request) {
  const user = requireAuth(req);
  if (user.status === 'suspended') throw forbidden('This account is suspended.', 'ACCOUNT_SUSPENDED');
  if (user.status === 'restricted') throw forbidden('This account is restricted. Contact support.', 'ACCOUNT_RESTRICTED');
  if (isSelfExclusionActive(user.selfExcludedUntil)) {
    throw forbidden('This account is self-excluded and cannot access the platform right now.', 'SELF_EXCLUDED');
  }
  return user;
}
