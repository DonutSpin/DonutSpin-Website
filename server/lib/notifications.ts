import type { DB } from '../db/index.ts';
import type { NotificationItem } from '../../shared/types.ts';
import { newId, nowIso } from './core.ts';

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  actorId?: string | null;
}

export function notify(db: DB, input: NotificationInput): string {
  const id = newId('ntf');
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, link, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.userId, input.type, input.title, input.body, input.link ?? null, input.actorId ?? null, nowIso());
  return id;
}

export function mapNotification(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function unreadNotificationCount(db: DB, userId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as {
      count: number;
    }
  ).count;
}
