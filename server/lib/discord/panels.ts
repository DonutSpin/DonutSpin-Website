import type { DB } from '../../db/index.ts';
import type {
  DiscordInfoChannelView,
  DiscordPanelLink,
  DiscordPanelView,
  SessionUser,
} from '../../../shared/types.ts';
import { badRequest, conflict, newId, notFound, nowIso, parseJson } from '../core.ts';
import { recordAudit } from '../audit.ts';
import {
  getPrimaryGuild,
  isDiscordSnowflake,
  isSafeImageUrl,
  recordDiscordActivity,
} from './core.ts';
import { queuePanelDelete, queuePanelEdit, queuePanelPost } from './events.ts';

interface InfoChannelRow {
  id: string;
  guild_id: string;
  name: string;
  category: string;
  channel_id: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  panel_count?: number;
}

interface PanelRow {
  id: string;
  guild_id: string;
  info_channel_id: string;
  channel_name: string;
  channel_category: string;
  config_channel_id: string;
  title: string;
  body: string;
  color: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  footer: string | null;
  links: string;
  mention_everyone: number;
  channel_id: string | null;
  message_id: string | null;
  status: 'published' | 'deleted';
  created_at: string;
  updated_at: string;
}

const PANEL_SELECT = `
  SELECT p.*, c.name AS channel_name, c.category AS channel_category, c.channel_id AS config_channel_id
    FROM discord_panels p
    JOIN discord_info_channels c ON c.id = p.info_channel_id`;

