import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  HeartHandshake,
  KeyRound,
  LifeBuoy,
  Lock,
  LogOut,
  MailCheck,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserRound,
} from 'lucide-react';
import type { SessionUser } from '../../shared/types';
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
  const [tab, setTab] = useState(params.get('tab') === 'responsible' ? 'responsible' : 'profile');
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

  const [exclusionDuration, setExclusionDuration] = useState<SelfExclusionDuration>('24h');
  const [exclusionReason, setExclusionReason] = useState('');
  const [exclusionConfirmed, setExclusionConfirmed] = useState(false);
  const [exclusionBusy, setExclusionBusy] = useState(false);
  const [exclusionError, setExclusionError] = useState<string | null>(null);

  const sessionsQuery = useApiQuery<{ items: SessionItem[] }>('/me/sessions');

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setEmail(user.email);
      setEmailNotifications(user.emailNotifications);
    }
  }, [user]);

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
                <Field label="Username" htmlFor="profile-username" error={fields.username} hint="3–20 characters, unique across Donutcash.">
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

          {tab === 'security' && (
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
            <LogOut className="mr-1.5 inline h-3.5 w-3.5" /> Sign out of Donutcash
          </button>
        </div>
      </div>
    </div>
  );
}
