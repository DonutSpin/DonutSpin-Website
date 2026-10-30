import type { DB } from '../db/index.ts';
import { getSetting } from '../db/index.ts';
import { ApiError } from './core.ts';

export const DEFAULT_MAINTENANCE_MESSAGE = 'We are tuning the tables. Please try again shortly.';

export function isMaintenanceMode(db: DB): boolean {
  return getSetting(db, 'platform.maintenance', false);
}

export function maintenanceMessage(db: DB): string {
  return getSetting(db, 'platform.maintenance_message', DEFAULT_MAINTENANCE_MESSAGE);
}

/**
 * Player-facing writes that move credits or create commitments must fail while
 * maintenance is active. Staff reads and support workflows stay available.
 */
export function assertNotInMaintenance(db: DB): void {
  if (isMaintenanceMode(db)) {
    throw new ApiError(503, 'MAINTENANCE', 'The platform is in maintenance mode. Please try again later.');
  }
}