function mapChannel(row: InfoChannelRow): DiscordInfoChannelView {
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    category: row.category,
    channelId: row.channel_id,
    description: row.description,
    panelCount: Number(row.panel_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPanel(row: PanelRow): DiscordPanelView {
  return {
    id: row.id,
    guildId: row.guild_id,
    infoChannelId: row.info_channel_id,
    channelName: row.channel_name,
    category: row.channel_category,
    channelId: row.channel_id ?? row.config_channel_id,
    title: row.title,
    body: row.body,
    color: row.color,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    footer: row.footer,
    links: parseJson<DiscordPanelLink[]>(row.links, []),
    mentionEveryone: Boolean(row.mention_everyone),
    messageId: row.message_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function primaryGuildId(db: DB): string {
  const guild = getPrimaryGuild(db);
  if (!guild) {
    throw badRequest(
      'Connect the Discord bot to a server before adding update channels.',
      'DISCORD_NOT_CONNECTED',
    );
  }
  return guild.guild_id;
}

function cleanRequired(value: string, label: string, min: number, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw badRequest(`${label} must be between ${min} and ${max} characters.`, 'INVALID_INPUT', {
      fields: { [label.toLowerCase()]: `Use ${min}–${max} characters.` },
    });
  }
  return trimmed;
}

function cleanOptional(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeUrl(value: string | null | undefined, field: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  if (!isSafeImageUrl(trimmed)) {
    throw badRequest('Links must be public HTTPS URLs.', 'INVALID_URL', {
      fields: { [field]: 'Use an https:// URL.' },
    });
  }
  return trimmed;
}

function normalizeColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    throw badRequest('Use a six-digit hex colour such as #5865F2.', 'INVALID_COLOR', {
      fields: { color: 'Use a six-digit hex colour.' },
    });
  }
  return normalized.toUpperCase();
}

function cleanLinks(input: DiscordPanelLink[] | null | undefined): DiscordPanelLink[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 4).map((link, index) => {
    const label = String(link?.label ?? '').trim();
    const url = String(link?.url ?? '').trim();
    if (!label || label.length > 80) {
      throw badRequest('Button labels must be between 1 and 80 characters.', 'INVALID_LINK', {
        fields: { [`links.${index}.label`]: 'Use 1–80 characters.' },
      });
    }
    if (!normalizeUrl(url, `links.${index}.url`)) {
      throw badRequest('Button links are required.', 'INVALID_LINK', {
        fields: { [`links.${index}.url`]: 'Enter an https:// URL.' },
      });
    }
    return { label, url };
  });
}

function validatePanel(input: PanelInput): {
  title: string;
  body: string;
  color: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  footer: string | null;
  links: DiscordPanelLink[];
} {
  const title = cleanRequired(input.title, 'Title', 3, 120);
  const body = input.body.trim();
  if (body.length < 1 || body.length > 4_000) {
    throw badRequest('Panel copy must be between 1 and 4,000 characters.', 'INVALID_BODY', {
      fields: { body: 'Use 1–4,000 characters.' },
    });
  }
  return {
    title,
    body,
    color: normalizeColor(input.color),
    imageUrl: normalizeUrl(input.imageUrl, 'imageUrl'),
    thumbnailUrl: normalizeUrl(input.thumbnailUrl, 'thumbnailUrl'),
    footer: cleanOptional(input.footer, 200),
    links: cleanLinks(input.links),
  };
}

function getInfoChannelRow(db: DB, id: string, guildId: string): InfoChannelRow {
  const row = db
    .prepare('SELECT * FROM discord_info_channels WHERE id = ? AND guild_id = ?')
    .get(id, guildId) as InfoChannelRow | undefined;
  if (!row) throw notFound('Update channel not found.');
  return row;
}

function getPanelRow(db: DB, id: string): PanelRow | undefined {
  return db.prepare(`${PANEL_SELECT} WHERE p.id = ?`).get(id) as PanelRow | undefined;
}

export interface InfoChannelInput {
  name: string;
  category: string;
  channelId: string;
  description?: string | null;
}

export interface PanelInput {
  infoChannelId: string;
  title: string;
  body: string;
  color?: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  footer?: string | null;
  links?: DiscordPanelLink[] | null;
  mentionEveryone?: boolean;
}

export function listInfoChannels(db: DB, guildId?: string | null): DiscordInfoChannelView[] {
  const guild = guildId ?? getPrimaryGuild(db)?.guild_id ?? null;
  if (!guild) return [];
  const rows = db
    .prepare(
      `SELECT c.*, COUNT(p.id) AS panel_count
         FROM discord_info_channels c
         LEFT JOIN discord_panels p ON p.info_channel_id = c.id AND p.status = 'published'
        WHERE c.guild_id = ?
        GROUP BY c.id
        ORDER BY c.category COLLATE NOCASE, c.name COLLATE NOCASE`,
    )
    .all(guild) as InfoChannelRow[];
  return rows.map(mapChannel);
}

export function listPanels(
  db: DB,
  guildId?: string | null,
  options: { includeDeleted?: boolean } = {},
): DiscordPanelView[] {
  const guild = guildId ?? getPrimaryGuild(db)?.guild_id ?? null;
  if (!guild) return [];
  const where = options.includeDeleted ? 'p.guild_id = ?' : "p.guild_id = ? AND p.status = 'published'";
  const rows = db
    .prepare(
      `${PANEL_SELECT}
        WHERE ${where}
        ORDER BY c.category COLLATE NOCASE, c.name COLLATE NOCASE, p.created_at DESC`,
    )
    .all(guild) as PanelRow[];
  return rows.map(mapPanel);
}

export function getPanel(db: DB, id: string): DiscordPanelView | undefined {
  const row = getPanelRow(db, id);
  return row ? mapPanel(row) : undefined;
}

export function createInfoChannel(db: DB, user: SessionUser, input: InfoChannelInput): DiscordInfoChannelView {
  const guildId = primaryGuildId(db);
  const name = cleanRequired(input.name, 'Name', 2, 80);
  const category = cleanRequired(input.category, 'Category', 2, 50);
  if (!isDiscordSnowflake(input.channelId)) {
    throw badRequest('Use the numeric Discord channel ID.', 'INVALID_CHANNEL', {
      fields: { channelId: 'Paste the 17–20 digit channel ID.' },
    });
  }
  const duplicate = db
    .prepare('SELECT id FROM discord_info_channels WHERE guild_id = ? AND channel_id = ?')
    .get(guildId, input.channelId);
  if (duplicate) {
    throw conflict('That Discord channel is already registered as an update channel.', 'CHANNEL_ALREADY_ADDED');
  }
  const id = newId('dch');
  const now = nowIso();
  db.prepare(
    `INSERT INTO discord_info_channels
       (id, guild_id, name, category, channel_id, description, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    guildId,
    name,
    category,
    input.channelId,
    cleanOptional(input.description, 200),
    user.id,
    now,
    now,
  );
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.info_channel.create',
    targetType: 'discord_info_channel',
    targetId: id,
    targetLabel: name,
    metadata: { guildId, channelId: input.channelId, category },
  });
  recordDiscordActivity(db, {
    guildId,
    actorUserId: user.id,
    action: 'info_channel.added',
    summary: `${user.username} added the ${category} update channel #${name}`,
  });
  return mapChannel(getInfoChannelRow(db, id, guildId));
}

