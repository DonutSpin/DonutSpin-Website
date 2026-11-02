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
  type DiscordOverviewResponse,
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
  StatCard,
  Tabs,
  Textarea,
  Toggle,
  cn,
} from '../../components/ui';

type TabKey = 'overview' | 'config' | 'announcements' | 'codes' | 'activity';

const CHANNEL_FIELDS: { key: keyof DiscordGuildConfig['channels']; label: string; hint: string }[] = [
  { key: 'welcome', label: 'Welcome channel', hint: 'Member welcomes and invite attribution.' },
  { key: 'vouches', label: 'Vouches channel', hint: 'Positive vouch embeds.' },
  { key: 'scamVouches', label: 'Scam vouch channel', hint: 'Falls back to the vouch channel when blank.' },
  { key: 'codes', label: 'Codes channel', hint: 'New code announcements with @everyone.' },
  { key: 'giveaways', label: 'Giveaway channel', hint: 'Live giveaway messages and results.' },
  { key: 'news', label: 'News channel', hint: 'Platform news embeds.' },
  { key: 'changelog', label: 'Changelog channel', hint: 'Website update embeds.' },
  { key: 'logs', label: 'Activity log channel', hint: 'Optional staff audit mirror.' },
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
          <CardHeader title="Invite rewards" description="A reward is paid once at every threshold, to the linked website wallet." />
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
              <Field label="Reward amount" hint="Credited to the inviter's DonutCash wallet.">
                <AmountInput value={rewardAmount} onChange={setRewardAmount} min={1} />
              </Field>
            </div>
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
        <PageHeader title="Discord integration" description="Manage the DonutCash bot and its shared systems." />
        <Alert tone="error">{query.error}</Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Discord integration"
        description="One shared database for the website and the DonutCash bot: balances, codes, giveaways, invites, and announcements."
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
          its own host with <code className="rounded bg-black/25 px-1">DONUTCASH_API_URL</code> pointing at this public
          HTTPS origin. It cannot use localhost. Run <strong>/setup</strong> in Discord after linking your staff account.
        </Alert>
      )}
      {status?.guild && !status.connected && (
        <Alert tone="warning" title="The bot has not sent a heartbeat recently" className="mb-5">
          Last seen {status.lastSeenAt ? timeAgo(status.lastSeenAt) : 'never'}. Check the bot process, its token, and
          that <code className="rounded bg-black/25 px-1">DONUTCASH_API_URL</code> can reach this site.
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
