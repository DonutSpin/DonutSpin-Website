import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  Bot,
  CheckCircle2,
  Copy,
  HeartHandshake,
  KeyRound,
  Link2,
  LifeBuoy,
  Lock,
  LogOut,
  MailCheck,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { DiscordLinkCodeResponse, DiscordLinkStatus, SessionUser } from '../../shared/types';
import { SELF_EXCLUSION_DURATIONS, type SelfExclusionDuration } from '../../shared/legal';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { dateTime, timeAgo, titleCase } from '../lib/format';
import { useApiQuery } from '../lib/useApi';
import { PageHeader } from '../components/layout';
import {
  AccountStatusBadge,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  LoadingBlock,
  RoleBadge,
  Select,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui';

interface SessionItem {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function deviceName(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iphone|android|mobile/i.test(userAgent)) return 'Mobile browser';
  if (/edg\//i.test(userAgent)) return 'Microsoft Edge';
  if (/chrome\//i.test(userAgent)) return 'Chrome browser';
  if (/firefox\//i.test(userAgent)) return 'Firefox browser';
  if (/safari\//i.test(userAgent)) return 'Safari browser';
  return 'Web browser';
}

export function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const { success, error: toastError } = useToast();
  const [params] = useSearchParams();
  const initialTab = params.get('tab');
  const [tab, setTab] = useState(
    initialTab === 'responsible' || initialTab === 'security' || initialTab === 'discord' ? initialTab : 'profile',
  );
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [emailNotifications, setEmailNotifications] = useState(user?.emailNotifications ?? true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [devVerifyPath, setDevVerifyPath] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordFields, setPasswordFields] = useState<Record<string, string>>({});

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteAck, setDeleteAck] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const [deleteDevPath, setDeleteDevPath] = useState<string | null>(null);

  const [exclusionDuration, setExclusionDuration] = useState<SelfExclusionDuration>('24h');
  const [exclusionReason, setExclusionReason] = useState('');
  const [exclusionConfirmed, setExclusionConfirmed] = useState(false);
  const [exclusionBusy, setExclusionBusy] = useState(false);
  const [exclusionError, setExclusionError] = useState<string | null>(null);

  const sessionsQuery = useApiQuery<{ items: SessionItem[] }>('/me/sessions');
  const discordQuery = useApiQuery<{ link: DiscordLinkStatus; botConfigured: boolean }>('/me/discord');
  const [discordCode, setDiscordCode] = useState<DiscordLinkCodeResponse | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email);
      setEmailNotifications(user.emailNotifications);
    }
  }, [user]);

  useEffect(() => {
    if (window.location.hash === '#discord') setTab('discord');
  }, []);

  if (!user) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileBusy(true);
    setProfileError(null);
    setFields({});
    try {
      const emailChanged = email.toLowerCase() !== user.email.toLowerCase();
      const result = await api.patch<{ user: SessionUser }>('/me', { username, email, emailNotifications });
      setUser(result.user);
      success(
        'Profile updated',
        emailChanged ? 'Check your inbox to verify the new address. Your previous email was notified.' : 'Your account details are up to date.',
      );
      if (emailChanged) setResendNote(null);
    } catch (err) {
      setProfileError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setProfileBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordFields({});
    if (newPassword !== confirmPassword) {
      setPasswordFields({ confirmPassword: 'Passwords do not match.' });
      return;
    }
    setPasswordBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      success('Password changed', 'Other active sessions were signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      sessionsQuery.refetch();
    } catch (err) {
      setPasswordError(errorMessage(err));
      if (err instanceof ApiRequestError) setPasswordFields(err.fieldErrors);
    } finally {
      setPasswordBusy(false);
    }
  };

  const resendVerification = async () => {
    setResendBusy(true);
    setResendNote(null);
    setDevVerifyPath(null);
    try {
      const result = await api.post<{ sent: boolean; message: string; verifyPath?: string }>('/auth/resend-verification');
      setResendNote(result.message);
      if (result.verifyPath) setDevVerifyPath(result.verifyPath);
      success(result.sent ? 'Verification email sent' : 'Verification unavailable', result.message);
    } catch (err) {
      toastError('Could not resend verification', errorMessage(err));
    } finally {
      setResendBusy(false);
    }
  };

  const revokeSession = async (id: string) => {
    try {
      await api.delete(`/me/sessions/${id}`);
      sessionsQuery.refetch();
      success('Session revoked');
    } catch (err) {
      toastError('Could not revoke session', errorMessage(err));
    }
  };

  const revokeOthers = async () => {
    try {
      await api.post('/me/sessions/revoke-others');
      sessionsQuery.refetch();
      success('Other sessions signed out');
    } catch (err) {
      toastError('Could not revoke sessions', errorMessage(err));
    }
  };

  const requestAccountDeletion = async (event: FormEvent) => {
    event.preventDefault();
    setDeleteError(null);
    setDeleteNotice(null);
    setDeleteDevPath(null);
    if (!deleteAck) {
      setDeleteError('Confirm that you understand this action cannot be undone.');
      return;
    }
    setDeleteBusy(true);
    try {
      const result = await api.post<{ message: string; sent: boolean; deletePath?: string }>(
        '/me/delete-account/request',
        { password: deletePassword },
      );
      setDeleteNotice(result.message);
      setDeleteDevPath(result.deletePath ?? null);
      setDeletePassword('');
      setDeleteAck(false);
      success('Deletion email sent', result.message);
    } catch (err) {
      setDeleteError(errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const generateDiscordCode = async () => {
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      const result = await api.post<DiscordLinkCodeResponse>('/me/discord/code');
      setDiscordCode(result);
      setCopied(false);
      success('Link code ready', 'Run the shown command in Discord within 15 minutes.');
    } catch (err) {
      setDiscordError(errorMessage(err));
      toastError('Could not create a link code', errorMessage(err));
    } finally {
      setDiscordBusy(false);
    }
  };

  const copyDiscordCommand = async () => {
    if (!discordCode) return;
    try {
      await navigator.clipboard.writeText(discordCode.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setDiscordError('Your browser blocked clipboard access. Select the command and copy it manually.');
    }
  };

  const unlinkDiscordAccount = async () => {
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      await api.delete('/me/discord');
      setDiscordCode(null);
      setUnlinkOpen(false);
      discordQuery.refetch();
      success('Discord disconnected', 'Your website account and balance are unchanged.');
    } catch (err) {
      setDiscordError(errorMessage(err));
      toastError('Could not unlink Discord', errorMessage(err));
    } finally {
      setDiscordBusy(false);
    }
  };

  const startSelfExclusion = async () => {
    if (!exclusionConfirmed) return;
    setExclusionError(null);
    setExclusionBusy(true);
    try {
      await api.post('/me/self-exclusion', {
        duration: exclusionDuration,
        reason: exclusionReason.trim() || undefined,
      });
      window.location.assign('/responsible-gambling?selfExcluded=1');
    } catch (err) {
      setExclusionError(errorMessage(err));
      setExclusionBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Profile & settings" description="Manage your identity, password, and active sessions." />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <Tabs
            items={[
              { key: 'profile', label: 'Profile' },
              { key: 'security', label: 'Security' },
              { key: 'discord', label: 'Discord' },
              { key: 'responsible', label: 'Responsible play' },
              { key: 'sessions', label: 'Sessions' },
            ]}
            value={tab}
            onChange={setTab}
            className="px-2"
          />

          {tab === 'profile' && (
            <form onSubmit={(event) => void saveProfile(event)} className="space-y-5 p-5">
              {profileError && (
                <Alert tone="error" title="Could not update profile">
                  {profileError}
                </Alert>
              )}
              <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/50 p-3.5">
                <Avatar name={user.username} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{user.username}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <RoleBadge role={user.role} />
                    <AccountStatusBadge status={user.status} />
                  </div>
                </div>
                {user.emailVerified ? (
                  <Badge tone="success">
                    <BadgeCheck className="h-3 w-3" /> Email verified
                  </Badge>
                ) : (
                  <Badge tone="neutral">Email unverified</Badge>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username" htmlFor="profile-username" error={fields.username} hint="3–20 characters, unique across DonutSpin.">
                  <Input
                    id="profile-username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    invalid={Boolean(fields.username)}
                  />
                </Field>
                <Field label="Email" htmlFor="profile-email" error={fields.email} hint="Changing your email requires re-verification when email is configured.">
                  <Input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    invalid={Boolean(fields.email)}
                  />
                </Field>
              </div>
              {!user.emailVerified && (
                <div className="rounded-xl border border-warning/25 bg-warning/[0.05] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                        <MailCheck className="h-3.5 w-3.5 text-warning" /> Verify your email
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted">
                        Confirming {user.email} unlocks account recovery and security alerts.
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" loading={resendBusy} onClick={() => void resendVerification()}>
                      Resend verification
                    </Button>
                  </div>
                  {resendNote && <p className="mt-2 text-[11px] text-muted">{resendNote}</p>}
                  {devVerifyPath && (
                    <Link to={devVerifyPath} className="mt-1 inline-block text-[11px] font-medium text-gold underline">
                      Open the local verification link
                    </Link>
                  )}
                </div>
              )}
              <div id="email" className="flex scroll-mt-24 items-center justify-between gap-4 rounded-xl border border-line/80 bg-surface-2/50 p-3.5">
                <div>
                  <p className="text-[12.5px] font-semibold text-ink">Email notifications</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                    Reward reminders and streak milestones. Security alerts are always sent.
                  </p>
                </div>
                <Toggle checked={emailNotifications} onChange={setEmailNotifications} label="Email notifications" />
              </div>
              <div className="flex items-center justify-between border-t border-line pt-4">
                <p className="text-[11px] text-faint">Joined {dateTime(user.createdAt)}</p>
                <Button type="submit" variant="primary" loading={profileBusy}>
                  Save changes
                </Button>
              </div>
            </form>
          )}

          {tab === 'discord' && (
            <div id="discord" className="scroll-mt-24 space-y-5 p-5">
              <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/50 p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold/25 bg-gold/10 text-gold">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[15px] font-semibold text-ink">DonutSpin Discord</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    Link one Discord account to this website account. The same wallet, giveaways, codes, invites, and
                    reputation are used on both platforms.
                  </p>
                </div>
                {discordQuery.data?.link.linked ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
              </div>

              {discordError && <Alert tone="error">{discordError}</Alert>}
              {!discordQuery.data?.botConfigured && (
                <Alert tone="warning" title="Discord bot is not configured on this site yet">
                  An administrator must set <code className="rounded bg-black/20 px-1">DISCORD_BOT_API_KEY</code> before
                  linking can complete.
                </Alert>
              )}

              {discordQuery.loading ? (
                <LoadingBlock label="Checking Discord link" />
              ) : discordQuery.data?.link.linked ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-success/25 bg-success/[0.05] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <p className="text-[13px] font-semibold text-ink">{discordQuery.data.link.discordUsername}</p>
                      <Badge tone="success">Verified link</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      Connected {discordQuery.data.link.linkedAt ? dateTime(discordQuery.data.link.linkedAt) : 'recently'}.
                      Commands such as /balance, /invites, /vouches, and giveaway entries use @{user.username}.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/80 bg-surface-2/45 p-3.5">
                    <div>
                      <p className="text-[12.5px] font-semibold text-ink">Disconnect Discord</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        This only removes the link. Your balance, ledger, wins, and invites stay on your account.
                      </p>
                    </div>
                    <Button variant="danger" size="sm" onClick={() => setUnlinkOpen(true)}>
                      Unlink
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { step: '1', title: 'Generate a code', body: 'Create a single-use code below. It expires in 15 minutes.' },
                      { step: '2', title: 'Open Discord', body: 'Join the DonutSpin server and run the /link command.' },
                      { step: '3', title: 'Enter the code', body: 'The bot confirms the link and your website username.' },
                    ].map((item) => (
                      <div key={item.step} className="rounded-xl border border-line/80 bg-surface-2/45 p-3.5">
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-gold/10 text-[11px] font-bold text-gold">
                          {item.step}
                        </span>
                        <p className="mt-2 text-[12px] font-semibold text-ink">{item.title}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.body}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-line/80 bg-surface-2/45 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[12.5px] font-semibold text-ink">Your one-time link code</p>
                        <p className="mt-0.5 text-[11px] text-muted">Never share this code. It can connect your website account once.</p>
                      </div>
                      <Button variant="primary" loading={discordBusy} leftIcon={<Link2 className="h-4 w-4" />} onClick={() => void generateDiscordCode()}>
                        {discordCode ? 'Generate another' : 'Generate link code'}
                      </Button>
                    </div>
                    {discordCode && (
                      <div className="mt-4 rounded-xl border border-gold/25 bg-gold/[0.05] p-4">
                        <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-gold-dim">Run this in Discord</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <code className="rounded-lg border border-line/80 bg-surface-0/70 px-3 py-2 font-mono text-[13px] text-ink">
                            {discordCode.command}
                          </code>
                          <Button size="sm" variant="secondary" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyDiscordCommand()}>
                            {copied ? 'Copied' : 'Copy command'}
                          </Button>
                        </div>
                        <p className="mt-2 text-[10.5px] text-faint">Expires {dateTime(discordCode.expiresAt)}.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'security' && (
            <>
            <form onSubmit={(event) => void changePassword(event)} className="space-y-5 p-5">
              {passwordError && (
                <Alert tone="error" title="Could not change password">
                  {passwordError}
                </Alert>
              )}
              <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/50 p-3.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
                <div>
                  <p className="text-[12.5px] font-medium text-ink">Password security</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Passwords are salted and hashed with scrypt. Changing your password revokes every other active
                    session immediately.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Current password" htmlFor="current-password" error={passwordFields.currentPassword} className="sm:col-span-2">
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    invalid={Boolean(passwordFields.currentPassword)}
                  />
                </Field>
                <Field label="New password" htmlFor="new-password" error={passwordFields.newPassword} hint="At least 10 characters with a letter and a number.">
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    invalid={Boolean(passwordFields.newPassword)}
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password" error={passwordFields.confirmPassword}>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    invalid={Boolean(passwordFields.confirmPassword)}
                  />
                </Field>
              </div>
              <div className="flex justify-end border-t border-line pt-4">
                <Button type="submit" variant="primary" loading={passwordBusy} leftIcon={<KeyRound className="h-4 w-4" />}>
                  Update password
                </Button>
              </div>
            </form>

            <section id="delete-account" className="scroll-mt-24 border-t border-danger/20 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-danger/25 bg-danger/[0.07] text-danger">
                  <Trash2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink">Delete account</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                    Permanently erase your profile, email address, wallet access, sessions, rewards, support history, and
                    other personal records. This cannot be undone. We will email a one-time confirmation link as a
                    second check before anything is removed.
                  </p>
                  <p className="mt-2 text-[11px] leading-relaxed text-faint">
                    Financial ledger entries may be retained in pseudonymous form where accounting, anti-fraud, or legal
                    obligations require it. They will no longer be linked to your name or email address.
                  </p>

                  {deleteNotice ? (
                    <div className="mt-4 space-y-3">
                      <Alert tone="success" title="Check your inbox">
                        {deleteNotice}
                      </Alert>
                      {deleteDevPath && (
                        <Link to={deleteDevPath} className="inline-block text-[11.5px] font-medium text-gold underline">
                          Open the local deletion link
                        </Link>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-[11px] text-faint">The link expires in 30 minutes. Check your spam folder if it does not arrive.</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDeleteNotice(null);
                            setDeleteDevPath(null);
                          }}
                        >
                          Request another link
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={(event) => void requestAccountDeletion(event)} className="mt-4 space-y-3">
                      {deleteError && (
                        <Alert tone="error" title="Could not send the deletion link">
                          {deleteError}
                        </Alert>
                      )}
                      <Field
                        label="Current password"
                        htmlFor="delete-password"
                        hint="We verify your password, then send a confirmation email to the address on this account."
                      >
                        <Input
                          id="delete-password"
                          type="password"
                          autoComplete="current-password"
                          value={deletePassword}
                          onChange={(event) => setDeletePassword(event.target.value)}
                        />
                      </Field>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-danger/20 bg-danger/[0.04] p-3 text-[11.5px] text-ink/90">
                        <input
                          type="checkbox"
                          checked={deleteAck}
                          onChange={(event) => setDeleteAck(event.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong bg-surface-3 accent-[#f87b86]"
                        />
                        I understand that deleting my account is permanent and that I will lose access to my wallet and
                        account history.
                      </label>
                      <Button
                        type="submit"
                        variant="danger"
                        loading={deleteBusy}
                        disabled={!deleteAck}
                        leftIcon={<Trash2 className="h-4 w-4" />}
                      >
                        Email deletion link
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            </section>
            </>
          )}

          {tab === 'responsible' && (
            <div className="space-y-5 p-5">
              <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/[0.05] p-3.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <p className="text-[12.5px] font-medium text-ink">Self-exclusion is final for the chosen period</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Blocking your account signs you out everywhere and prevents sign-in until the period ends. It cannot
                    be lifted early, and it does not delete your account, wallet or history.
                  </p>
                </div>
              </div>

              {user.selfExcludedUntil && (
                <Alert tone="warning" title="Self-exclusion is active">
                  This account is blocked until {dateTime(user.selfExcludedUntil)}.
                </Alert>
              )}
              {exclusionError && (
                <Alert tone="error" title="Could not apply self-exclusion">
                  {exclusionError}
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Exclusion period" htmlFor="exclusion-duration" hint="Choose how long you want to be blocked.">
                  <Select
                    id="exclusion-duration"
                    value={exclusionDuration}
                    onChange={(event) => setExclusionDuration(event.target.value as SelfExclusionDuration)}
                  >
                    {SELF_EXCLUSION_DURATIONS.map((duration) => (
                      <option key={duration} value={duration}>
                        {duration === 'permanent' ? 'Permanent' : duration.replace('h', ' hours').replace('d', ' days')}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reason (optional)" htmlFor="exclusion-reason" hint="Only visible to you and support staff.">
                  <Textarea
                    id="exclusion-reason"
                    value={exclusionReason}
                    onChange={(event) => setExclusionReason(event.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="Tell us why you are taking a break, if you want to."
                  />
                </Field>
              </div>

              <div className="rounded-xl border border-danger/25 bg-danger/[0.05] p-3.5">
                <p className="text-[12px] font-semibold text-ink">Confirm you want to block this account</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  You will be signed out immediately. If you need help now, contact one of the support services on the
                  Responsible Gambling page.
                </p>
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-[11.5px] text-ink/90">
                  <input
                    type="checkbox"
                    checked={exclusionConfirmed}
                    onChange={(event) => setExclusionConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong bg-surface-3 accent-[#f87b86]"
                  />
                  I understand this block cannot be lifted early.
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <Link to="/responsible-gambling" className="inline-flex items-center gap-1.5 text-[11.5px] text-gold hover:text-gold-bright">
                  <HeartHandshake className="h-3.5 w-3.5" /> Responsible gambling help and support services
                </Link>
                <Button
                  variant="danger"
                  loading={exclusionBusy}
                  disabled={!exclusionConfirmed}
                  onClick={() => void startSelfExclusion()}
                  leftIcon={<ShieldAlert className="h-4 w-4" />}
                >
                  Self-exclude my account
                </Button>
              </div>
            </div>
          )}

          {tab === 'sessions' && (
            <div className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[13px] font-medium text-ink">Active sessions</h3>
                  <p className="mt-0.5 text-[11.5px] text-muted">Sessions expire automatically after seven days.</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void revokeOthers()} leftIcon={<LogOut className="h-3.5 w-3.5" />}>
                  Sign out other sessions
                </Button>
              </div>
              {sessionsQuery.loading ? (
                <LoadingBlock label="Loading sessions" />
              ) : (
                <div className="space-y-2">
                  {(sessionsQuery.data?.items ?? []).map((session) => (
                    <div key={session.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
                      <span className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface-2 text-faint">
                        {/mobile|iphone|android/i.test(session.userAgent ?? '') ? (
                          <Smartphone className="h-4 w-4" />
                        ) : (
                          <Monitor className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-medium text-ink">
                          {deviceName(session.userAgent)}
                          {session.current && (
                            <Badge tone="gold" className="ml-2">
                              This device
                            </Badge>
                          )}
                        </p>
                        <p className="text-[10.5px] text-faint">
                          {session.ip ?? 'IP unavailable'} · active {timeAgo(session.lastUsedAt)} · expires {dateTime(session.expiresAt)}
                        </p>
                      </div>
                      {!session.current && (
                        <Button size="sm" variant="ghost" onClick={() => void revokeSession(session.id)}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                  {(sessionsQuery.data?.items ?? []).length === 0 && (
                    <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[12px] text-faint">
                      No active sessions.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={user.username} size={42} />
              <div>
                <p className="text-[13px] font-medium text-ink">{user.username}</p>
                <p className="text-[11px] text-muted">{user.email}</p>
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-[11.5px]">
              <div className="flex justify-between">
                <dt className="text-muted">Role</dt>
                <dd><RoleBadge role={user.role} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Status</dt>
                <dd><AccountStatusBadge status={user.status} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Member since</dt>
                <dd className="text-ink">{dateTime(user.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Last login</dt>
                <dd className="text-ink">{dateTime(user.lastLoginAt)}</dd>
              </div>
            </dl>
          </Card>
          <Card className="p-4">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <div>
                <p className="text-[12px] font-medium text-ink">Need help with your account?</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  Open a ticket for access, game, or ledger issues. All money requests go through the Cashier.
                </p>
                <Link to="/tickets/new" className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-gold">
                  <LifeBuoy className="h-3.5 w-3.5" /> Contact support
                </Link>
              </div>
            </div>
          </Card>
          <button
            onDoubleClick={() => void logout()}
            className="w-full rounded-xl border border-line bg-surface-1 px-4 py-3 text-left text-[11px] text-faint transition-colors hover:border-danger/30 hover:text-danger"
            title="Double-click to sign out"
          >
            <LogOut className="mr-1.5 inline h-3.5 w-3.5" /> Sign out of DonutSpin
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={unlinkOpen}
        onClose={() => setUnlinkOpen(false)}
        onConfirm={() => void unlinkDiscordAccount()}
        title="Disconnect Discord?"
        description="Your wallet, ledger, giveaway wins, and invite history stay on your DonutSpin account. You can link a Discord account again later."
        confirmLabel="Disconnect"
        tone="danger"
        loading={discordBusy}
      />
    </div>
  );
}
