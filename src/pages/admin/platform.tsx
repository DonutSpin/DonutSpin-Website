import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Gamepad2,
  Gift,
  History,
  Loader2,
  Mail,
  Megaphone,
  Percent,
  Plus,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  Users,
} from 'lucide-react';
import {
  GAME_WIN_CHANCE_INFO,
  type GameConfig,
  type GameConfigHistoryEntry,
  type SupportCategory,
} from '../../../shared/types';
import { useApiQuery } from '../../lib/useApi';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { money, dateTime, timeAgo, titleCase } from '../../lib/format';
import { compactAmount } from '../../lib/amount';
import { PageHeader } from '../../components/layout';
import { GameArtwork } from '../../components/GameArt';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Pagination,
  Progress,
  Select,
  Skeleton,
  TableWrap,
  Tabs,
  Td,
  Textarea,
  Th,
  Toggle,
  Tr,
  cn,
} from '../../components/ui';

/* --------------------------------- games --------------------------------- */

const gameConfigFields: Record<string, { key: string; label: string; kind: 'number' | 'boolean' | 'risks'; step?: string; hint?: string }[]> = {
  coinflip: [{ key: 'winMultiplier', label: 'Win multiplier', kind: 'number', step: '0.01', hint: 'Returned amount per winning wager, 1.5–2.0.' }],
  mines: [
    { key: 'maxMines', label: 'Maximum mines', kind: 'number', hint: '1–24. Grid has 25 tiles.' },
    { key: 'houseEdge', label: 'House edge (decimal)', kind: 'number', step: '0.001', hint: '0.03 = 3%. Between 0 and 0.10.' },
  ],
  blackjack: [
    { key: 'decks', label: 'Decks in shoe', kind: 'number', hint: '1–8.' },
    { key: 'blackjackPays', label: 'Blackjack profit ratio', kind: 'number', step: '0.1', hint: '1.5 = 3:2 payout.' },
    { key: 'dealerStandsSoft17', label: 'Dealer stands on soft 17', kind: 'boolean' },
    { key: 'allowDouble', label: 'Allow double down', kind: 'boolean' },
  ],
  roulette: [{ key: 'maxBetsPerSpin', label: 'Maximum bets per spin', kind: 'number', hint: '1–30 positions.' }],
  towers: [
    { key: 'levels', label: 'Tower levels', kind: 'number', hint: '3–12 floors, one trap each.' },
    { key: 'houseEdge', label: 'House edge (decimal)', kind: 'number', step: '0.001', hint: '0.03 = 3%. Between 0 and 0.10.' },
  ],
  plinko: [{ key: 'enabledRisks', label: 'Enabled risk levels', kind: 'risks' }],
};

const riskValues = ['low', 'medium', 'high'] as const;

