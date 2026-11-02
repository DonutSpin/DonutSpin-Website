import type { DB } from '../../db/index.ts';
import type {
  DiscordAnnouncementKind,
  DiscordAnnouncementView,
  DiscordChangelogSections,
  SessionUser,
} from '../../../shared/types.ts';
import { badRequest, conflict, newId, notFound, nowIso, parseJson } from '../core.ts';
import { recordAudit } from '../audit.ts';
import {
  getGuildConfig,
  getPrimaryGuild,
  isSafeImageUrl,
  recordDiscordActivity,
} from './core.ts';
import {
  queueAnnouncementDelete,
  queueAnnouncementEdit,
  queueAnnouncementPost,
} from './events.ts';

interface AnnouncementRow {
  id: string;
  guild_id: string;
  kind: DiscordAnnouncementKind;
  title: string;
  body: string | null;
  sections: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  footer: string | null;
  author: string | null;
  color: string | null;
  emoji: string | null;
  mention_everyone: number;
  channel_id: string | null;
  message_id: string | null;
  status: 'published' | 'deleted';
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const EMPTY_SECTIONS: DiscordChangelogSections = {
  features: [],
  improvements: [],
  fixes: [],
  removed: [],
  other: [],
};

function mapAnnouncement(row: AnnouncementRow): DiscordAnnouncementView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    sections: row.sections ? parseJson<DiscordChangelogSections>(row.sections, EMPTY_SECTIONS) : null,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    footer: row.footer,
    author: row.author,
    color: row.color,
    emoji: row.emoji,
    mentionEveryone: Boolean(row.mention_everyone),
    channelId: row.channel_id,
    messageId: row.message_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AnnouncementInput {
  title: string;
  body?: string | null;
  sections?: DiscordChangelogSections | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  footer?: string | null;
  author?: string | null;
  color?: string | null;
  emoji?: string | null;
  mentionEveryone?: boolean;
}

function cleanOptional(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeUrl(value: string | null | undefined, field: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  if (!isSafeImageUrl(trimmed)) {
    throw badRequest('Image links must be public HTTPS URLs.', 'INVALID_IMAGE_URL', {
      fields: { [field]: 'Use an https:// image URL.' },
    });
  }
  return trimmed;
}

function normalizeColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    throw badRequest('Use a six-digit hex colour such as #E6C27A.', 'INVALID_COLOR', {
      fields: { color: 'Use a six-digit hex colour.' },
    });
  }
  return normalized.toUpperCase();
}

function cleanSections(input: DiscordChangelogSections | null | undefined): DiscordChangelogSections {
  const result: DiscordChangelogSections = { ...EMPTY_SECTIONS };
  if (!input) return result;
  for (const key of Object.keys(EMPTY_SECTIONS) as (keyof DiscordChangelogSections)[]) {
    const list = Array.isArray(input[key]) ? input[key] : [];
    result[key] = list
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((item) => item.slice(0, 400));
  }
  return result;
}

function sectionsEmpty(sections: DiscordChangelogSections): boolean {
  return Object.values(sections).every((list) => list.length === 0);
}

function validateInput(kind: DiscordAnnouncementKind, input: AnnouncementInput): {
  title: string;
  body: string | null;
  sections: DiscordChangelogSections | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footer: string | null;
  author: string | null;
  color: string | null;
  emoji: string | null;
} {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 120) {
    throw badRequest('Use a title between 3 and 120 characters.', 'INVALID_TITLE', {
      fields: { title: 'Use 3–120 characters.' },
    });
  }
  let body: string | null = null;
  let sections: DiscordChangelogSections | null = null;
  if (kind === 'news') {
    body = input.body?.trim() ?? '';
    if (body.length < 10 || body.length > 4000) {
      throw badRequest('News copy must be between 10 and 4,000 characters.', 'INVALID_BODY', {
        fields: { body: 'Use 10–4,000 characters.' },
      });
    }
  } else {
    sections = cleanSections(input.sections);
    if (sectionsEmpty(sections)) {
      throw badRequest('Add at least one changelog item.', 'EMPTY_CHANGELOG', {
        fields: { sections: 'Add at least one item to one section.' },
      });
    }
  }
  const imageUrl = normalizeUrl(input.imageUrl, 'imageUrl');
  const thumbnailUrl = normalizeUrl(input.thumbnailUrl, 'thumbnailUrl');
  return {
    title,
    body,
    sections,
    imageUrl,
    thumbnailUrl,
    footer: cleanOptional(input.footer, 200),
    author: cleanOptional(input.author, 100),
    color: normalizeColor(input.color),
    emoji: cleanOptional(input.emoji, 20),
  };
}

export function getAnnouncement(db: DB, id: string): DiscordAnnouncementView | undefined {
  const row = db.prepare('SELECT * FROM discord_announcements WHERE id = ?').get(id) as
    | AnnouncementRow
    | undefined;
  return row ? mapAnnouncement(row) : undefined;
}

export function listAnnouncements(
  db: DB,
  options: { kind?: DiscordAnnouncementKind; limit?: number; includeDeleted?: boolean } = {},
): DiscordAnnouncementView[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.kind) {
    clauses.push('kind = ?');
    params.push(options.kind);
  }
  if (!options.includeDeleted) clauses.push("status = 'published'");
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM discord_announcements ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, Math.min(100, Math.max(1, options.limit ?? 25))) as AnnouncementRow[];
  return rows.map(mapAnnouncement);
}

