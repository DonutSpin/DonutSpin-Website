import type { DB } from '../db/index.ts';
import type { ChatMessage } from '../../shared/types.ts';
import { CHAT_MESSAGE_MAX_LENGTH } from '../../shared/types.ts';
import { ApiError, badRequest, newId, nowIso } from './core.ts';
import { chatMessageLimiter } from './rate-limit.ts';

interface ChatRow {
  id: string;
  user_id: string | null;
  username: string;
  body: string;
  created_at: string;
}

function mapChatRow(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    body: row.body,
    createdAt: row.created_at,
  };
}

/** Newest messages, returned oldest-first so the browser can append directly. */
export function listChatMessages(db: DB, limit = 80): ChatMessage[] {
  const safeLimit = Math.min(150, Math.max(1, limit));
  const rows = db
    .prepare(
      `SELECT id, user_id, username, body, created_at
         FROM chat_messages
        ORDER BY created_at DESC, rowid DESC
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

  const id = newId('chat');
  const createdAt = nowIso();
  db.prepare(
    'INSERT INTO chat_messages (id, user_id, username, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, user.id, user.username, body, createdAt);

  return {
    id,
    userId: user.id,
    username: user.username,
    body,
    createdAt,
  };
}