export function AdminGamesPage() {
  const { success, error: toastError } = useToast();
  const query = useApiQuery<{ games: GameConfig[] }>('/admin/games');
  const [editing, setEditing] = useState<GameConfig | null>(null);
  const [minBet, setMinBet] = useState<number | ''>(1);
  const [maxBet, setMaxBet] = useState<number | ''>(10000);
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [winChance, setWinChance] = useState<number | ''>(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<GameConfigHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const openEdit = (game: GameConfig) => {
    const rules = { ...game.config };
    delete rules.winChance;
    const chance = game.config.winChance;
    setEditing(game);
    setMinBet(game.minBet);
    setMaxBet(game.maxBet);
    setEnabled(game.enabled);
    setConfig(rules);
    setWinChance(
      typeof chance === 'number' && Number.isFinite(chance)
        ? chance
        : (GAME_WIN_CHANCE_INFO[game.slug]?.defaultChance ?? 50),
    );
    setError(null);
    setFields({});
  };

  useEffect(() => {
    if (!editing) {
      setHistory([]);
      return;
    }
    let active = true;
    setHistoryLoading(true);
    setHistoryError(null);
    api
      .get<{ history: GameConfigHistoryEntry[] }>(`/admin/games/${editing.slug}/history?limit=10`)
      .then((data) => {
        if (active) setHistory(data.history);
      })
      .catch((err: unknown) => {
        if (active) setHistoryError(errorMessage(err));
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editing?.slug]);

  const save = async () => {
    if (!editing) return;
    const parsedChance = winChance === '' ? Number.NaN : Number(winChance);
    if (!Number.isFinite(parsedChance) || parsedChance < 1 || parsedChance > 99) {
      setFields({ 'config.winChance': 'Enter a win chance between 1% and 99%.' });
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.patch(`/admin/games/${editing.slug}`, {
        enabled,
        minBet: minBet === '' ? 1 : minBet,
        maxBet: maxBet === '' ? 1 : maxBet,
        config: { ...config, winChance: Math.round(parsedChance * 100) / 100 },
      });
      success('Game configuration saved');
      setEditing(null);
      query.refetch();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  const risks = Array.isArray(config.enabledRisks) ? (config.enabledRisks as string[]) : [];
  const chanceInfo = GAME_WIN_CHANCE_INFO[editing?.slug ?? ''];
  const multiplier = typeof config.winMultiplier === 'number' ? config.winMultiplier : null;
  const expectedReturn =
    editing?.slug === 'coinflip' && multiplier !== null && winChance !== ''
      ? (Number(winChance) / 100) * multiplier * 100
      : null;

  return (
    <div>
      <PageHeader
        title="Game configuration"
        description="Set availability, wager limits, game rules and the configured win chance for every game. Every change is audited."
        actions={
          <>
            <Link to="/admin/game-stats">
              <Button variant="secondary" leftIcon={<Percent className="h-4 w-4" />}>
                Game statistics
              </Button>
            </Link>
            <Button variant="secondary" onClick={query.refetch} leftIcon={<Loader2 className="h-4 w-4" />}>
              Refresh
            </Button>
          </>
        }
      />

      {query.error && <Alert tone="error" className="mb-4">{query.error}</Alert>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {query.loading
          ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-80 rounded-2xl" />)
          : (query.data?.games ?? []).map((game) => {
              const info = GAME_WIN_CHANCE_INFO[game.slug];
              const chance = typeof game.config.winChance === 'number' ? game.config.winChance : (info?.defaultChance ?? 50);
              return (
                <Card key={game.slug} className="flex flex-col overflow-hidden">
                  <div className="p-3.5 pb-0">
                    <GameArtwork slug={game.slug} compact />
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-[15px] font-semibold text-ink">{game.name}</h3>
                      {game.enabled ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Offline</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{game.description}</p>

                    <div className="mt-3 rounded-xl border border-line/80 bg-surface-2/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-faint">Configured win chance</p>
                          <p className="mt-1 font-display text-[26px] font-semibold leading-none tnum text-ink">
                            {chance}%
                          </p>
                        </div>
                        <Badge tone={info?.mode === 'outcome' ? 'success' : 'info'}>{info?.label ?? 'Monitoring target'}</Badge>
                      </div>
                      <Progress value={chance} max={100} tone={info?.mode === 'outcome' ? 'gold' : 'info'} className="mt-3" />
                      <p className="mt-2 text-[10px] leading-relaxed text-faint">
                        {info?.mode === 'outcome'
                          ? 'Used when a new round starts.'
                          : 'Monitoring baseline; game rules decide outcomes.'}
                      </p>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <dt className="text-faint">Min wager</dt>
                        <dd className="mt-0.5 font-medium text-ink tnum">{money(game.minBet)}</dd>
                      </div>
                      <div>
                        <dt className="text-faint">Max wager</dt>
                        <dd className="mt-0.5 font-medium text-ink tnum">{money(game.maxBet)}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {Object.entries(game.config)
                        .filter(([key]) => key !== 'winChance' && key !== 'tables' && key !== 'gridSize' && key !== 'tilesPerLevel' && key !== 'rows' && key !== 'redNumbers')
                        .slice(0, 4)
                        .map(([key, value]) => (
                          <span key={key} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-faint">
                            {key}: {Array.isArray(value) ? value.join('/') : String(value)}
                          </span>
                        ))}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                      <span className="text-[10px] text-faint">Updated {timeAgo(game.updatedAt)}</span>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(game)}>
                        Configure
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
      </div>

      <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Win chances are validated server-side and apply to new rounds only. Existing bets keep the configuration they
        started with. Games with fixed mechanics use their chance as a monitoring target rather than manipulating
        outcomes. The platform-wide payout cap applies on top of per-game limits.
      </p>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Configure ${editing?.name ?? 'game'}`}
        description="Changes affect new rounds only; active rounds keep the configuration they started with."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>Save configuration</Button>
          </>
        }
      >
        {error && <Alert tone="error" className="mb-4">{error}</Alert>}
        <div className="space-y-5">
          <div className="rounded-xl border border-gold/20 bg-gold/[0.045] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold-dim">
                  <Percent className="h-3 w-3" /> Configured win chance
                </p>
                <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-muted">{chanceInfo?.hint}</p>
              </div>
              <Badge tone={chanceInfo?.mode === 'outcome' ? 'success' : 'info'}>{chanceInfo?.label ?? 'Monitoring target'}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field className="w-36" error={fields['config.winChance']}>
                <div className="relative">
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    step="0.1"
                    value={winChance === '' ? '' : String(winChance)}
                    onChange={(event) => {
                      setWinChance(event.target.value === '' ? '' : Number(event.target.value));
                      setFields((current) => {
                        const next = { ...current };
                        delete next['config.winChance'];
                        return next;
                      });
                    }}
                    className="pr-8 tnum"
                    invalid={Boolean(fields['config.winChance'])}
                    aria-label="Configured win chance"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-faint">%</span>
                </div>
              </Field>
              <p className="pb-2 text-[10.5px] text-faint">1–99%, up to two decimal places</p>
            </div>
            {expectedReturn !== null && (
              <div className="mt-3 rounded-lg border border-line/70 bg-surface-1/60 px-3 py-2">
                <p className="text-[10.5px] leading-relaxed text-muted">
                  At this chance and a{' '}
                  <span className="font-semibold text-ink tnum">{multiplier?.toFixed(2)}×</span> payout, the configured
                  coinflip return to players is{' '}
                  <span className={cn('font-semibold tnum', expectedReturn > 100 ? 'text-danger' : expectedReturn < 85 ? 'text-warning' : 'text-success')}>
                    {expectedReturn.toFixed(1)}%
                  </span>
                  .
                </p>
              </div>
            )}
            <Alert tone="info" className="mt-3">
              {chanceInfo?.mode === 'outcome'
                ? 'This game applies the configured chance to each new round. Existing rounds retain their original chance.'
                : 'This game keeps its native rules and payout table. The configured chance is a monitoring target used to detect significant drift.'}
            </Alert>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/60 p-3.5">
            <div>
              <p className="text-[12.5px] font-medium text-ink">Game available</p>
              <p className="mt-0.5 text-[11px] text-muted">When off, the lobby marks it unavailable and play is blocked.</p>
            </div>
            <Toggle checked={enabled} onChange={setEnabled} label="Game available" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Minimum wager" error={fields.minBet} hint="Accepts K, M, B, and T shorthand.">
              <AmountInput min={1} value={minBet} onChange={setMinBet} placeholder="1k" invalid={Boolean(fields.minBet)} />
            </Field>
            <Field label="Maximum wager" error={fields.maxBet} hint="Accepts K, M, B, and T shorthand.">
              <AmountInput min={1} value={maxBet} onChange={setMaxBet} placeholder="10M" invalid={Boolean(fields.maxBet)} />
            </Field>
          </div>
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">Game rules</p>
            {(gameConfigFields[editing?.slug ?? ''] ?? []).map((field) => {
              if (field.kind === 'boolean') {
                return (
                  <div key={field.key} className="flex items-center justify-between rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
                    <p className="text-[12px] text-ink">{field.label}</p>
                    <Toggle
                      checked={config[field.key] !== false}
                      onChange={(value) => setConfig((current) => ({ ...current, [field.key]: value }))}
                      label={field.label}
                    />
                  </div>
                );
              }
              if (field.kind === 'risks') {
                return (
                  <Field key={field.key} label={field.label} error={fields['config.enabledRisks']}>
                    <div className="flex flex-wrap gap-4 pt-1">
                      {riskValues.map((risk) => (
                        <Checkbox
                          key={risk}
                          label={titleCase(risk)}
                          checked={risks.includes(risk)}
                          onChange={(checked) =>
                            setConfig((current) => {
                              const set = new Set(risks);
                              if (checked) set.add(risk); else set.delete(risk);
                              return { ...current, enabledRisks: Array.from(set) };
                            })
                          }
                        />
                      ))}
                    </div>
                  </Field>
                );
              }
              return (
                <Field key={field.key} label={field.label} hint={field.hint} error={fields[`config.${field.key}`]}>
                  <Input
                    type="number"
                    step={field.step ?? '1'}
                    value={String(config[field.key] ?? '')}
                    onChange={(event) => {
                      const value = event.target.value === '' ? '' : Number(event.target.value);
                      setConfig((current) => ({ ...current, [field.key]: value }));
                    }}
                    invalid={Boolean(fields[`config.${field.key}`])}
                  />
                </Field>
              );
            })}
          </div>

          <div className="space-y-2 border-t border-line/80 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">
                <History className="h-3 w-3" /> Recent configuration changes
              </p>
              <span className="text-[10px] text-faint">Last 10</span>
            </div>
            {historyLoading ? (
              <p className="py-3 text-[11.5px] text-faint">Loading change history…</p>
            ) : historyError ? (
              <p className="py-3 text-[11.5px] text-danger">{historyError}</p>
            ) : history.length === 0 ? (
              <p className="rounded-lg border border-line/70 bg-surface-2/40 px-3 py-3 text-[11.5px] text-faint">
                No configuration changes recorded yet. The next save will appear here with the administrator and previous/new values.
              </p>
            ) : (
              <div className="divide-y divide-line/60 rounded-lg border border-line/70 bg-surface-2/30">
                {history.map((entry) => {
                  const otherKeys = entry.changedKeys.filter((key) => key !== 'winChance');
                  return (
                    <div key={entry.id} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11.5px] font-medium text-ink">{entry.actorName ?? 'Unknown administrator'}</p>
                        <time className="text-[10px] text-faint">{dateTime(entry.createdAt)}</time>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="tnum text-muted">{entry.previousWinChance === null ? '—' : `${entry.previousWinChance}%`}</span>
                        <ArrowUpRight className="h-3 w-3 text-faint" />
                        <span className="tnum font-semibold text-gold-bright">{entry.newWinChance === null ? '—' : `${entry.newWinChance}%`}</span>
                        {otherKeys.length > 0 && (
                          <span className="text-faint">· also changed {otherKeys.map((key) => titleCase(key)).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Alert tone="info">
            Payout tables for Plinko are fixed server-side to keep edge values within a safe DonutSMP money range; the
            risk toggle controls which levels players can choose. Changes never alter an existing bet.
          </Alert>
        </div>
      </Modal>
    </div>
  );
}

/* ----------------------------- announcements ----------------------------- */

interface Announcement {
  id: string;
  title: string;
  body: string;
  recipientCount: number;
  emailRecipientCount: number;
  createdAt: string;
  creator: string;
}

export function AdminAnnouncementsPage() {
  const { success, error: toastError } = useToast();
  const query = useApiQuery<{ items: Announcement[] }>('/admin/announcements');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'players' | 'staff'>('players');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const send = async () => {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = await api.post<{ recipientCount: number; emailRecipientCount: number }>('/admin/announcements', {
        title,
        body,
        audience,
        sendEmail,
      });
      success(
        'Announcement sent',
        `${result.recipientCount} in-app notification${result.recipientCount === 1 ? '' : 's'}${
          result.emailRecipientCount > 0 ? ` · ${result.emailRecipientCount} email${result.emailRecipientCount === 1 ? '' : 's'} queued` : ''
        }.`,
      );
      setTitle('');
      setBody('');
      query.refetch();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Broadcast a persistent in-app notification to players, staff, or everyone."
      />
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader title="New announcement" description="Delivered to the in-app notification centre." />
          <div className="space-y-4 p-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Title" error={fields.title}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="Scheduled maintenance tonight" invalid={Boolean(fields.title)} />
            </Field>
            <Field label="Message" error={fields.body} hint="Shown in the notification list. Plain text only.">
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={2000} placeholder="Share the details…" invalid={Boolean(fields.body)} />
            </Field>
            <Field label="Audience">
              <Select value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}>
                <option value="players">Players only</option>
                <option value="staff">Staff only</option>
                <option value="all">Everyone</option>
              </Select>
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Also send by email</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  Delivered to accounts that opted in. Requires email to be enabled in Email settings.
                </p>
              </div>
              <Toggle checked={sendEmail} onChange={setSendEmail} label="Also send announcement by email" />
            </div>
            <Alert tone="info" title="In-app delivery always included">
              Every non-suspended matching account receives a persistent notification. Email is queued separately and
              retried in the background if delivery fails.
            </Alert>
            <Button variant="primary" className="w-full" loading={busy} onClick={() => void send()} disabled={!title.trim() || body.trim().length < 5}>
              <Megaphone className="h-4 w-4" /> Send announcement
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Delivery history" description="Recipient counts are captured at send time." />
          {query.loading ? (
            <LoadingBlock label="Loading announcements" />
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <EmptyState icon={<Megaphone className="h-5 w-5" />} title="No announcements yet" description="Sent announcements will appear here with their audience size." />
          ) : (
            <div className="divide-y divide-line/70">
              {query.data!.items.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-medium text-ink">{item.title}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{item.recipientCount} in-app</Badge>
                      {item.emailRecipientCount > 0 && <Badge tone="info">{item.emailRecipientCount} email</Badge>}
                    </div>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{item.body}</p>
                  <p className="mt-2 text-[10.5px] text-faint">{item.creator} · {dateTime(item.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* -------------------------------- audit ---------------------------------- */

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

interface AuditResponse {
  items: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  actions: string[];
}

export function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '25');
  if (action) params.set('action', action);
  if (search) params.set('q', search);
  if (actor) params.set('actor', actor);

  const query = useApiQuery<AuditResponse>(`/admin/audit?${params.toString()}`);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only record of sensitive platform actions. Secrets, passwords, and tokens are never logged."
        actions={<Badge tone="success"><ShieldCheck className="h-3 w-3" /> Immutable</Badge>}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line p-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search action, target, or actor" className="pl-9" />
          </div>
          <Field className="w-[200px]">
            <Select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
              <option value="">All actions</option>
              {(query.data?.actions ?? []).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </Select>
          </Field>
          <Field className="w-[160px]">
            <Input value={actor} onChange={(event) => { setActor(event.target.value); setPage(1); }} placeholder="Actor username" />
          </Field>
          {(action || search || actor) && (
            <Button variant="ghost" size="sm" onClick={() => { setAction(''); setSearchInput(''); setSearch(''); setActor(''); setPage(1); }}>
              Reset
            </Button>
          )}
        </div>

        {query.error ? (
          <div className="p-4"><Alert tone="error">{query.error}</Alert></div>
        ) : query.loading ? (
          <LoadingBlock label="Loading audit log" />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No matching audit entries" description="Try clearing filters or performing an administrative action." />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Reason</Th>
                  <Th>IP</Th>
                  <Th>Timestamp</Th>
                </tr>
              </thead>
              <tbody>
                {query.data!.items.map((entry) => (
                  <Tr key={entry.id} onClick={() => setSelected(entry)}>
                    <Td className="text-[12px] text-ink">{entry.actorName}</Td>
                    <Td>
                      <span className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                        {entry.action}
                      </span>
                    </Td>
                    <Td className="text-[11.5px]">{entry.targetLabel ?? entry.targetType ?? '—'}</Td>
                    <Td className="max-w-[240px] truncate text-[11px]">{entry.reason ?? '—'}</Td>
                    <Td className="font-mono text-[10px]">{entry.ip ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-[10.5px]">{dateTime(entry.createdAt)}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={query.data!.page} totalPages={query.data!.totalPages} total={query.data!.total} onPage={setPage} unit="audit entries" />
          </>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit entry"
        description={selected?.action}
        size="md"
        footer={<Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>}
      >
        {selected && (
          <div className="space-y-3 text-[12px]">
            <dl className="space-y-2">
              {[
                ['Actor', selected.actorName],
                ['Action', selected.action],
                ['Target type', selected.targetType ?? '—'],
                ['Target', selected.targetLabel ?? selected.targetId ?? '—'],
                ['Reason', selected.reason ?? '—'],
                ['IP address', selected.ip ?? '—'],
                ['Timestamp', dateTime(selected.createdAt)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-line/60 pb-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="break-all text-right text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {selected.metadata && (
              <div>
                <p className="mb-1 text-muted">Safe metadata</p>
                <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-[10.5px] text-muted">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/* -------------------------------- settings ------------------------------- */

const moneySettingBounds: Record<string, { min: number; max: number; label: string }> = {
  'economy.starting_credits': { min: 0, max: 1_000_000_000_000, label: 'starting money' },
  'economy.max_payout': { min: 100, max: 1_000_000_000_000, label: 'maximum payout' },
  'economy.cashier_request_limit': { min: 1, max: 1_000_000_000_000, label: 'cashier request limit' },
};

function validateMoneySetting(key: string, value: unknown): string | null {
  const bounds = moneySettingBounds[key];
  if (!bounds) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return `Enter a valid ${bounds.label}, for example 5M, 5B or 1T.`;
  }
  if (value < bounds.min) return `Must be at least ${compactAmount(bounds.min)}.`;
  if (value > bounds.max) return `Must be at most ${compactAmount(bounds.max)}.`;
  return null;
}

const settingGroups: { title: string; description: string; keys: string[] }[] = [
  {
    title: 'Branding',
    description: 'Name and tagline used across the lobby and authentication screens.',
    keys: ['platform.name', 'platform.tagline'],
  },
  {
    title: 'Access & maintenance',
    description: 'Control registration and pause the player experience platform-wide.',
    keys: ['platform.registration_open', 'platform.maintenance', 'platform.maintenance_message'],
  },
  {
    title: 'Economy',
    description: 'Grant sizes and safety limits for internal money.',
    keys: ['economy.starting_credits', 'economy.max_payout', 'economy.cashier_request_limit'],
  },
  {
    title: 'Account safety',
    description: 'Shared-network review thresholds. Three accounts are allowed by default for households and shared connections.',
    keys: ['security.accounts_per_ip'],
  },
];

export function AdminSettingsPage() {
  const { success, error: toastError } = useToast();
  const { refreshConfig } = useAuth();
  const query = useApiQuery<{
    settings: Record<string, unknown>;
    categories: SupportCategory[];
  }>('/admin/settings');
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [categoryModal, setCategoryModal] = useState<SupportCategory | 'new' | null>(null);
  const [categoryForm, setCategoryForm] = useState<{
    key: string;
    label: string;
    description: string;
    defaultPriority: SupportCategory['defaultPriority'];
  }>({ key: '', label: '', description: '', defaultPriority: 'normal' });
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setForm(query.data.settings);
  }, [query.data]);

  const original = query.data?.settings ?? {};
  const changedKeys = (keys: string[]) => keys.filter((key) => JSON.stringify(original[key]) !== JSON.stringify(form[key]));

  const setValue = (key: string, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFields((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const setFieldError = (key: string, message: string | null) => {
    setFields((current) => {
      if (!message) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: message };
    });
  };

  const resetGroup = (keys: string[]) => {
    setForm((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = original[key];
      return next;
    });
    setFields((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
    setError(null);
  };

  const saveGroup = async (keys: string[]) => {
    const changed = changedKeys(keys);
    if (changed.length === 0) return;

    // An input with unparseable text keeps its last valid value in the form, so
    // changedKeys cannot see it. Block the save until the text is fixed.
    const unresolved = keys.find((key) => fields[key]);
    if (unresolved) {
      setError('Please check the highlighted fields.');
      toastError('Could not save settings', fields[unresolved] ?? 'Check the highlighted fields.');
      return;
    }

    const nextFields: Record<string, string> = {};
    for (const key of changed) {
      const issue = validateMoneySetting(key, form[key]);
      if (issue) nextFields[key] = issue;
    }
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      setError('Please check the highlighted fields.');
      toastError('Could not save settings', Object.values(nextFields)[0] ?? 'Check the highlighted fields.');
      return;
    }

    setBusy(keys[0] ?? 'save');
    setError(null);
    setFields((current) => {
      const next = { ...current };
      for (const key of changed) delete next[key];
      return next;
    });
    try {
      for (const key of changed) {
        await api.patch(`/admin/settings/${encodeURIComponent(key)}`, { value: form[key] });
      }
      success('Settings saved', `${changed.length} value${changed.length === 1 ? '' : 's'} updated.`);
      query.refetch();
      void refreshConfig();
    } catch (err) {
      const serverFields = err instanceof ApiRequestError ? err.fieldErrors : {};
      if (Object.keys(serverFields).length > 0) {
        setFields((current) => ({ ...current, ...serverFields }));
        setError('Please check the highlighted fields.');
        toastError('Could not save settings', Object.values(serverFields)[0] ?? 'Check the highlighted fields.');
      } else {
        setError(errorMessage(err));
        toastError('Could not save settings', errorMessage(err));
      }
      // A group saves one key at a time; refresh so already-saved values are reflected.
      query.refetch();
    } finally {
      setBusy(null);
    }
  };

  const openCategory = (category: SupportCategory | 'new') => {
    setCategoryError(null);
    setCategoryModal(category);
    if (category === 'new') {
      setCategoryForm({ key: '', label: '', description: '', defaultPriority: 'normal' });
    } else {
      setCategoryForm({
        key: category.key,
        label: category.label,
        description: category.description,
        defaultPriority: category.defaultPriority,
      });
    }
  };

  const saveCategory = async () => {
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      if (categoryModal === 'new') {
        await api.post('/admin/categories', { ...categoryForm, sortOrder: 100 });
      } else if (categoryModal) {
        await api.patch(`/admin/categories/${categoryModal.key}`, categoryForm);
      }
      success('Category saved');
      setCategoryModal(null);
      query.refetch();
    } catch (err) {
      setCategoryError(errorMessage(err));
    } finally {
      setCategoryBusy(false);
    }
  };

  const toggleCategory = async (category: SupportCategory) => {
    try {
      await api.patch(`/admin/categories/${category.key}`, { enabled: !category.enabled });
      query.refetch();
      success(category.enabled ? 'Category disabled' : 'Category enabled');
    } catch (err) {
      toastError('Could not update category', errorMessage(err));
    }
  };

  if (query.loading) return <LoadingBlock label="Loading settings" />;
  if (query.error) return <Alert tone="error">{query.error}</Alert>;

  const str = (key: string): string => (typeof form[key] === 'string' ? (form[key] as string) : '');
  const bool = (key: string): boolean => Boolean(form[key]);
  const num = (key: string): number => (typeof form[key] === 'number' ? (form[key] as number) : Number(form[key]) || 0);

  return (
    <div>
      <PageHeader
        title="Platform settings"
        description="Branding, access, economy limits, support categories, and notification configuration."
      />

      {error && <Alert tone="error" className="mb-4">{error}</Alert>}

      <div className="grid gap-5 xl:grid-cols-2">
        {settingGroups.map((group) => (
          <Card key={group.title}>
            <CardHeader
              title={group.title}
              description={group.description}
              action={
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null || changedKeys(group.keys).length === 0}
                    onClick={() => resetGroup(group.keys)}
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy === group.keys[0]}
                    disabled={changedKeys(group.keys).length === 0}
                    onClick={() => void saveGroup(group.keys)}
                  >
                    Save
                  </Button>
                </div>
              }
            />
            <div className="space-y-4 p-4">
              {group.keys.includes('platform.name') && (
                <Field label="Platform name" error={fields['platform.name']}>
                  <Input
                    value={str('platform.name')}
                    onChange={(event) => setValue('platform.name', event.target.value)}
                    invalid={Boolean(fields['platform.name'])}
                    maxLength={60}
                  />
                </Field>
              )}
              {group.keys.includes('platform.tagline') && (
                <Field label="Tagline" error={fields['platform.tagline']}>
                  <Input
                    value={str('platform.tagline')}
                    onChange={(event) => setValue('platform.tagline', event.target.value)}
                    invalid={Boolean(fields['platform.tagline'])}
                    maxLength={120}
                  />
                </Field>
              )}
              {group.keys.includes('platform.registration_open') && (
                <div className="flex items-center justify-between rounded-xl border border-line bg-surface-2/60 p-3">
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">Registration open</p>
                    <p className="text-[10.5px] text-muted">When off, new accounts cannot be created.</p>
                  </div>
                  <Toggle
                    checked={bool('platform.registration_open')}
                    onChange={(value) => setForm((current) => ({ ...current, 'platform.registration_open': value }))}
                    label="Registration open"
                  />
                </div>
              )}
              {group.keys.includes('platform.maintenance') && (
                <div className="flex items-center justify-between rounded-xl border border-warning/25 bg-warning/5 p-3">
                  <div>
                    <p className="text-[12.5px] font-medium text-ink">Platform maintenance</p>
                    <p className="text-[10.5px] text-muted">
                      Players see a maintenance screen. Wagers, new tickets, and registrations are paused; staff access
                      continues.
                    </p>
                  </div>
                  <Toggle
                    checked={bool('platform.maintenance')}
                    onChange={(value) => setForm((current) => ({ ...current, 'platform.maintenance': value }))}
                    label="Platform maintenance"
                  />
                </div>
              )}
              {group.keys.includes('platform.maintenance_message') && (
                <Field
                  label="Maintenance message"
                  hint="Shown to players while maintenance mode is on."
                  error={fields['platform.maintenance_message']}
                >
                  <Textarea
                    value={str('platform.maintenance_message')}
                    onChange={(event) => setValue('platform.maintenance_message', event.target.value)}
                    invalid={Boolean(fields['platform.maintenance_message'])}
                    rows={2}
                    maxLength={300}
                  />
                </Field>
              )}
              {group.keys.includes('platform.maintenance') && bool('platform.maintenance') && (
                <Alert tone="warning">
                  Save this group to apply. Open player tabs switch to the maintenance screen within 30 seconds. New
                  wagers, registrations, and ticket creation are blocked immediately on the server; staff access
                  continues.
                </Alert>
              )}
              {group.keys.includes('security.accounts_per_ip') && (
                <Field
                  label="Accounts allowed per public IP"
                  hint="A fourth player account from the same network triggers a review hold. Support can release legitimate households."
                  error={fields['security.accounts_per_ip']}
                >
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={String(num('security.accounts_per_ip'))}
                    onChange={(event) => setValue('security.accounts_per_ip', Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
                    invalid={Boolean(fields['security.accounts_per_ip'])}
                  />
                </Field>
              )}
              {group.keys.includes('economy.starting_credits') && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Starting money"
                    hint="Granted once at registration. Accepts K, M, B, and T."
                    error={fields['economy.starting_credits']}
                  >
                    <AmountInput
                      min={0}
                      value={num('economy.starting_credits')}
                      onChange={(value) => setValue('economy.starting_credits', value === '' ? 0 : value)}
                      onInvalid={(message) => setFieldError('economy.starting_credits', message)}
                      invalid={Boolean(fields['economy.starting_credits'])}
                      placeholder="5M"
                    />
                  </Field>
                  <Field
                    label="Maximum payout"
                    hint="Platform-wide cap per round. Accepts K, M, B, and T."
                    error={fields['economy.max_payout']}
                  >
                    <AmountInput
                      min={100}
                      value={num('economy.max_payout')}
                      onChange={(value) => setValue('economy.max_payout', value === '' ? 0 : value)}
                      onInvalid={(message) => setFieldError('economy.max_payout', message)}
                      invalid={Boolean(fields['economy.max_payout'])}
                      placeholder="1M"
                    />
                  </Field>
                  <Field
                    label="Cashier request limit"
                    hint="Maximum amount per deposit or withdrawal request. Accepts K, M, B, and T."
                    error={fields['economy.cashier_request_limit']}
                  >
                    <AmountInput
                      min={1}
                      value={num('economy.cashier_request_limit')}
                      onChange={(value) => setValue('economy.cashier_request_limit', value === '' ? 0 : value)}
                      onInvalid={(message) => setFieldError('economy.cashier_request_limit', message)}
                      invalid={Boolean(fields['economy.cashier_request_limit'])}
                      placeholder="5B"
                    />
                  </Field>
                </div>
              )}
            </div>
          </Card>
        ))}

        <Card className="overflow-hidden">
          <CardHeader
            title="Automation & delivery"
            description="Rewards and email now have their own focused settings pages."
            action={<Badge tone="success" dot>In-app on</Badge>}
          />
          <div className="space-y-3 p-4">
            <Link
              to="/admin/rewards"
              className="group flex items-start gap-3 rounded-xl border border-gold/15 bg-gold/[0.04] p-3.5 transition-colors hover:border-gold/30 hover:bg-gold/[0.07]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
                <Gift className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-ink">
                  Daily rewards
                  <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-faint transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Configure base rewards, streak growth, caps, milestones, timezone and missed-day policy.
                </p>
              </div>
            </Link>
            <Link
              to="/admin/email"
              className="group flex items-start gap-3 rounded-xl border border-line/80 bg-surface-2/40 p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/70"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-3 text-gold">
                <Mail className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-ink">
                  Email delivery (Brevo SMTP)
                  <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-faint transition-transform group-hover:translate-x-0.5" />
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  SMTP credentials, sender identity, security and reward emails, test delivery and the retry queue.
                </p>
              </div>
            </Link>
            <div className="flex items-center justify-between rounded-xl border border-line/80 bg-surface-2/40 p-3">
              <div>
                <p className="text-[12px] font-medium text-ink">In-app notifications</p>
                <p className="mt-0.5 text-[10.5px] text-muted">Ticket replies, decisions, account events and announcements.</p>
              </div>
              <Badge tone="success" dot>Always on</Badge>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Support categories"
          description="Categories are used by ticket creation and workflow configuration."
          action={
            <Button size="sm" variant="secondary" onClick={() => openCategory('new')} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Add category
            </Button>
          }
        />
        <TableWrap>
          <thead>
            <tr>
              <Th>Category</Th>
              <Th>Default priority</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {(query.data?.categories ?? []).map((category) => (
              <Tr key={category.key}>
                <Td>
                  <p className="text-[12.5px] font-medium text-ink">{category.label}</p>
                  <p className="text-[10.5px] text-faint">{category.key} · {category.description}</p>
                </Td>
                <Td className="capitalize">{category.defaultPriority}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Toggle checked={category.enabled} onChange={() => void toggleCategory(category)} label={`${category.label} enabled`} />
                    <span className="text-[10.5px] text-faint">{category.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </Td>
                <Td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => openCategory(category)}>Edit</Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
        Every setting change is validated server-side and recorded in the audit log. Security-sensitive environment
        configuration (session secret, database location, SMTP credentials) is managed outside the database.
      </p>

      <Modal
        open={Boolean(categoryModal)}
        onClose={() => setCategoryModal(null)}
        title={categoryModal === 'new' ? 'Add support category' : 'Edit support category'}
        description="Disabling a category prevents new tickets from using it; existing tickets keep their history."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCategoryModal(null)} disabled={categoryBusy}>Cancel</Button>
            <Button variant="primary" loading={categoryBusy} onClick={() => void saveCategory()} disabled={!categoryForm.label.trim() || (categoryModal === 'new' && !categoryForm.key.trim())}>
              Save category
            </Button>
          </>
        }
      >
        {categoryError && <Alert tone="error" className="mb-3">{categoryError}</Alert>}
        <div className="space-y-4">
          {categoryModal === 'new' && (
            <Field label="Key" hint="Lowercase letters, numbers, underscores. Permanent.">
              <Input value={categoryForm.key} onChange={(event) => setCategoryForm((current) => ({ ...current, key: event.target.value }))} placeholder="billing_question" maxLength={30} />
            </Field>
          )}
          <Field label="Label">
            <Input value={categoryForm.label} onChange={(event) => setCategoryForm((current) => ({ ...current, label: event.target.value }))} maxLength={60} />
          </Field>
          <Field label="Description">
            <Input value={categoryForm.description} onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))} maxLength={200} />
          </Field>
          <Field label="Default priority">
            <Select value={categoryForm.defaultPriority} onChange={(event) => setCategoryForm((current) => ({ ...current, defaultPriority: event.target.value as SupportCategory['defaultPriority'] }))}>
              {(['low', 'normal', 'high', 'urgent'] as const).map((level) => (
                <option key={level} value={level}>{titleCase(level)}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
