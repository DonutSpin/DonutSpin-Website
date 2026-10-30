import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Coins,
  Flame,
  Gift,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import type { RewardMilestone } from '../../../shared/types';
import { PageHeader } from '../../components/layout';
import {
  Alert,
  AmountInput,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  LoadingBlock,
  Select,
  StatCard,
  TableWrap,
  Td,
  Th,
  Toggle,
  Tr,
  cn,
} from '../../components/ui';
import { useApiQuery } from '../../lib/useApi';
import { useToast } from '../../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { money, dateTime, timeAgo } from '../../lib/format';

interface AdminRewardsView {
  enabled: boolean;
  timezone: string;
  resetHour: number;
  baseAmount: number;
  incrementAmount: number;
  maxAmount: number;
  maxStreakDays: number;
  missedPolicy: 'reset' | 'grace';
  graceDays: number;
  milestones: RewardMilestone[];
  emailEnabled: boolean;
  claimsToday: number;
  claimsAllTime: number;
  totalPaid: number;
  recentClaims: {
    id: string;
    username: string;
    day: string;
    streakDay: number;
    baseAmount: number;
    incrementAmount: number;
    milestoneAmount: number;
    amount: number;
    createdAt: string;
  }[];
}

interface FormState {
  enabled: boolean;
  timezone: string;
  resetHour: number;
  baseAmount: number;
  incrementAmount: number;
  maxAmount: number;
  maxStreakDays: number;
  missedPolicy: 'reset' | 'grace';
  graceDays: number;
  milestones: RewardMilestone[];
  emailEnabled: boolean;
}

