import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Mail,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  Send,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { EmailJobStatus, EmailJobSummary, EmailSettingsView } from '../../../shared/types';
import { PageHeader } from '../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  LoadingBlock,
  TableWrap,
  Td,
  Th,
  Toggle,
  Tr,
  cn,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useApiQuery } from '../../lib/useApi';
import { useToast } from '../../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../../lib/api';
import { dateTime, timeAgo } from '../../lib/format';

interface EmailForm {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  securityNotifications: boolean;
  rewardNotifications: boolean;
}

function toForm(data: EmailSettingsView): EmailForm {
  return {
    enabled: data.enabled,
    host: data.host,
    port: data.port,
    secure: data.secure,
    user: data.user,
    fromName: data.fromName,
    fromEmail: data.fromEmail,
    replyTo: data.replyTo,
    securityNotifications: data.securityNotifications,
    rewardNotifications: data.rewardNotifications,
  };
}

const statusTone: Record<EmailJobStatus, 'success' | 'warning' | 'danger' | 'info'> = {
  sent: 'success',
  pending: 'warning',
  sending: 'info',
  failed: 'danger',
};

function QueueRow({ job, onRetry, busy }: { job: EmailJobSummary; onRetry: (id: string) => void; busy: boolean }) {
  return (
    <Tr>
      <Td>
        <p className="max-w-[220px] truncate text-[11.5px] text-ink">{job.recipient}</p>
        <p className="text-[10px] text-faint">{job.template.replaceAll('-', ' ')}</p>
      </Td>
      <Td>
        <Badge tone={statusTone[job.status]} dot>
          {job.status}
        </Badge>
      </Td>
      <Td className="text-[11px] tnum">
        {job.attempts}/{job.maxAttempts}
      </Td>
      <Td className="max-w-[250px]">
        {job.lastError ? (
          <span className="line-clamp-2 text-[10.5px] text-danger" title={job.lastError}>
            {job.lastError}
          </span>
        ) : (
          <span className="text-[10.5px] text-faint">{job.sentAt ? `Sent ${timeAgo(job.sentAt)}` : `Queued ${timeAgo(job.createdAt)}`}</span>
        )}
      </Td>
      <Td className="text-right text-[10.5px] text-faint" title={dateTime(job.createdAt)}>
        {timeAgo(job.createdAt)}
      </Td>
      <Td className="text-right">
        {job.status === 'failed' && (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => onRetry(job.id)}>
            Retry
          </Button>
        )}
      </Td>
    </Tr>
  );
}

