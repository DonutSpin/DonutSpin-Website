import type { DB } from '../db/index.ts';
import type { ChatMessage, Role } from '../../shared/types.ts';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../shared/types.ts';
import { ApiError, badRequest, newId, nowIso } from './core.ts';
import { chatMessageLimiter } from './rate-limit.ts';

interface ChatRow {
  id: string;
  user_id: string | null;
  username: string;
  role: Role;
  body: string;
  created_at: string;
}

function mapChatRow(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    role: row.role,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Newest messages, returned oldest-first so the browser can append directly. */
export function listChatMessages(db: DB, limit = 80): ChatMessage[] {
  const safeLimit = Math.min(150, Math.max(1, limit));
  const rows = db
    .prepare(
      `SELECT m.id, m.user_id, m.username, COALESCE(u.role, 'user') AS role, m.body, m.created_at
         FROM chat_messages m
         LEFT JOIN users u ON u.id = m.user_id
        ORDER BY m.created_at DESC, m.rowid DESC
        LIMIT ?`,
    )
    .all(safeLimit) as ChatRow[];
  return rows.reverse().map(mapChatRow);
}

export function createChatMessage(db: DB, user: { id: string; username: string }, rawBody: string): ChatMessage {
  // Chat is a single-line stream; collapse newlines and repeated spaces so a
  // message cannot stretch the narrow panel or impersonate a block of text.
  const body = rawBody.replace(/\s+/g, ' ').trim();
  if (!body) throw badRequest('Write a message first.', 'CHAT_MESSAGE_EMPTY');
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw badRequest(
      `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters.`,
      'CHAT_MESSAGE_TOO_LONG',
    );
  }

  const limit = chatMessageLimiter.consume(`chat:user:${user.id}`);
  if (!limit.allowed) {
    throw new ApiError(429, 'CHAT_RATE_LIMITED', 'You are sending messages too quickly. Try again shortly.', {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  // Never trust a cached role on the session: resolve the current role from the
  // same row the permission system uses, so a promotion or demotion is visible
  // on the very next message and cannot be spoofed by the client.
  const roleRow = db.prepare('SELECT role FROM users WHERE id = ?').get(user.id) as { role: Role } | undefined;
  if (!roleRow) throw badRequest('Your account could not be found.', 'ACCOUNT_NOT_FOUND');

  const id = newId('chat');
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO chat_messages (id, user_id, username, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, user.id, user.username, body, createdAt);

  return {
    id,
    userId: user.id,
    username: user.username,
    role: roleRow.role,
    body,
    createdAt,
  };
}