function toForm(data: AdminRewardsView): FormState {
  return {
    enabled: data.enabled,
    timezone: data.timezone,
    resetHour: data.resetHour,
    baseAmount: data.baseAmount,
    incrementAmount: data.incrementAmount,
    maxAmount: data.maxAmount,
    maxStreakDays: data.maxStreakDays,
    missedPolicy: data.missedPolicy,
    graceDays: data.graceDays,
    milestones: data.milestones.map((milestone) => ({ ...milestone })),
    emailEnabled: data.emailEnabled,
  };
}

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Amsterdam',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function AdminRewardsPage() {
  const query = useApiQuery<AdminRewardsView>('/admin/rewards');
  const { success, error: toastError } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [original, setOriginal] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (query.data) {
      const next = toForm(query.data);
      setForm(next);
      setOriginal(next);
    }
  }, [query.data]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(original), [form, original]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setError(null);
    setFields({});
  };

  const setMilestone = (index: number, patch: Partial<RewardMilestone>) => {
    setForm((current) => {
      if (!current) return current;
      const milestones = current.milestones.map((milestone, position) =>
        position === index ? { ...milestone, ...patch } : milestone,
      );
      return { ...current, milestones };
    });
    setFields({});
  };

  const addMilestone = () => {
    if (!form || form.milestones.length >= 12) return;
    const used = new Set(form.milestones.map((milestone) => milestone.day));
    let day = 7;
    while (used.has(day) && day < form.maxStreakDays) day += 1;
    setForm({
      ...form,
      milestones: [...form.milestones, { day: Math.min(day, form.maxStreakDays), amount: 100_000, label: `Day ${Math.min(day, form.maxStreakDays)} bonus` }],
    });
  };

  const removeMilestone = (index: number) => {
    setForm((current) =>
      current ? { ...current, milestones: current.milestones.filter((_, position) => position !== index) } : current,
    );
  };

  const reset = () => {
    if (original) setForm(original);
    setFields({});
    setError(null);
  };

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const result = await api.patch<AdminRewardsView>('/admin/rewards', {
        ...form,
        milestones: form.milestones.map((milestone) => ({
          day: Math.trunc(milestone.day),
          amount: Math.trunc(milestone.amount),
          label: milestone.label.trim(),
        })),
      });
      const next = toForm(result);
      setForm(next);
      setOriginal(next);
      success('Rewards saved', 'The new daily reward, streak and milestone rules are live.');
      query.refetch();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      toastError('Could not save rewards', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (query.loading && !form) return <LoadingBlock label="Loading rewards programme" />;
  if (query.error && !form) {
    return (
      <>
        <PageHeader title="Rewards programme" description="Daily drops, streaks and milestones." />
        <Alert tone="error" title="Could not load rewards settings">{query.error}</Alert>
        <Button className="mt-4" onClick={query.refetch}>Try again</Button>
      </>
    );
  }
  if (!form || !query.data) return null;

  const nextMilestone = form.milestones.slice().sort((a, b) => a.day - b.day)[0];
  const maxDaily = Math.min(form.maxAmount, form.baseAmount + form.incrementAmount * Math.max(0, form.maxStreakDays - 1));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rewards programme"
        description="Design the daily drop, streak curve and milestone bonuses. Every change is validated and audited."
        badge={form.enabled ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Paused</Badge>}
        actions={
          <>
            <Button variant="ghost" leftIcon={<RefreshCcw className="h-4 w-4" />} onClick={reset} disabled={!dirty || saving}>
              Reset
            </Button>
            <Button variant="primary" leftIcon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void save()} disabled={!dirty}>
              Save changes
            </Button>
          </>
        }
      />

      {error && (
        <Alert tone="error" title="Please check the highlighted fields">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Claims today" value={query.data.claimsToday} hint="Across every player" icon={<Gift className="h-4 w-4" />} tone="gold" />
        <StatCard label="Claims all time" value={query.data.claimsAllTime} hint="Daily drops recorded" icon={<Users className="h-4 w-4" />} tone="info" />
        <StatCard label="Total paid" value={money(query.data.totalPaid)} hint="DonutSMP money from rewards" icon={<Coins className="h-4 w-4" />} tone="success" />
        <StatCard label="Day-one reward" value={money(form.baseAmount)} hint={nextMilestone ? `First milestone day ${nextMilestone.day}` : 'No milestones configured'} icon={<Flame className="h-4 w-4" />} tone="violet" />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Programme & schedule"
            description="Control availability, the reset clock and reminder emails."
            action={<Badge tone={form.emailEnabled ? 'success' : 'neutral'}>{form.emailEnabled ? 'Emails on' : 'Emails off'}</Badge>}
          />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Daily rewards enabled</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  When off, players see a paused state and cannot claim. Existing streaks are preserved.
                </p>
              </div>
              <Toggle checked={form.enabled} onChange={(value) => set('enabled', value)} label="Daily rewards enabled" />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Reward reminder emails</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  Email players after a claim, if they have email notifications enabled and SMTP is configured.
                </p>
              </div>
              <Toggle checked={form.emailEnabled} onChange={(value) => set('emailEnabled', value)} label="Reward reminder emails" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Timezone"
                hint="IANA timezone used for the daily reset and streak days."
                error={fields.timezone}
                htmlFor="rewards-timezone"
              >
                <Input
                  id="rewards-timezone"
                  list="timezone-options"
                  value={form.timezone}
                  onChange={(event) => set('timezone', event.target.value)}
                  invalid={Boolean(fields.timezone)}
                  placeholder="Europe/London"
                  autoComplete="off"
                />
                <datalist id="timezone-options">
                  {COMMON_TIMEZONES.map((timezone) => <option key={timezone} value={timezone} />)}
                </datalist>
              </Field>
              <Field label="Reset hour" hint="Local hour (0–23) when a new reward day begins." error={fields.resetHour}>
                <Select value={String(form.resetHour)} onChange={(event) => set('resetHour', Number(event.target.value))}>
                  {Array.from({ length: 24 }).map((_, hour) => (
                    <option key={hour} value={hour}>
                      {String(hour).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="rounded-xl border border-line/70 bg-surface-2/35 px-3.5 py-3 text-[10.5px] leading-relaxed text-faint">
              <span className="flex items-center gap-1.5 font-semibold text-muted">
                <CalendarClock className="h-3.5 w-3.5 text-gold" /> Current reset
              </span>
              <p className="mt-1">
                A reward day starts at {String(form.resetHour).padStart(2, '0')}:00 in {form.timezone || 'UTC'}. Changing
                the timezone or hour shifts when the claim button unlocks; existing claim days remain recorded.
              </p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reward formula" description="Base amount, streak growth, cap and missed-day behaviour." />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Day-one reward" hint="Money granted on a fresh streak." error={fields.baseAmount}>
                <AmountInput value={form.baseAmount} onChange={(value) => set('baseAmount', value === '' ? 0 : value)} invalid={Boolean(fields.baseAmount)} placeholder="50k" />
              </Field>
              <Field label="Increase per streak day" hint="Added for every consecutive day claimed." error={fields.incrementAmount}>
                <AmountInput value={form.incrementAmount} onChange={(value) => set('incrementAmount', value === '' ? 0 : value)} invalid={Boolean(fields.incrementAmount)} placeholder="10k" />
              </Field>
              <Field label="Daily reward cap" hint="Caps the streak portion. Milestone bonuses are added on top." error={fields.maxAmount}>
                <AmountInput value={form.maxAmount} onChange={(value) => set('maxAmount', value === '' ? 0 : value)} invalid={Boolean(fields.maxAmount)} placeholder="500k" />
              </Field>
              <Field label="Maximum streak length" hint="The streak counter stops growing here." error={fields.maxStreakDays}>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={String(form.maxStreakDays)}
                  onChange={(event) => set('maxStreakDays', Math.max(1, Math.min(3650, Number(event.target.value) || 1)))}
                  invalid={Boolean(fields.maxStreakDays)}
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Missed-day policy" hint="What happens when a day is skipped.">
                <Select value={form.missedPolicy} onChange={(event) => set('missedPolicy', event.target.value as FormState['missedPolicy'])}>
                  <option value="reset">Reset the streak</option>
                  <option value="grace">Allow a grace period</option>
                </Select>
              </Field>
              <Field
                label="Grace days"
                hint="Skipped days tolerated before a reset."
                error={fields.graceDays}
              >
                <Input
                  type="number"
                  min={0}
                  max={14}
                  value={String(form.graceDays)}
                  onChange={(event) => set('graceDays', Math.max(0, Math.min(14, Number(event.target.value) || 0)))}
                  disabled={form.missedPolicy !== 'grace'}
                  invalid={Boolean(fields.graceDays)}
                />
              </Field>
            </div>
            <div className="rounded-xl border border-gold/15 bg-gold/[0.04] px-3.5 py-3 text-[10.5px] leading-relaxed text-muted">
              At the current curve, a capped streak day pays <span className="font-semibold text-gold-bright">{money(maxDaily)}</span> before
              milestone bonuses. The cap is a safety limit, not a target — it can be higher than the curve.
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Milestone bonuses"
          description="Optional bonus money on specific streak days. Up to 12 milestones."
          action={
            <Button size="sm" variant="secondary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addMilestone} disabled={form.milestones.length >= 12}>
              Add milestone
            </Button>
          }
        />
        {form.milestones.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[12px] text-muted">No milestones configured. Players still earn the normal streak reward.</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={addMilestone} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Add the first milestone
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-line/60">
            {form.milestones.map((milestone, index) => {
              const fieldError = (key: string) => fields[`milestones.${index}.${key}`];
              return (
                <div key={index} className="grid gap-3 p-4 sm:grid-cols-[92px_1fr_1.4fr_auto] sm:items-start">
                  <Field label="Day" error={fieldError('day')}>
                    <Input
                      type="number"
                      min={1}
                      max={form.maxStreakDays}
                      value={String(milestone.day)}
                      onChange={(event) => setMilestone(index, { day: Number(event.target.value) || 1 })}
                      invalid={Boolean(fieldError('day'))}
                    />
                  </Field>
                  <Field label="Bonus" error={fieldError('amount')}>
                    <AmountInput
                      value={milestone.amount}
                      onChange={(value) => setMilestone(index, { amount: value === '' ? 0 : value })}
                      invalid={Boolean(fieldError('amount'))}
                      placeholder="100k"
                    />
                  </Field>
                  <Field label="Label" error={fieldError('label')}>
                    <Input
                      value={milestone.label}
                      onChange={(event) => setMilestone(index, { label: event.target.value })}
                      maxLength={60}
                      invalid={Boolean(fieldError('label'))}
                      placeholder="Week one bonus"
                    />
                  </Field>
                  <div className="flex items-end pb-0.5 sm:pt-6">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeMilestone(index)}
                      aria-label={`Remove ${milestone.label}`}
                      className="text-faint hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Recent claims"
          description="The latest daily drops across every player."
          action={<Badge tone="neutral">{query.data.recentClaims.length} shown</Badge>}
        />
        {query.data.recentClaims.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12px] text-muted">No rewards claimed yet.</div>
        ) : (
          <TableWrap minWidth={640}>
            <thead>
              <tr>
                <Th>Player</Th>
                <Th>Reward day</Th>
                <Th>Streak</Th>
                <Th>Breakdown</Th>
                <Th className="text-right">Paid</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody>
              {query.data.recentClaims.map((claim) => (
                <Tr key={claim.id}>
                  <Td className="text-ink">{claim.username}</Td>
                  <Td className="tnum">{claim.day}</Td>
                  <Td className="tnum">{claim.streakDay}</Td>
                  <Td className="text-[11px]">
                    {money(claim.baseAmount)} base
                    {claim.milestoneAmount > 0 ? ` + ${money(claim.milestoneAmount)} milestone` : ''}
                  </Td>
                  <Td className="text-right font-semibold text-success tnum">+{money(claim.amount)}</Td>
                  <Td className="text-right text-[11px] text-faint" title={dateTime(claim.createdAt)}>{timeAgo(claim.createdAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border border-line/70 bg-surface-2/30 px-4 py-3 text-[10.5px] leading-relaxed text-faint sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
          Claims are atomic and unique per player per reward day. Settings changes are written to the audit log.
        </span>
        <Button variant={dirty ? 'primary' : 'secondary'} size="sm" loading={saving} onClick={() => void save()} disabled={!dirty} className={cn(!dirty && 'opacity-60')}>
          <Save className="h-3.5 w-3.5" /> Save changes
        </Button>
      </div>
    </div>
  );
}
