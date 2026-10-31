import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { CHAT_MESSAGE_MAX_LENGTH, type ChatPostResponse, type ChatResponse } from '../../shared/types.ts';
import { createChatMessage, listChatMessages } from '../lib/chat.ts';
import { forbidden } from '../lib/core.ts';
import { requireActive, requireAuth } from '../lib/permissions.ts';
import { rainOverview } from '../lib/rain.ts';
import { parse } from '../lib/validation.ts';

const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a message first.')
    .max(CHAT_MESSAGE_MAX_LENGTH, `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters.`),
});

export function createChatRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const user = requireAuth(req);
    res.set('Cache-Control', 'no-store');
    const overview = rainOverview(db, user.id);
    const response: ChatResponse = {
      verified: user.emailVerified,
      // Unverified accounts can still see live rains, but never the messages.
      messages: user.emailVerified ? listChatMessages(db) : [],
      activeRains: overview.active,
      latestRain: overview.latest,
    };
    res.json(response);
  });

  router.post('/messages', (req, res) => {
    const user = requireActive(req);
    if (!user.emailVerified) {
      throw forbidden('Verify your email address to join the chat.', 'EMAIL_NOT_VERIFIED');
    }
    const body = parse(messageSchema, req.body);
    const response: ChatPostResponse = { message: createChatMessage(db, user, body.body) };
    res.status(201).json(response);
  });

  return router;
}