export function AdminEmailPage() {
  const query = useApiQuery<EmailSettingsView>('/admin/email');
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [form, setForm] = useState<EmailForm | null>(null);
  const [original, setOriginal] = useState<EmailForm | null>(null);
  const [smtpPass, setSmtpPass] = useState('');
  const [replacePass, setReplacePass] = useState(false);
  const [clearPass, setClearPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState(user?.email ?? '');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (query.data) {
      const next = toForm(query.data);
      setForm(next);
      setOriginal(next);
      setTestTo(user?.email ?? '');
    }
  }, [query.data, user?.email]);

  const dirty = useMemo(() => {
    if (!form || !original) return false;
    return JSON.stringify(form) !== JSON.stringify(original) || Boolean(smtpPass) || clearPass;
  }, [form, original, smtpPass, clearPass]);

  const ready = Boolean(form && form.host && form.user && form.fromEmail && (query.data?.smtpPassSet || smtpPass));

  const set = <K extends keyof EmailForm>(key: K, value: EmailForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setFields((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setError(null);
  };

  const reset = () => {
    if (original) setForm(original);
    setSmtpPass('');
    setReplacePass(false);
    setClearPass(false);
    setFields({});
    setError(null);
    setTestResult(null);
  };

  const persist = async (silent = false): Promise<boolean> => {
    if (!form || saving) return false;
    if (form.enabled && !ready) {
      setError('Complete the SMTP host, login, key and sender address before enabling email.');
      setFields({
        ...(form.host ? {} : { host: 'Enter the SMTP server.' }),
        ...(form.user ? {} : { user: 'Enter the SMTP login.' }),
        ...(query.data?.smtpPassSet || smtpPass ? {} : { smtpPass: 'Add the SMTP key.' }),
        ...(form.fromEmail ? {} : { fromEmail: 'Enter the sender address.' }),
      });
      return false;
    }
    setSaving(true);
    setError(null);
    setFields({});
    try {
      const result = await api.patch<EmailSettingsView>('/admin/email', {
        ...form,
        ...(smtpPass ? { smtpPass } : {}),
        ...(clearPass ? { clearSmtpPass: true } : {}),
      });
      const next = toForm(result);
      setForm(next);
      setOriginal(next);
      setSmtpPass('');
      setReplacePass(false);
      setClearPass(false);
      if (!silent) success('Email settings saved', result.enabled ? 'Outbound email is enabled.' : 'Settings saved. Email delivery is still disabled.');
      query.refetch();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
      toastError('Could not save email settings', errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      if (dirty) {
        const saved = await persist(true);
        if (!saved) return;
      }
      const result = await api.post<{ recipient: string }>('/admin/email/test', { to: testTo });
      setTestResult({ ok: true, message: `Test message accepted for ${result.recipient}. Check the inbox and spam folder.` });
      success('Test email sent', `Delivered to ${result.recipient}.`);
      query.refetch();
    } catch (err) {
      setTestResult({ ok: false, message: errorMessage(err) });
      toastError('Test email failed', errorMessage(err));
      query.refetch();
    } finally {
      setTesting(false);
    }
  };

  const processQueue = async () => {
    setProcessingQueue(true);
    try {
      const result = await api.post<{ result: { sent: number; failed: number; considered: number } }>('/admin/email/queue/process');
      success(
        'Queue processed',
        `${result.result.sent} sent · ${result.result.failed} retried or failed · ${result.result.considered} considered.`,
      );
      query.refetch();
    } catch (err) {
      toastError('Could not process the queue', errorMessage(err));
    } finally {
      setProcessingQueue(false);
    }
  };

  const retryJob = async (id: string) => {
    setRetrying(id);
    try {
      await api.post(`/admin/email/queue/${id}/retry`);
      success('Email queued for another attempt');
      query.refetch();
    } catch (err) {
      toastError('Could not retry that email', errorMessage(err));
    } finally {
      setRetrying(null);
    }
  };

  if (query.loading && !form) return <LoadingBlock label="Loading email settings" />;
  if (query.error && !form) {
    return (
      <>
        <PageHeader title="Email delivery" description="SMTP configuration and delivery queue." />
        <Alert tone="error" title="Could not load email settings">{query.error}</Alert>
        <Button className="mt-4" onClick={query.refetch}>Try again</Button>
      </>
    );
  }
  if (!form || !query.data) return null;

  const statusBadge = !form.enabled ? (
    <Badge tone="neutral" dot>Disabled</Badge>
  ) : ready ? (
    <Badge tone="success" dot>Ready</Badge>
  ) : (
    <Badge tone="warning" dot>Needs setup</Badge>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email delivery"
        description="Brevo SMTP for account security, rewards and announcements. Credentials are encrypted and never returned to the browser."
        badge={statusBadge}
        actions={
          <>
            <Button variant="ghost" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={!dirty || saving}>
              Reset
            </Button>
            <Button variant="primary" leftIcon={<Save className="h-4 w-4" />} loading={saving} onClick={() => void persist()} disabled={!dirty}>
              Save settings
            </Button>
          </>
        }
      />

      {!form.enabled && (
        <Alert tone="info" title="Email is currently off">
          In-app notifications and every game continue to work. Turn email on after you add a Brevo SMTP key and verify
          the sender address in Brevo.
        </Alert>
      )}
      {form.enabled && !ready && (
        <Alert tone="warning" title="Email is switched on but incomplete">
          Add the missing SMTP key or sender details, then save. Test delivery is available once the configuration is complete.
        </Alert>
      )}
      {error && (
        <Alert tone="error" title="Please check the highlighted fields">
          {error}
        </Alert>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="SMTP connection"
            description="Preconfigured for Brevo. Port 587 uses STARTTLS; port 465 uses implicit TLS."
            action={<Server className="h-4 w-4 text-gold" />}
          />
          <div className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-gold/15 bg-gold/[0.04] p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Enable outbound email</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  Queues verification, security, reward and announcement emails. A failure never blocks the app.
                </p>
              </div>
              <Toggle checked={form.enabled} onChange={(value) => set('enabled', value)} label="Enable outbound email" />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
              <Field label="SMTP server" error={fields.host} hint="Brevo relay: smtp-relay.brevo.com">
                <Input value={form.host} onChange={(event) => set('host', event.target.value)} invalid={Boolean(fields.host)} placeholder="smtp-relay.brevo.com" autoComplete="off" />
              </Field>
              <Field label="Port" error={fields.port}>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={String(form.port)}
                  onChange={(event) => set('port', Number(event.target.value) || 587)}
                  invalid={Boolean(fields.port)}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-ink">Implicit TLS (port 465)</p>
                <p className="mt-0.5 text-[11px] text-muted">Leave off for STARTTLS on port 587.</p>
              </div>
              <Toggle checked={form.secure} onChange={(value) => set('secure', value)} label="Implicit TLS" />
            </div>
            <Field label="SMTP login" error={fields.user} hint="The Brevo SMTP login, not your Brevo account email.">
              <Input
                value={form.user}
                onChange={(event) => set('user', event.target.value)}
                invalid={Boolean(fields.user)}
                placeholder="c05ccf001@smtp-brevo.com"
                autoComplete="off"
              />
            </Field>
            <Field
              label="SMTP key"
              error={fields.smtpPass}
              hint="Stored encrypted at rest. It is never returned to the browser or written to logs."
            >
              {query.data.smtpPassSet && !replacePass && !clearPass ? (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line/90 bg-surface-2/70 px-3.5">
                    <KeyRound className="h-4 w-4 text-gold" />
                    <span className="font-mono text-[12px] tracking-[0.2em] text-muted">••••••••••••••••</span>
                    <Badge tone={query.data.smtpPassSource === 'database' ? 'success' : 'info'} className="ml-auto">
                      {query.data.smtpPassSource === 'database' ? 'Encrypted' : 'From environment'}
                    </Badge>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => { setReplacePass(true); setClearPass(false); }}>
                    Replace
                  </Button>
                  {query.data.smtpPassSource === 'database' && (
                    <Button size="sm" variant="ghost" className="text-faint hover:text-danger" onClick={() => { setClearPass(true); setReplacePass(false); setSmtpPass(''); }}>
                      Remove
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    value={smtpPass}
                    onChange={(event) => {
                      setSmtpPass(event.target.value);
                      setClearPass(false);
                    }}
                    invalid={Boolean(fields.smtpPass)}
                    placeholder="Paste your Brevo SMTP key"
                    autoComplete="new-password"
                    className="min-w-0 flex-1"
                  />
                  {(query.data.smtpPassSet || smtpPass) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setReplacePass(false);
                        setSmtpPass('');
                        setClearPass(false);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              )}
              {clearPass && (
                <p className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                  The saved key will be removed when you save. Email will be disabled if no environment key exists.
                </p>
              )}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Sender & notifications"
            description="The sender address must be verified in your Brevo account."
            action={<Mail className="h-4 w-4 text-gold" />}
          />
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sender name" error={fields.fromName}>
                <Input value={form.fromName} onChange={(event) => set('fromName', event.target.value)} invalid={Boolean(fields.fromName)} placeholder="Donutcash" />
              </Field>
              <Field label="Sender address" error={fields.fromEmail} hint="Must be verified in Brevo.">
                <Input
                  type="email"
                  value={form.fromEmail}
                  onChange={(event) => set('fromEmail', event.target.value)}
                  invalid={Boolean(fields.fromEmail)}
                  placeholder="no-reply@yourdomain.com"
                  autoComplete="off"
                />
              </Field>
            </div>
            <Field label="Reply-to address" error={fields.replyTo} hint="Optional. Replies will go here instead of the sender.">
              <Input
                type="email"
                value={form.replyTo}
                onChange={(event) => set('replyTo', event.target.value)}
                invalid={Boolean(fields.replyTo)}
                placeholder="support@yourdomain.com"
                autoComplete="off"
              />
            </Field>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
                <div>
                  <p className="text-[12.5px] font-semibold text-ink">Security alerts</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">New sign-ins, password changes and email changes.</p>
                </div>
                <Toggle checked={form.securityNotifications} onChange={(value) => set('securityNotifications', value)} label="Security alert emails" />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
                <div>
                  <p className="text-[12.5px] font-semibold text-ink">Reward reminders</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">Claim confirmations, streaks and milestone bonuses.</p>
                </div>
                <Toggle checked={form.rewardNotifications} onChange={(value) => set('rewardNotifications', value)} label="Reward reminder emails" />
              </div>
            </div>
            <div className="rounded-xl border border-line/80 bg-surface-2/40 p-3.5">
              <p className="flex items-center gap-2 text-[11.5px] font-semibold text-ink">
                <Send className="h-3.5 w-3.5 text-gold" /> Send a test
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
                Uses the saved settings. If you have unsaved changes, they are saved first.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  value={testTo}
                  onChange={(event) => setTestTo(event.target.value)}
                  placeholder="you@example.com"
                  className="min-w-0 flex-1"
                  autoComplete="off"
                />
                <Button variant="secondary" loading={testing} onClick={() => void sendTest()} disabled={!testTo.trim()} leftIcon={<Send className="h-3.5 w-3.5" />}>
                  Send test
                </Button>
              </div>
              {testResult && (
                <div className={cn('mt-3', testResult.ok ? 'text-success' : 'text-danger')}>
                  <Alert tone={testResult.ok ? 'success' : 'error'}>{testResult.message}</Alert>
                </div>
              )}
              {query.data.lastTestAt && (
                <p className="mt-2 flex items-center gap-1.5 text-[10px] text-faint">
                  <CheckCircle2 className="h-3 w-3 text-success" /> Last successful test {timeAgo(query.data.lastTestAt)}
                </p>
              )}
              {query.data.lastError && (
                <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-danger">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {query.data.lastError}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Delivery queue"
          description="Mail is queued and retried with backoff. Failures are logged here without credentials."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{query.data.counts.pending} pending</Badge>
              <Badge tone="success">{query.data.counts.sent} sent</Badge>
              <Badge tone="danger">{query.data.counts.failed} failed</Badge>
              <Button size="sm" variant="secondary" loading={processingQueue} onClick={() => void processQueue()} leftIcon={<Play className="h-3.5 w-3.5" />}>
                Process now
              </Button>
              <Button size="sm" variant="ghost" onClick={query.refetch} aria-label="Refresh queue">
                <RefreshCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          }
        />
        {query.data.queue.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12px] text-muted">No email jobs yet. Queued mail will appear here.</div>
        ) : (
          <TableWrap minWidth={760}>
            <thead>
              <tr>
                <Th>Recipient</Th>
                <Th>Status</Th>
                <Th>Attempts</Th>
                <Th>Last result</Th>
                <Th className="text-right">Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {query.data.queue.map((job) => (
                <QueueRow key={job.id} job={job} busy={retrying === job.id} onRetry={(id) => void retryJob(id)} />
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <div className="rounded-xl border border-line/70 bg-surface-2/30 px-4 py-3 text-[10.5px] leading-relaxed text-faint">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
          Brevo checklist: create an SMTP key in Brevo, verify the sender domain or address, then paste the key here.
          The SMTP key is encrypted with the server secret and is never shown again after saving.
        </p>
        <p className="mt-2 flex items-start gap-2">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          If a test fails, confirm port 587 with TLS enabled, the full SMTP login, and that the sender address is an
          authorized Brevo sender.
        </p>
      </div>
    </div>
  );
}