export function updateInfoChannel(
  db: DB,
  user: SessionUser,
  id: string,
  input: InfoChannelInput,
): DiscordInfoChannelView {
  const row = getInfoChannelRow(db, id, primaryGuildId(db));
  const name = cleanRequired(input.name, 'Name', 2, 80);
  const category = cleanRequired(input.category, 'Category', 2, 50);
  if (!isDiscordSnowflake(input.channelId)) {
    throw badRequest('Use the numeric Discord channel ID.', 'INVALID_CHANNEL', {
      fields: { channelId: 'Paste the 17–20 digit channel ID.' },
    });
  }
  if (input.channelId !== row.channel_id) {
    const duplicate = db
      .prepare('SELECT id FROM discord_info_channels WHERE guild_id = ? AND channel_id = ? AND id <> ?')
      .get(row.guild_id, input.channelId, id);
    if (duplicate) {
      throw conflict('That Discord channel is already registered as an update channel.', 'CHANNEL_ALREADY_ADDED');
    }
    const attached = db
      .prepare("SELECT COUNT(*) AS count FROM discord_panels WHERE info_channel_id = ? AND status = 'published'")
      .get(id) as { count: number };
    if (attached.count > 0) {
      throw conflict(
        'Delete this channel’s published panels before changing its Discord channel.',
        'CHANNEL_HAS_PANELS',
      );
    }
  }
  db.prepare(
    `UPDATE discord_info_channels
        SET name = ?, category = ?, channel_id = ?, description = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    name,
    category,
    input.channelId,
    cleanOptional(input.description, 200),
    nowIso(),
    id,
  );
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.info_channel.update',
    targetType: 'discord_info_channel',
    targetId: id,
    targetLabel: name,
    metadata: { guildId: row.guild_id, channelId: input.channelId, category },
  });
  recordDiscordActivity(db, {
    guildId: row.guild_id,
    actorUserId: user.id,
    action: 'info_channel.updated',
    summary: `${user.username} updated the ${category} update channel #${name}`,
  });
  return mapChannel(getInfoChannelRow(db, id, row.guild_id));
}

export function deleteInfoChannel(db: DB, user: SessionUser, id: string): { deletedPanels: number } {
  const row = getInfoChannelRow(db, id, primaryGuildId(db));
  const panelRows = db
    .prepare(`${PANEL_SELECT} WHERE p.info_channel_id = ? AND p.status = 'published'`)
    .all(id) as PanelRow[];
  for (const panel of panelRows) {
    queuePanelDelete(db, row.guild_id, mapPanel(panel));
  }
  db.prepare('DELETE FROM discord_info_channels WHERE id = ?').run(id);
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.info_channel.delete',
    targetType: 'discord_info_channel',
    targetId: id,
    targetLabel: row.name,
    metadata: { guildId: row.guild_id, channelId: row.channel_id, deletedPanels: panelRows.length },
  });
  recordDiscordActivity(db, {
    guildId: row.guild_id,
    actorUserId: user.id,
    action: 'info_channel.deleted',
    summary: `${user.username} removed the ${row.category} update channel #${row.name}`,
  });
  return { deletedPanels: panelRows.length };
}

