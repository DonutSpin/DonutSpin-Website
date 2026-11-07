import { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  CircleOff,
  Coins,
  FileText,
  Gift,
  Hash,
  Link2,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  TicketPercent,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react';
import {
  type DiscordAnnouncementKind,
  type DiscordAnnouncementView,
  type DiscordGuildConfig,
  type DiscordInfoChannelView,
  type DiscordOverviewResponse,
  type DiscordPanelLink,
  type DiscordPanelView,
  type RewardCodeView,
} from '../../../shared/types';
import { useToast } from '../../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { dateTime, money, timeAgo } from '../../lib/format';
import { useApiQuery } from '../../lib/useApi';
import { PageHeader } from '../../components/layout';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Progress,
  Select,
  StatCard,
  Tabs,
  Textarea,
  Toggle,
  cn,
} from '../../components/ui';

type TabKey = 'overview' | 'config' | 'announcements' | 'panels' | 'codes' | 'activity';

const CHANNEL_FIELDS: { key: keyof DiscordGuildConfig['channels']; label: string; hint: string }[] = [
  { key: 'welcome', label: 'Welcome channel', hint: 'Member welcomes and invite attribution.' },
  { key: 'vouches', label: 'Vouches channel', hint: 'Positive vouch embeds.' },
  { key: 'scamVouches', label: 'Scam vouch channel', hint: 'Falls back to the vouch channel when blank.' },
  { key: 'invites', label: 'Invite rewards channel', hint: 'Text channel for the panel and personal invite links. Blank uses a channel named invite-rewards.' },
  { key: 'codes', label: 'Codes channel', hint: 'New code announcements with @everyone.' },
  { key: 'giveaways', label: 'Giveaway channel', hint: 'Live giveaway messages and results.' },
  { key: 'news', label: 'News channel', hint: 'Platform news embeds.' },
  { key: 'changelog', label: 'Changelog channel', hint: 'Website update embeds.' },
  { key: 'logs', label: 'Activity log channel', hint: 'Optional staff audit mirror.' },
  { key: 'tickets', label: 'Ticket notifications (#tickets)', hint: 'New tickets and staff replies that need attention. Roles are pinged with real mentions.' },
  { key: 'ticketTranscripts', label: 'Ticket transcripts (#ticket-transcripts)', hint: 'One embed per closed ticket, linking to the website transcript. Staff-only channel.' },
  { key: 'cashierRequests', label: 'Cashier requests (#cashier-requests)', hint: 'Every cashier request and status change.' },
  { key: 'cashierTranscripts', label: 'Cashier transcripts (#cashier-transcripts)', hint: 'One embed per decided cashier request, linking to the website transcript. Staff-only channel.' },
];

const ROLE_FIELDS: { key: keyof DiscordGuildConfig['roles']; label: string }[] = [
  { key: 'owner', label: 'Owner roles' },
  { key: 'admin', label: 'Admin roles' },
  { key: 'staff', label: 'Staff roles' },
  { key: 'moderator', label: 'Moderator roles' },
];

function idList(ids: string[]): string {
  return ids.join(', ');
}

function parseIdList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function codeTone(status: RewardCodeView['status']): 'success' | 'warning' | 'danger' | 'neutral' | 'gold' {
  return status === 'active' ? 'success' : status === 'exhausted' ? 'warning' : status === 'disabled' ? 'danger' : status === 'expired' ? 'neutral' : 'gold';
}