export function createAnnouncement(
  db: DB,
  user: SessionUser,
  kind: DiscordAnnouncementKind,
  input: AnnouncementInput,
  options: { guildId?: string | null },
): DiscordAnnouncementView {
  const guildId = options.guildId ?? getPrimaryGuild(db)?.guild_id ?? null;
  if (!guildId) {
    throw badRequest('Connect the Discord bot to a server before publishing announcements.', 'DISCORD_NOT_CONNECTED');
  }
  const clean = validateInput(kind, input);
  const config = getGuildConfig(db, guildId);
  const channelId = kind === 'news' ? config.channels.news : config.channels.changelog;
  const mentionEveryone = input.mentionEveryone ?? config.announcementEveryone;
  const id = newId('ann');
  const now = nowIso();
  db.prepare(
    `INSERT INTO discord_announcements
       (id, guild_id, kind, title, body, sections, image_url, thumbnail_url, footer, author, color, emoji,
        mention_everyone, channel_id, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
  ).run(
    id,
    guildId,
    kind,
    clean.title,
    clean.body,
    clean.sections ? JSON.stringify(clean.sections) : null,
    clean.imageUrl,
    clean.thumbnailUrl,
    clean.footer,
    clean.author,
    clean.color,
    clean.emoji,
    mentionEveryone ? 1 : 0,
    channelId,
    user.id,
    now,
    now,
  );
  recordAudit(db, {
    actorId: user.id,
    action: `${kind}.create`,
    targetType: 'discord_announcement',
    targetId: id,
    targetLabel: clean.title,
    metadata: { guildId, channelId, mentionEveryone },
  });
  recordDiscordActivity(db, {
    guildId,
    actorUserId: user.id,
    action: `${kind}.published`,
    summary: `${user.username} published ${kind === 'news' ? 'news' : 'a changelog'}: ${clean.title}`,
  });
  const view = getAnnouncement(db, id);
  if (!view) throw notFound('Announcement not found.');
  queueAnnouncementPost(db, guildId, view);
  return view;
}

export function updateAnnouncement(
  db: DB,
  user: SessionUser,
  id: string,
  input: AnnouncementInput,
): DiscordAnnouncementView {
  const row = db.prepare('SELECT * FROM discord_announcements WHERE id = ?').get(id) as
    | AnnouncementRow
    | undefined;
  if (!row) throw notFound('Announcement not found.');
  if (row.status === 'deleted') throw conflict('This announcement was deleted.', 'ANNOUNCEMENT_DELETED');
  const clean = validateInput(row.kind, input);
  const config = getGuildConfig(db, row.guild_id);
  const mentionEveryone = input.mentionEveryone ?? Boolean(row.mention_everyone);
  const channelId = row.kind === 'news' ? config.channels.news : config.channels.changelog;
  const now = nowIso();
  db.prepare(
    `UPDATE discord_announcements SET
       title = ?, body = ?, sections = ?, image_url = ?, thumbnail_url = ?, footer = ?, author = ?,
       color = ?, emoji = ?, mention_everyone = ?, channel_id = ?, updated_at = ?
     WHERE id = ? AND status = 'published'`,
  ).run(
    clean.title,
    clean.body,
    clean.sections ? JSON.stringify(clean.sections) : null,
    clean.imageUrl,
    clean.thumbnailUrl,
    clean.footer,
    clean.author,
    clean.color,
    clean.emoji,
    mentionEveryone ? 1 : 0,
    channelId ?? row.channel_id,
    now,
    id,
  );
  recordAudit(db, {
    actorId: user.id,
    action: `${row.kind}.update`,
    targetType: 'discord_announcement',
    targetId: id,
    targetLabel: clean.title,
    metadata: { guildId: row.guild_id, mentionEveryone },
  });
  recordDiscordActivity(db, {
    guildId: row.guild_id,
    actorUserId: user.id,
    action: `${row.kind}.edited`,
    summary: `${user.username} edited ${row.kind === 'news' ? 'news' : 'a changelog'}: ${clean.title}`,
  });
  const view = getAnnouncement(db, id);
  if (!view) throw notFound('Announcement not found.');
  if (view.messageId) queueAnnouncementEdit(db, row.guild_id, view);
  else queueAnnouncementPost(db, row.guild_id, view);
  return view;
}

export function deleteAnnouncement(db: DB, user: SessionUser, id: string): DiscordAnnouncementView {
  const view = getAnnouncement(db, id);
  if (!view) throw notFound('Announcement not found.');
  if (view.status === 'deleted') return view;
  const now = nowIso();
  db.prepare("UPDATE discord_announcements SET status = 'deleted', updated_at = ? WHERE id = ?").run(now, id);
  recordAudit(db, {
    actorId: user.id,
    action: `${view.kind}.delete`,
    targetType: 'discord_announcement',
    targetId: id,
    targetLabel: view.title,
    metadata: { guildId: view.channelId ? undefined : undefined },
  });
  recordDiscordActivity(db, {
    actorUserId: user.id,
    action: `${view.kind}.deleted`,
    summary: `${user.username} deleted ${view.kind === 'news' ? 'news' : 'a changelog'}: ${view.title}`,
  });
  const row = db.prepare('SELECT guild_id FROM discord_announcements WHERE id = ?').get(id) as {
    guild_id: string;
  };
  queueAnnouncementDelete(db, row.guild_id, view);
  return getAnnouncement(db, id) ?? { ...view, status: 'deleted', updatedAt: now };
}