export function createPanel(db: DB, user: SessionUser, input: PanelInput): DiscordPanelView {
  const guildId = primaryGuildId(db);
  const channel = getInfoChannelRow(db, input.infoChannelId, guildId);
  const clean = validatePanel(input);
  const id = newId('pnl');
  const now = nowIso();
  db.prepare(
    `INSERT INTO discord_panels
       (id, guild_id, info_channel_id, title, body, color, image_url, thumbnail_url, footer, links,
        mention_everyone, channel_id, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
  ).run(
    id,
    guildId,
    channel.id,
    clean.title,
    clean.body,
    clean.color,
    clean.imageUrl,
    clean.thumbnailUrl,
    clean.footer,
    JSON.stringify(clean.links),
    input.mentionEveryone ? 1 : 0,
    channel.channel_id,
    user.id,
    now,
    now,
  );
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.panel.create',
    targetType: 'discord_panel',
    targetId: id,
    targetLabel: clean.title,
    metadata: { guildId, channelId: channel.channel_id, category: channel.category },
  });
  recordDiscordActivity(db, {
    guildId,
    actorUserId: user.id,
    action: 'panel.published',
    summary: `${user.username} published the ${channel.category} panel “${clean.title}”`,
  });
  const view = getPanel(db, id);
  if (!view) throw notFound('Panel not found.');
  queuePanelPost(db, guildId, view);
  return view;
}

export function updatePanel(db: DB, user: SessionUser, id: string, input: PanelInput): DiscordPanelView {
  const row = getPanelRow(db, id);
  if (!row) throw notFound('Panel not found.');
  if (row.status === 'deleted') throw conflict('This panel was deleted.', 'PANEL_DELETED');
  const channel = getInfoChannelRow(db, input.infoChannelId, row.guild_id);
  const clean = validatePanel(input);
  const before = mapPanel(row);
  const moving = channel.id !== row.info_channel_id;
  if (moving && row.message_id) {
    queuePanelDelete(db, row.guild_id, before);
  }
  const now = nowIso();
  db.prepare(
    `UPDATE discord_panels SET
       info_channel_id = ?, title = ?, body = ?, color = ?, image_url = ?, thumbnail_url = ?,
       footer = ?, links = ?, mention_everyone = ?, channel_id = ?, message_id = ?, updated_at = ?
     WHERE id = ? AND status = 'published'`,
  ).run(
    channel.id,
    clean.title,
    clean.body,
    clean.color,
    clean.imageUrl,
    clean.thumbnailUrl,
    clean.footer,
    JSON.stringify(clean.links),
    input.mentionEveryone ? 1 : 0,
    channel.channel_id,
    moving ? null : row.message_id,
    now,
    id,
  );
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.panel.update',
    targetType: 'discord_panel',
    targetId: id,
    targetLabel: clean.title,
    metadata: { guildId: row.guild_id, channelId: channel.channel_id, category: channel.category },
  });
  recordDiscordActivity(db, {
    guildId: row.guild_id,
    actorUserId: user.id,
    action: 'panel.edited',
    summary: `${user.username} updated the ${channel.category} panel “${clean.title}”`,
  });
  const view = getPanel(db, id);
  if (!view) throw notFound('Panel not found.');
  if (view.messageId) queuePanelEdit(db, row.guild_id, view);
  else queuePanelPost(db, row.guild_id, view);
  return view;
}

export function deletePanel(db: DB, user: SessionUser, id: string): DiscordPanelView {
  const row = getPanelRow(db, id);
  if (!row) throw notFound('Panel not found.');
  const view = mapPanel(row);
  if (view.status === 'deleted') return view;
  db.prepare("UPDATE discord_panels SET status = 'deleted', updated_at = ? WHERE id = ?").run(nowIso(), id);
  recordAudit(db, {
    actorId: user.id,
    action: 'discord.panel.delete',
    targetType: 'discord_panel',
    targetId: id,
    targetLabel: view.title,
    metadata: { guildId: view.guildId, channelId: view.channelId },
  });
  recordDiscordActivity(db, {
    guildId: view.guildId,
    actorUserId: user.id,
    action: 'panel.deleted',
    summary: `${user.username} deleted the ${view.category} panel “${view.title}”`,
  });
  queuePanelDelete(db, view.guildId, view);
  return getPanel(db, id) ?? view;
}
