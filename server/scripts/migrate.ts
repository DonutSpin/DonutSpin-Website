import { getDatabase } from '../db/index.ts';
import { config } from '../config.ts';

const db = getDatabase();
const migrations = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all() as {
  version: number;
  name: string;
  applied_at: string;
}[];
const counts = {
  users: (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c,
  tickets: (db.prepare('SELECT COUNT(*) AS c FROM tickets').get() as { c: number }).c,
  cashier: (db.prepare('SELECT COUNT(*) AS c FROM cashier_requests').get() as { c: number }).c,
  ledger: (db.prepare('SELECT COUNT(*) AS c FROM ledger').get() as { c: number }).c,
  games: (db.prepare('SELECT COUNT(*) AS c FROM games').get() as { c: number }).c,
};
console.info(`Database: ${config.databasePath}`);
console.info(`Migrations applied: ${migrations.map((m) => `v${m.version} ${m.name}`).join(', ') || 'none'}`);
console.info(
  `Rows → users: ${counts.users}, tickets: ${counts.tickets}, cashier: ${counts.cashier}, ledger: ${counts.ledger}, games: ${counts.games}`,
);
db.close();