function ConfigPanel({ config, onSaved }: { config: DiscordGuildConfig; onSaved: () => void }) {
  const { success, error: toastError } = useToast();
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [rewardsEnabled, setRewardsEnabled] = useState(config.inviteRewardsEnabled);
  const [rewardEvery, setRewardEvery] = useState(String(config.inviteRewardEvery));
  const [rewardAmount, setRewardAmount] = useState<number | ''>(config.inviteRewardAmount);
  const [panelTitle, setPanelTitle] = useState(config.invitePanelTitle);
  const [panelBody, setPanelBody] = useState(config.invitePanelBody);
  const [copyMessage, setCopyMessage] = useState(config.inviteCopyMessage);
  const [announcementEveryone, setAnnouncementEveryone] = useState(config.announcementEveryone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChannels(
      Object.fromEntries(
        CHANNEL_FIELDS.map((field) => [field.key, config.channels[field.key] ?? '']),
      ),
    );
    setRoles(Object.fromEntries(ROLE_FIELDS.map((field) => [field.key, idList(config.roles[field.key])])));
    setRewardsEnabled(config.inviteRewardsEnabled);
    setRewardEvery(String(config.inviteRewardEvery));
    setRewardAmount(config.inviteRewardAmount);
    setPanelTitle(config.invitePanelTitle);
    setPanelBody(config.invitePanelBody);
    setCopyMessage(config.inviteCopyMessage);
    setAnnouncementEveryone(config.announcementEveryone);
    // Deliberately keyed to the saved revision, not the object identity, so a
    // background refresh cannot erase form edits that have not been saved yet.
  }, [config.guildId, config.updatedAt]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.patch('/admin/discord/config', {
        guildId: config.guildId,
        channels: Object.fromEntries(
          CHANNEL_FIELDS.map((field) => [field.key, channels[field.key]?.trim() || null]),
        ),
        roles: Object.fromEntries(
          ROLE_FIELDS.map((field) => [field.key, parseIdList(roles[field.key] ?? '')]),
        ),
        inviteRewardsEnabled: rewardsEnabled,
        inviteRewardEvery: Number(rewardEvery),
        inviteRewardAmount: Number(rewardAmount || 0),
        invitePanelTitle: panelTitle,
        invitePanelBody: panelBody,
        inviteCopyMessage: copyMessage,
        announcementEveryone,
      });
      success('Discord configuration saved', 'The bot reads these values on its next request.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not save Discord configuration', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <Card>
        <CardHeader
          title="Channels"
          description="Paste Discord channel IDs. The /setup panel in Discord does the same thing with channel pickers."
        />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          {CHANNEL_FIELDS.map((field) => (
            <Field key={field.key} label={field.label} hint={field.hint}>
              <Input
                value={channels[field.key] ?? ''}
                onChange={(event) => setChannels((value) => ({ ...value, [field.key]: event.target.value }))}
                placeholder="123456789012345678"
                inputMode="numeric"
                className="font-mono text-[12px]"
              />
            </Field>
          ))}
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Staff roles" description="A linked website role and a configured Discord role are both required." />
          <div className="space-y-4 p-5">
            {ROLE_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint="Comma-separated role IDs; leave blank until you are ready.">
                <Input
                  value={roles[field.key] ?? ''}
                  onChange={(event) => setRoles((value) => ({ ...value, [field.key]: event.target.value }))}
                  placeholder="123456789012345678, 234567890123456789"
                  className="font-mono text-[11px]"
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Invite rewards"
            description="The panel, reward, and Copy message are stored here. The bot edits its own panel in the invite channel within about 30 seconds, and after every restart."
          />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Enable invite rewards</p>
                <p className="mt-0.5 text-[11px] text-muted">Joins are tracked even when rewards are off.</p>
              </div>
              <Toggle checked={rewardsEnabled} onChange={setRewardsEnabled} label="Invite rewards" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Invites per reward" hint="Example: 3.">
                <Input type="number" min={1} max={100} value={rewardEvery} onChange={(event) => setRewardEvery(event.target.value)} />
              </Field>
              <Field label="Reward amount" hint="Credited to the inviter's DonutSpin wallet.">
                <AmountInput value={rewardAmount} onChange={setRewardAmount} min={1} />
              </Field>
            </div>
            <Field label="Panel title" hint="Shown at the top of the embed in the invite channel.">
              <Input value={panelTitle} onChange={(event) => setPanelTitle(event.target.value)} maxLength={120} />
            </Field>
            <Field
              label="Panel text"
              hint="Use {INVITES} for the invite threshold and {REWARD} for the reward so the copy follows these settings."
            >
              <Textarea value={panelBody} onChange={(event) => setPanelBody(event.target.value)} rows={8} maxLength={3900} />
            </Field>
            <Field
              label="Copy button message"
              hint="Sent only to the member who clicks Copy, inside a code block. {INVITE_LINK} becomes their personal link."
            >
              <Textarea value={copyMessage} onChange={(event) => setCopyMessage(event.target.value)} rows={14} maxLength={1800} />
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Mention @everyone by default</p>
                <p className="mt-0.5 text-[11px] text-muted">Applies to news and changelog announcements. Codes always mention @everyone.</p>
              </div>
              <Toggle checked={announcementEveryone} onChange={setAnnouncementEveryone} label="Mention everyone" />
            </div>
          </div>
        </Card>
      </div>

      <div className="xl:col-span-2">
        {error && (
          <Alert tone="error" className="mb-3">
            {error}
          </Alert>
        )}
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save configuration
          </Button>
        </div>
      </div>
    </div>
  );
}

function AnnouncementModal({
  open,
  onClose,
  announcement,
  defaultMentionEveryone,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  announcement: DiscordAnnouncementView | null;
  defaultMentionEveryone: boolean;
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [kind, setKind] = useState<DiscordAnnouncementKind>('news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [features, setFeatures] = useState('');
  const [improvements, setImprovements] = useState('');
  const [fixes, setFixes] = useState('');
  const [removed, setRemoved] = useState('');
  const [other, setOther] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [footer, setFooter] = useState('');
  const [author, setAuthor] = useState('');
  const [color, setColor] = useState('');
  const [emoji, setEmoji] = useState('');
  const [mentionEveryone, setMentionEveryone] = useState(defaultMentionEveryone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const sections = announcement?.sections;
    setKind(announcement?.kind ?? 'news');
    setTitle(announcement?.title ?? '');
    setBody(announcement?.body ?? '');
    setFeatures(sections?.features.join('\n') ?? '');
    setImprovements(sections?.improvements.join('\n') ?? '');
    setFixes(sections?.fixes.join('\n') ?? '');
    setRemoved(sections?.removed.join('\n') ?? '');
    setOther(sections?.other.join('\n') ?? '');
    setImageUrl(announcement?.imageUrl ?? '');
    setThumbnailUrl(announcement?.thumbnailUrl ?? '');
    setFooter(announcement?.footer ?? '');
    setAuthor(announcement?.author ?? '');
    setColor(announcement?.color ?? '');
    setEmoji(announcement?.emoji ?? '');
    setMentionEveryone(announcement?.mentionEveryone ?? defaultMentionEveryone);
    setError(null);
  }, [open, announcement, defaultMentionEveryone]);

  const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
  const valid =
    title.trim().length >= 3 &&
    (kind === 'news'
      ? body.trim().length >= 10
      : [features, improvements, fixes, removed, other].some((section) => lines(section).length > 0));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        kind,
        title,
        body: kind === 'news' ? body : null,
        sections:
          kind === 'changelog'
            ? {
                features: lines(features),
                improvements: lines(improvements),
                fixes: lines(fixes),
                removed: lines(removed),
                other: lines(other),
              }
            : null,
        imageUrl: imageUrl.trim() || null,
        thumbnailUrl: thumbnailUrl.trim() || null,
        footer: footer.trim() || null,
        author: author.trim() || null,
        color: color.trim() || null,
        emoji: emoji.trim() || null,
        mentionEveryone,
      };
      if (announcement) await api.patch(`/admin/discord/announcements/${announcement.id}`, payload);
      else await api.post('/admin/discord/announcements', payload);
      success(announcement ? 'Announcement updated' : 'Announcement published', 'The bot will update Discord within a few seconds.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not save announcement', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={announcement ? 'Edit announcement' : 'New announcement'}
      description="News and changelogs render as branded embeds in their configured Discord channels."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {announcement ? 'Save changes' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={kind === 'news' ? 'primary' : 'secondary'}
            onClick={() => !announcement && setKind('news')}
            disabled={Boolean(announcement)}
          >
            News
          </Button>
          <Button
            size="sm"
            variant={kind === 'changelog' ? 'primary' : 'secondary'}
            onClick={() => !announcement && setKind('changelog')}
            disabled={Boolean(announcement)}
          >
            Changelog
          </Button>
        </div>
        <Field label="Title" required>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
        </Field>
        {kind === 'news' ? (
          <Field label="News copy" required hint="Plain text. Discord shows the full message, so keep it scannable.">
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} maxLength={4000} />
          </Field>
        ) : (
          <div className="space-y-3">
            <Field label="New features" hint="One item per line.">
              <Textarea value={features} onChange={(event) => setFeatures(event.target.value)} rows={3} />
            </Field>
            <Field label="Improvements" hint="One item per line.">
              <Textarea value={improvements} onChange={(event) => setImprovements(event.target.value)} rows={3} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bug fixes">
                <Textarea value={fixes} onChange={(event) => setFixes(event.target.value)} rows={3} />
              </Field>
              <Field label="Removed">
                <Textarea value={removed} onChange={(event) => setRemoved(event.target.value)} rows={3} />
              </Field>
              <Field label="Other">
                <Textarea value={other} onChange={(event) => setOther(event.target.value)} rows={3} />
              </Field>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Image URL" hint="Optional HTTPS banner.">
            <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Thumbnail URL" hint="Optional HTTPS thumbnail.">
            <Input value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Footer">
            <Input value={footer} onChange={(event) => setFooter(event.target.value)} maxLength={200} />
          </Field>
          <Field label="Author">
            <Input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={100} />
          </Field>
          <Field label="Colour" hint="Six-digit hex, for example #E6C27A.">
            <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#E6C27A" />
          </Field>
          <Field label="Emoji">
            <Input value={emoji} onChange={(event) => setEmoji(event.target.value)} placeholder="🍩" maxLength={20} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
          <div>
            <p className="text-[12.5px] font-semibold text-ink">Mention @everyone</p>
            <p className="mt-0.5 text-[11px] text-muted">Use only for genuinely important announcements.</p>
          </div>
          <Toggle checked={mentionEveryone} onChange={setMentionEveryone} label="Mention everyone" />
        </div>
      </div>
    </Modal>
  );
}

function InfoChannelModal({
  open,
  onClose,
  channel,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  channel: DiscordInfoChannelView | null;
  categories: string[];
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [channelId, setChannelId] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(channel?.name ?? '');
    setCategory(channel?.category ?? '');
    setChannelId(channel?.channelId ?? '');
    setDescription(channel?.description ?? '');
    setError(null);
  }, [open, channel]);

  const valid = name.trim().length >= 2 && category.trim().length >= 2 && /^\d{15,22}$/.test(channelId.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim(),
        channelId: channelId.trim(),
        description: description.trim() || null,
      };
      if (channel) await api.patch(`/admin/discord/info-channels/${channel.id}`, payload);
      else await api.post('/admin/discord/info-channels', payload);
      success(
        channel ? 'Update channel saved' : 'Update channel added',
        'Panels posted here are published and edited from this page.',
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not save update channel', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={channel ? 'Edit update channel' : 'Add update channel'}
      description="Register a Discord channel once, then publish any number of info panels there without changing code."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {channel ? 'Save channel' : 'Add channel'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Channel name" required hint="The label shown on this page.">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Dev updates"
              maxLength={80}
            />
          </Field>
          <Field label="Category" required hint="Groups channels together, for example Development.">
            <Input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Development"
              maxLength={50}
              list="info-channel-categories"
            />
            <datalist id="info-channel-categories">
              {categories.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label="Discord channel ID" required hint="Right-click the channel in Discord and choose Copy Channel ID.">
          <Input
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            placeholder="123456789012345678"
            inputMode="numeric"
            className="font-mono text-[12px]"
          />
        </Field>
        <Field label="Description" hint="Optional. A short note for staff about what belongs here.">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={200} />
        </Field>
        <Alert tone="info">
          Panels are posted by the bot. If the channel ID changes later, remove the published panels first so the bot can
          move them cleanly.
        </Alert>
      </div>
    </Modal>
  );
}

function PanelModal({
  open,
  onClose,
  panel,
  channels,
  defaultChannelId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  panel: DiscordPanelView | null;
  channels: DiscordInfoChannelView[];
  defaultChannelId?: string;
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [infoChannelId, setInfoChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [color, setColor] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [footer, setFooter] = useState('');
  const [links, setLinks] = useState<DiscordPanelLink[]>([]);
  const [mentionEveryone, setMentionEveryone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInfoChannelId(panel?.infoChannelId ?? defaultChannelId ?? channels[0]?.id ?? '');
    setTitle(panel?.title ?? '');
    setBody(panel?.body ?? '');
    setColor(panel?.color ?? '');
    setImageUrl(panel?.imageUrl ?? '');
    setThumbnailUrl(panel?.thumbnailUrl ?? '');
    setFooter(panel?.footer ?? '');
    setLinks(panel?.links ?? []);
    setMentionEveryone(panel?.mentionEveryone ?? false);
    setError(null);
    // `channels` refreshes on the page's poll, so it is deliberately excluded:
    // including it would wipe unsaved edits every twenty seconds.
  }, [open, panel, defaultChannelId]);

  const categories = [...new Set(channels.map((channel) => channel.category))].sort((a, b) => a.localeCompare(b));
  const valid = Boolean(infoChannelId) && title.trim().length >= 3 && body.trim().length >= 1;

  const updateLink = (index: number, patch: Partial<DiscordPanelLink>) => {
    setLinks((current) => current.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        infoChannelId,
        title: title.trim(),
        body: body.trim(),
        color: color.trim() || null,
        imageUrl: imageUrl.trim() || null,
        thumbnailUrl: thumbnailUrl.trim() || null,
        footer: footer.trim() || null,
        links: links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label && link.url),
        mentionEveryone,
      };
      if (panel) await api.patch(`/admin/discord/panels/${panel.id}`, payload);
      else await api.post('/admin/discord/panels', payload);
      success(panel ? 'Panel updated' : 'Panel published', 'The bot applies the change within a few seconds.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not save panel', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={panel ? 'Edit info panel' : 'New info panel'}
      description="A branded Discord embed. Edit it here at any time and the bot updates the same message in place."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {panel ? 'Save changes' : 'Publish panel'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Update channel" required hint="The panel is posted in this Discord channel.">
          <Select value={infoChannelId} onChange={(event) => setInfoChannelId(event.target.value)}>
            <option value="">Choose a channel</option>
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {channels
                  .filter((channel) => channel.category === category)
                  .map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Title" required hint="3-120 characters.">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Meet the DonutSpin dev team" />
        </Field>
        <Field label="Message" required hint={`${body.length}/4,000 characters. Discord markdown is supported.`}>
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} maxLength={4000} />
        </Field>

        <div className="rounded-xl border border-line/80 bg-surface-2/40 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[12.5px] font-semibold text-ink">Link buttons</p>
              <p className="mt-0.5 text-[11px] text-muted">Up to four HTTPS links under the panel.</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              disabled={links.length >= 4}
              onClick={() => setLinks((current) => [...current, { label: '', url: '' }])}
            >
              Add button
            </Button>
          </div>
          {links.length > 0 && (
            <div className="mt-3 space-y-2">
              {links.map((link, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={link.label}
                    onChange={(event) => updateLink(index, { label: event.target.value })}
                    placeholder="Label"
                    maxLength={80}
                    className="min-w-32 flex-1"
                  />
                  <Input
                    value={link.url}
                    onChange={(event) => updateLink(index, { url: event.target.value })}
                    placeholder="https://…"
                    className="min-w-48 flex-[2]"
                  />
                  <button
                    type="button"
                    onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
                    className="rounded-lg p-2 text-faint transition-colors hover:bg-danger/10 hover:text-danger"
                    aria-label="Remove link button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Colour" hint="Six-digit hex, for example #5865F2.">
            <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#5865F2" />
          </Field>
          <Field label="Footer">
            <Input value={footer} onChange={(event) => setFooter(event.target.value)} maxLength={200} />
          </Field>
          <Field label="Image URL" hint="Optional HTTPS banner.">
            <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Thumbnail URL" hint="Optional HTTPS thumbnail.">
            <Input value={thumbnailUrl} onChange={(event) => setThumbnailUrl(event.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
          <div>
            <p className="text-[12.5px] font-semibold text-ink">Mention @everyone</p>
            <p className="mt-0.5 text-[11px] text-muted">Only used when the panel is first published.</p>
          </div>
          <Toggle checked={mentionEveryone} onChange={setMentionEveryone} label="Mention everyone" />
        </div>
      </div>
    </Modal>
  );
}

function PanelsTab({ data, onChanged }: { data: DiscordOverviewResponse; onChanged: () => void }) {
  const { success, error: toastError } = useToast();
  const [channelModal, setChannelModal] = useState<{ open: boolean; item: DiscordInfoChannelView | null }>({
    open: false,
    item: null,
  });
  const [panelModal, setPanelModal] = useState<{ open: boolean; item: DiscordPanelView | null; channelId?: string }>({
    open: false,
    item: null,
  });
  const [deleteChannel, setDeleteChannel] = useState<DiscordInfoChannelView | null>(null);
  const [deletePanel, setDeletePanel] = useState<DiscordPanelView | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = [...new Set(data.infoChannels.map((channel) => channel.category))].sort((a, b) =>
    a.localeCompare(b),
  );
  const channelName = (id: string) => data.infoChannels.find((channel) => channel.id === id)?.name ?? 'Unknown channel';

  const removeChannel = async () => {
    if (!deleteChannel) return;
    setBusy(true);
    try {
      const result = await api.delete<{ deletedPanels: number }>(`/admin/discord/info-channels/${deleteChannel.id}`);
      success(
        'Update channel removed',
        result.deletedPanels > 0
          ? `${result.deletedPanels} panel${result.deletedPanels === 1 ? '' : 's'} were removed from Discord.`
          : 'No panels were attached to it.',
      );
      setDeleteChannel(null);
      onChanged();
    } catch (err) {
      toastError('Could not remove update channel', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removePanel = async () => {
    if (!deletePanel) return;
    setBusy(true);
    try {
      await api.delete(`/admin/discord/panels/${deletePanel.id}`);
      success('Panel deleted', 'The Discord message is being removed.');
      setDeletePanel(null);
      onChanged();
    } catch (err) {
      toastError('Could not delete panel', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Update channels"
          description="Register the Discord channels where the bot publishes info panels. Group them by category so the team can find things quickly."
          action={
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setChannelModal({ open: true, item: null })}
            >
              Add channel
            </Button>
          }
        />
        {data.infoChannels.length === 0 ? (
          <EmptyState
            icon={<Hash className="h-5 w-5" />}
            title="No update channels yet"
            description="Add the channel you just created in Discord. Then publish your first panel and the bot posts it there."
            action={
              <Button variant="primary" onClick={() => setChannelModal({ open: true, item: null })}>
                Add the first channel
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-line/70">
            {categories.map((category) => (
              <div key={category} className="px-5 py-4">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-faint/90">{category}</p>
                <div className="mt-2.5 space-y-2">
                  {data.infoChannels
                    .filter((channel) => channel.category === category)
                    .map((channel) => (
                      <div
                        key={channel.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-line/80 bg-surface-2/40 px-3.5 py-3"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface-1 text-gold">
                          <Hash className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[12.5px] font-semibold text-ink">{channel.name}</p>
                            <Badge tone={channel.panelCount > 0 ? 'gold' : 'neutral'}>
                              {channel.panelCount} panel{channel.panelCount === 1 ? '' : 's'}
                            </Badge>
                          </div>
                          <p className="mt-0.5 font-mono text-[10px] text-faint">{channel.channelId}</p>
                          {channel.description && (
                            <p className="mt-1 text-[11px] leading-relaxed text-muted">{channel.description}</p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            leftIcon={<Plus className="h-3.5 w-3.5" />}
                            onClick={() => setPanelModal({ open: true, item: null, channelId: channel.id })}
                          >
                            Panel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Pencil className="h-3.5 w-3.5" />}
                            onClick={() => setChannelModal({ open: true, item: channel })}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => setDeleteChannel(channel)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Info panels"
          description="Publish announcements, developer updates, rules, or guides. Editing a sent panel updates the same Discord message."
          action={
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              disabled={data.infoChannels.length === 0}
              onClick={() => setPanelModal({ open: true, item: null, channelId: data.infoChannels[0]?.id })}
            >
              New panel
            </Button>
          }
        />
        {data.panels.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No panels published"
            description="Panels are reusable embeds: publish once, then edit them here whenever the information changes."
            action={
              data.infoChannels.length > 0 ? (
                <Button variant="primary" onClick={() => setPanelModal({ open: true, item: null, channelId: data.infoChannels[0]?.id })}>
                  Write the first panel
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-line/70">
            {data.panels.map((panel) => (
              <div key={panel.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="violet">{panel.category}</Badge>
                    <Badge tone="neutral">#{channelName(panel.infoChannelId)}</Badge>
                    {panel.mentionEveryone && <Badge tone="warning">@everyone</Badge>}
                    {!panel.messageId && <Badge tone="neutral">Queued</Badge>}
                  </div>
                  <p className="mt-2 font-display text-[15px] font-semibold text-ink">{panel.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{panel.body}</p>
                  <p className="mt-1.5 text-[10px] text-faint">
                    {dateTime(panel.updatedAt)} · {panel.messageId ? 'Published in Discord' : 'Waiting for delivery'}
                    {panel.links.length > 0 ? ` · ${panel.links.length} button${panel.links.length === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => setPanelModal({ open: true, item: panel })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => setDeletePanel(panel)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <InfoChannelModal
        open={channelModal.open}
        channel={channelModal.item}
        categories={categories}
        onClose={() => setChannelModal({ open: false, item: null })}
        onSaved={onChanged}
      />
      <PanelModal
        open={panelModal.open}
        panel={panelModal.item}
        channels={data.infoChannels}
        defaultChannelId={panelModal.channelId}
        onClose={() => setPanelModal({ open: false, item: null })}
        onSaved={onChanged}
      />
      <ConfirmDialog
        open={Boolean(deleteChannel)}
        onClose={() => setDeleteChannel(null)}
        onConfirm={() => void removeChannel()}
        title="Remove this update channel?"
        description="Its published panels are deleted from Discord and the site. Past audit entries are kept."
        confirmLabel="Remove channel"
        tone="danger"
        loading={busy}
      />
      <ConfirmDialog
        open={Boolean(deletePanel)}
        onClose={() => setDeletePanel(null)}
        onConfirm={() => void removePanel()}
        title="Delete this panel?"
        description="The Discord message is removed and the record is kept as deleted for the audit trail."
        confirmLabel="Delete panel"
        tone="danger"
        loading={busy}
      />
    </div>
  );
}

function CodeModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [maxRedemptions, setMaxRedemptions] = useState('100');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode('');
    setName('');
    setDescription('');
    setAmount('');
    setMaxRedemptions('100');
    setExpiresAt('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/discord/codes', {
        code,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        amount: Number(amount || 0),
        maxRedemptions: Number(maxRedemptions),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      success('Code created', 'The bot publishes it with an @everyone mention in the codes channel.');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      toastError('Could not create code', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create reward code"
      description="Codes are shared instantly: the same code works on the website and in Discord."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={code.trim().length < 3 || !amount || Number(maxRedemptions) < 1}
            onClick={() => void submit()}
          >
            Create & announce
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code" required hint="3–32 letters, numbers, underscores or hyphens.">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="DONUT-WEEKEND"
              maxLength={32}
              className="font-display tracking-[0.12em]"
            />
          </Field>
          <Field label="Label" hint="Optional internal name.">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
          </Field>
        </div>
        <Field label="Description" hint="Shown in the announcement and dashboard.">
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Reward" required>
            <AmountInput value={amount} onChange={setAmount} min={1} />
          </Field>
          <Field label="Max redemptions" required>
            <Input
              type="number"
              min={1}
              max={100000}
              value={maxRedemptions}
              onChange={(event) => setMaxRedemptions(event.target.value)}
            />
          </Field>
          <Field label="Expires" hint="Optional.">
            <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>
        </div>
        <Alert tone="info">
          Every new code announcement includes an <strong>@everyone</strong> mention. Weekly codes are simply codes with a
          seven-day expiry that staff create when they are ready.
        </Alert>
      </div>
    </Modal>
  );
}

export function AdminDiscordPage() {
  const { success, error: toastError } = useToast();
  const query = useApiQuery<DiscordOverviewResponse>('/admin/discord');
  const [tab, setTab] = useState<TabKey>('overview');
  const [announcementModal, setAnnouncementModal] = useState<{ open: boolean; item: DiscordAnnouncementView | null }>({
    open: false,
    item: null,
  });
  const [codeModal, setCodeModal] = useState(false);
  const [deleteAnnouncement, setDeleteAnnouncement] = useState<DiscordAnnouncementView | null>(null);
  const [deleteCode, setDeleteCode] = useState<RewardCodeView | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const { refetch } = query;
  useEffect(() => {
    const timer = window.setInterval(() => refetch(), 20_000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  const data = query.data;
  const status = data?.status;
  const config = data?.config;
  const stats = data?.stats;

  const toggleCode = async (code: RewardCodeView) => {
    try {
      await api.patch(`/admin/discord/codes/${code.id}`, { disabled: code.status !== 'disabled' });
      success(code.status === 'disabled' ? 'Code re-enabled' : 'Code disabled', code.code);
      query.refetch();
    } catch (err) {
      toastError('Could not update code', errorMessage(err));
    }
  };

  const removeAnnouncement = async () => {
    if (!deleteAnnouncement) return;
    setActionBusy(true);
    try {
      await api.delete(`/admin/discord/announcements/${deleteAnnouncement.id}`);
      success('Announcement deleted', 'The Discord message will be removed.');
      setDeleteAnnouncement(null);
      query.refetch();
    } catch (err) {
      toastError('Could not delete announcement', errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  const removeCode = async () => {
    if (!deleteCode) return;
    setActionBusy(true);
    try {
      await api.delete(`/admin/discord/codes/${deleteCode.id}`);
      success('Code deleted', deleteCode.code);
      setDeleteCode(null);
      query.refetch();
    } catch (err) {
      toastError('Could not delete code', errorMessage(err));
    } finally {
      setActionBusy(false);
    }
  };

  if (query.loading && !data) return <LoadingBlock label="Loading Discord integration" />;
  if (query.error && !data) {
    return (
      <div>
        <PageHeader title="Discord integration" description="Manage the DonutSpin bot and its shared systems." />
        <Alert tone="error">{query.error}</Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Discord integration"
        description="One shared database for the website and the DonutSpin bot: balances, codes, giveaways, invites, announcements, and info panels."
        badge={
          status?.connected ? (
            <Badge tone="success" dot>
              Bot online
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              Bot offline
            </Badge>
          )
        }
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', query.loading && 'animate-spin')} />} onClick={query.refetch}>
            Refresh
          </Button>
        }
      />

      {!status?.guild && (
        <Alert tone="warning" title="No Discord server connected yet" className="mb-5">
          Set <code className="rounded bg-black/25 px-1">DISCORD_BOT_API_KEY</code> on this website, then start the bot on
          its own host with <code className="rounded bg-black/25 px-1">DONUTSPIN_API_URL</code> pointing at this public
          HTTPS origin. It cannot use localhost. Run <strong>/setup</strong> in Discord after linking your staff account.
        </Alert>
      )}
      {status?.guild && !status.connected && (
        <Alert tone="warning" title="The bot has not sent a heartbeat recently" className="mb-5">
          Last seen {status.lastSeenAt ? timeAgo(status.lastSeenAt) : 'never'}. Check the bot process, its token, and
          that <code className="rounded bg-black/25 px-1">DONUTSPIN_API_URL</code> can reach this site.
        </Alert>
      )}

      <Tabs
        className="mb-5"
        value={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'config', label: 'Configuration' },
          { key: 'announcements', label: 'Announcements', count: data?.announcements.length },
          { key: 'panels', label: 'Info panels', count: data?.panels.length },
          { key: 'codes', label: 'Codes', count: data?.codes.length },
          { key: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Bot status"
              value={status?.connected ? 'Online' : 'Offline'}
              hint={status?.guild ? `${status.guild.name} · ${status.guild.memberCount.toLocaleString()} members` : 'No server connected'}
              icon={<Bot className="h-4 w-4" />}
              tone={status?.connected ? 'success' : 'danger'}
            />
            <StatCard
              label="Linked accounts"
              value={stats?.linkedAccounts ?? 0}
              hint="One Discord account per website account"
              icon={<Link2 className="h-4 w-4" />}
              tone="info"
            />
            <StatCard
              label="Tracked invites"
              value={stats?.trackedInvites ?? 0}
              hint={`${stats?.inviteRewardsPaid ?? 0} rewards paid · ${stats?.inviteRewardsPending ?? 0} pending`}
              icon={<Users className="h-4 w-4" />}
              tone="violet"
            />
            <StatCard
              label="Invite rewards total"
              value={money(stats?.inviteRewardsAmount ?? 0)}
              hint="Paid from the shared wallet ledger"
              icon={<Coins className="h-4 w-4" />}
              tone="gold"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Active giveaways" value={stats?.activeGiveaways ?? 0} hint="Scheduled or live" icon={<Trophy className="h-4 w-4" />} tone="gold" />
            <StatCard label="Active codes" value={stats?.activeCodes ?? 0} hint={`${stats?.codeRedemptions ?? 0} redemptions`} icon={<TicketPercent className="h-4 w-4" />} tone="success" />
            <StatCard label="Positive vouches" value={stats?.positiveVouches ?? 0} hint="Community reputation" icon={<ShieldCheck className="h-4 w-4" />} tone="success" />
            <StatCard label="Scam vouches" value={stats?.scamVouches ?? 0} hint="Warning feedback" icon={<CircleOff className="h-4 w-4" />} tone="danger" />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Invite leaderboard"
                description="Counted first joins only; leaves and rejoins do not count twice."
                action={<Badge tone="gold">Top 10</Badge>}
              />
              {(data?.inviteLeaderboard.length ?? 0) === 0 ? (
                <EmptyState icon={<Users className="h-5 w-5" />} title="No invites tracked yet" description="Invite tracking starts when the bot is online and sees a member join." />
              ) : (
                <div className="divide-y divide-line/70">
                  {data?.inviteLeaderboard.map((entry) => (
                    <div key={entry.discordUserId} className="flex items-center gap-3 px-5 py-3">
                      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-[11px] font-bold', entry.rank <= 3 ? 'border-gold/30 bg-gold/10 text-gold' : 'border-line bg-surface-2 text-faint')}>
                        {entry.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-ink">
                          {entry.websiteUsername ? `@${entry.websiteUsername}` : entry.username}
                        </p>
                        <p className="truncate text-[10px] text-faint">{entry.websiteUsername ? `Discord ${entry.username}` : 'Not linked'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-semibold text-ink tnum">{entry.invites} invites</p>
                        <p className="text-[10px] text-gold-dim tnum">{money(entry.rewards)} paid</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHeader title="Recent vouches" description="Latest positive and scam feedback from Discord." />
              {(data?.recentVouches.length ?? 0) === 0 ? (
                <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No vouches yet" description="Use /vouch or /scamvouch in Discord to start building reputation." />
              ) : (
                <div className="divide-y divide-line/70">
                  {data?.recentVouches.map((vouch) => (
                    <div key={vouch.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={vouch.type === 'scam' ? 'danger' : 'success'}>
                          {vouch.type === 'scam' ? 'Scam vouch' : 'Positive vouch'}
                        </Badge>
                        <p className="text-[11px] text-faint">
                          for <span className="text-ink/90">{vouch.targetWebsiteUsername ? `@${vouch.targetWebsiteUsername}` : vouch.targetUsername}</span> by {vouch.voucherUsername}
                        </p>
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{vouch.reason}</p>
                      <p className="mt-1 text-[10px] text-faint">{timeAgo(vouch.createdAt)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Announcements" value={stats?.announcements ?? 0} hint="Published news and changelogs" icon={<Megaphone className="h-4 w-4" />} tone="info" />
            <StatCard
              label="Info panels"
              value={stats?.panels ?? 0}
              hint={`${stats?.infoChannels ?? 0} update channel${stats?.infoChannels === 1 ? '' : 's'} registered`}
              icon={<Hash className="h-4 w-4" />}
              tone="violet"
            />
            <StatCard label="Pending delivery" value={stats?.pendingOutbox ?? 0} hint="Events waiting for the bot" icon={<Send className="h-4 w-4" />} tone="warning" />
            <StatCard label="Failed delivery" value={stats?.failedOutbox ?? 0} hint="Review the activity tab and retry" icon={<CircleOff className="h-4 w-4" />} tone={stats?.failedOutbox ? 'danger' : 'neutral'} />
            <StatCard label="Bot latency" value={status?.guild?.latencyMs !== null && status?.guild?.latencyMs !== undefined ? `${status.guild.latencyMs} ms` : '—'} hint={status?.guild?.botVersion ? `Version ${status.guild.botVersion}` : 'No heartbeat yet'} icon={<Activity className="h-4 w-4" />} tone="neutral" />
          </div>
        </div>
      )}

      {tab === 'config' &&
        (config ? (
          <ConfigPanel config={config} onSaved={query.refetch} />
        ) : (
          <Alert tone="warning" title="Connect the bot first">
            The configuration form appears after the bot joins your server and sends its first heartbeat.
          </Alert>
        ))}

      {tab === 'announcements' && (
        <Card>
          <CardHeader
            title="News & changelog"
            description="Create, edit, and retract announcements without touching Discord IDs."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAnnouncementModal({ open: true, item: null })}>
                New announcement
              </Button>
            }
          />
          {(data?.announcements.length ?? 0) === 0 ? (
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title="No announcements"
              description="Publish a news post or a changelog and the bot will format it as a professional Discord embed."
              action={
                <Button variant="primary" onClick={() => setAnnouncementModal({ open: true, item: null })}>
                  Write the first one
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-line/70">
              {data?.announcements.map((item) => (
                <div key={item.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={item.kind === 'news' ? 'info' : 'violet'}>
                        {item.kind === 'news' ? 'News' : 'Changelog'}
                      </Badge>
                      {item.mentionEveryone && <Badge tone="warning">@everyone</Badge>}
                      {!item.messageId && <Badge tone="neutral">Queued</Badge>}
                    </div>
                    <p className="mt-2 font-display text-[15px] font-semibold text-ink">{item.title}</p>
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">
                      {item.body ?? item.sections?.features[0] ?? 'Changelog entry'}
                    </p>
                    <p className="mt-1.5 text-[10px] text-faint">
                      {dateTime(item.updatedAt)} · {item.messageId ? 'Published in Discord' : 'Waiting for delivery'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setAnnouncementModal({ open: true, item })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteAnnouncement(item)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'panels' && data && <PanelsTab data={data} onChanged={query.refetch} />}

      {tab === 'codes' && (
        <Card>
          <CardHeader
            title="Reward codes"
            description="Single-use, shared between the site and Discord. Disable a code to stop redemptions without deleting its history."
            action={
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCodeModal(true)}>
                Create code
              </Button>
            }
          />
          {(data?.codes.length ?? 0) === 0 ? (
            <EmptyState
              icon={<TicketPercent className="h-5 w-5" />}
              title="No codes yet"
              description="Create a weekly drop or a one-off reward. The bot announces every new code with @everyone."
              action={<Button variant="primary" onClick={() => setCodeModal(true)}>Create the first code</Button>}
            />
          ) : (
            <div className="divide-y divide-line/70">
              {data?.codes.map((code) => (
                <div key={code.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-[14px] font-semibold tracking-[0.08em] text-ink">{code.code}</p>
                      <Badge tone={codeTone(code.status)}>{code.status}</Badge>
                      <Badge tone="gold">{money(code.amount)}</Badge>
                      {code.createdVia === 'discord' && <Badge tone="violet">From Discord</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {code.name} · {code.redeemedCount}/{code.maxRedemptions} redeemed
                      {code.expiresAt ? ` · expires ${dateTime(code.expiresAt)}` : ' · no expiry'}
                    </p>
                    <div className="mt-2 max-w-xs">
                      <Progress value={code.redeemedCount} max={code.maxRedemptions} tone="gold" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void toggleCode(code)}>
                      {code.status === 'disabled' ? 'Enable' : 'Disable'}
                    </Button>
                    <Button size="sm" variant="danger" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setDeleteCode(code)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader title="Recent bot activity" description="Administrative actions, rewards, links, and economic events." />
            {(data?.recentActivity.length ?? 0) === 0 ? (
              <EmptyState icon={<Activity className="h-5 w-5" />} title="No activity yet" description="Bot actions will appear here as staff and players use the integration." />
            ) : (
              <div className="divide-y divide-line/70">
                {data?.recentActivity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-faint">
                      {item.action.startsWith('giveaway') ? <Trophy className="h-3.5 w-3.5" /> : item.action.startsWith('code') ? <TicketPercent className="h-3.5 w-3.5" /> : item.action.startsWith('vouch') ? <ShieldCheck className="h-3.5 w-3.5" /> : item.action.startsWith('invite') ? <Users className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-relaxed text-ink">{item.summary}</p>
                      <p className="mt-0.5 text-[10px] text-faint">
                        {item.action} · {timeAgo(item.createdAt)}
                        {item.actor?.username ? ` · @${item.actor.username}` : item.actor?.discordUserId ? ` · Discord ${item.actor.discordUserId}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Discord servers" description="Guilds the bot is connected to." />
            <div className="divide-y divide-line/70">
              {data?.guilds.map((guild) => (
                <div key={guild.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Bot className="h-4 w-4 text-gold" />
                    <p className="text-[12.5px] font-semibold text-ink">{guild.name}</p>
                    {guild.primary && <Badge tone="gold">Primary</Badge>}
                    {guild.lastSeenAt && Date.now() - new Date(guild.lastSeenAt).getTime() < 120_000 ? <Badge tone="success" dot>Online</Badge> : <Badge tone="neutral">Offline</Badge>}
                  </div>
                  <p className="mt-1 text-[10.5px] text-faint">
                    {guild.memberCount.toLocaleString()} members · {guild.id}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-faint">{guild.lastSeenAt ? `Last heartbeat ${timeAgo(guild.lastSeenAt)}` : 'No heartbeat yet'}</p>
                </div>
              ))}
              {(data?.guilds.length ?? 0) === 0 && <EmptyState icon={<Bot className="h-5 w-5" />} title="No servers" description="Start the bot with its guild intents and it will appear here." />}
            </div>
          </Card>
        </div>
      )}

      <AnnouncementModal
        open={announcementModal.open}
        announcement={announcementModal.item}
        defaultMentionEveryone={config?.announcementEveryone ?? true}
        onClose={() => setAnnouncementModal({ open: false, item: null })}
        onSaved={query.refetch}
      />
      <CodeModal open={codeModal} onClose={() => setCodeModal(false)} onSaved={query.refetch} />
      <ConfirmDialog
        open={Boolean(deleteAnnouncement)}
        onClose={() => setDeleteAnnouncement(null)}
        onConfirm={() => void removeAnnouncement()}
        title="Delete this announcement?"
        description="The Discord message is removed and the record is kept as deleted for the audit trail."
        confirmLabel="Delete announcement"
        tone="danger"
        loading={actionBusy}
      />
      <ConfirmDialog
        open={Boolean(deleteCode)}
        onClose={() => setDeleteCode(null)}
        onConfirm={() => void removeCode()}
        title="Delete this code?"
        description={
          deleteCode && deleteCode.redeemedCount > 0
            ? 'This code already has redemptions and must stay for ledger history. Disable it instead; delete will be refused.'
            : 'Unredeemed codes can be deleted. The Discord announcement is removed too.'
        }
        confirmLabel="Delete code"
        tone="danger"
        loading={actionBusy}
      />
    </div>
  );
}
