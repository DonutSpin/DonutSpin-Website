import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { money } from '../lib/format';
import { Alert, Button, Field, Input } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { LegalCheckbox, LegalDisclaimer, LegalFooterLinks } from '../components/legal';

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { config } = useAuth();
  return (
    <div className="relative grid min-h-screen bg-surface-0 lg:grid-cols-[1.02fr_0.98fr]">
      <div className="relative hidden overflow-hidden border-r border-line bg-surface-1 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 surface-grid opacity-40" />
        <div className="absolute -left-40 top-1/4 h-[520px] w-[520px] rounded-full bg-gold/6 blur-[130px]" />
        <div className="relative">
          <Link to="/" className="inline-flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-gold/30 bg-gold/10">
              <BrandMark className="h-7 w-7" />
            </span>
            <span>
              <span className="block font-display text-base font-bold tracking-[0.2em] text-ink">DONUTCASH</span>
              <span className="block text-[9px] uppercase tracking-[0.22em] text-faint">DonutSMP casino</span>
            </span>
          </Link>
        </div>

        <div className="relative max-w-lg">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-gold/25 bg-gold/8 px-3 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-gold">
            <Sparkles className="h-3 w-3" /> The DonutSMP casino
          </p>
          <h2 className="font-display text-[44px] font-semibold leading-[1.05] tracking-tight text-ink">
            Bring your DonutSMP money.
            <span className="block text-gold">Leave with more.</span>
          </h2>
          <p className="mt-5 max-w-md text-[14px] leading-relaxed text-muted">
            Six polished casino games, honest server-side outcomes, and a support desk that actually works — built for
            the DonutSMP community.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              { icon: Wallet, title: 'DonutSMP wallet', text: 'Every deposit, withdrawal, wager, and payout is ledgered.' },
              { icon: ShieldCheck, title: 'Server-authoritative', text: 'Outcomes and payouts are settled on the server.' },
              { icon: KeyRound, title: 'Real support', text: 'Reference-tracked tickets with visible history.' },
              { icon: CheckCircle2, title: 'Instant cashier', text: 'Deposit or withdraw DonutSMP money in a few clicks.' },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-line bg-surface-0/50 p-3.5 backdrop-blur">
                <item.icon className="h-4 w-4 text-gold" />
                <p className="mt-2 text-[12px] font-medium text-ink">{item.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-3 text-[10.5px] text-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          {config?.name ?? 'Donutcash'} · DonutSMP casino
        </div>
      </div>

      <div className="flex min-h-screen flex-col px-5 py-8 sm:px-10 lg:justify-center lg:px-16">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="mb-10 flex items-center justify-between lg:hidden">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-gold/30 bg-gold/10">
                <BrandMark className="h-6 w-6" />
              </span>
              <span className="font-display text-sm font-bold tracking-[0.18em]">DONUTCASH</span>
            </Link>
            <Link to="/" className="text-[11px] text-faint hover:text-ink">
              Back to lobby
            </Link>
          </div>
          <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-8 border-t border-line/70 pt-5">
            <LegalFooterLinks className="text-[10.5px] text-faint" />
            <LegalDisclaimer className="mt-2 text-[10.5px]" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  placeholder = '••••••••••',
  invalid,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        invalid={invalid}
        autoComplete={autoComplete}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint hover:text-ink"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function LoginPage() {
  const { login, config } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFields({});
    setLoading(true);
    try {
      await login(identifier, password);
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back to the table"
      subtitle="Sign in to reach your DonutSMP money, games, and support tickets."
    >
      {config?.maintenance && (
        <Alert tone="warning" title="Maintenance mode" className="mb-5">
          {config.maintenanceMessage} Staff can still sign in to manage support and settings.
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="Username or email" htmlFor="identifier" error={fields.identifier}>
          <Input
            id="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            autoFocus
            invalid={Boolean(fields.identifier)}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={fields.password}>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            invalid={Boolean(fields.password)}
            autoComplete="current-password"
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[12px] font-medium text-gold hover:text-gold-bright">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>
      {(config?.maintenance || (config && !config.registrationOpen)) ? (
        <Alert tone="info" className="mt-5">
          {config?.maintenance
            ? 'New registrations are paused during maintenance. Existing staff can still sign in.'
            : 'New registrations are currently closed. Existing players can still sign in.'}
        </Alert>
      ) : (
        <p className="mt-6 text-center text-[12.5px] text-muted">
          New to Donutcash?{' '}
          <Link to="/register" className="font-medium text-gold hover:text-gold-bright">
            Create an account
          </Link>
        </p>
      )}
      <p className="mt-10 text-center text-[10.5px] leading-relaxed text-faint">
        Donutcash · The casino for DonutSMP money.
      </p>
    </AuthLayout>
  );
}

function passwordStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  return { score, label: labels[Math.min(score, 5)] ?? 'Weak' };
}

export function RegisterPage() {
  const { register, config } = useAuth();
  const navigate = useNavigate();
  const { success } = useToast();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acknowledgeDonutRules, setAcknowledgeDonutRules] = useState(false);
  const strength = passwordStrength(password);
  const allAccepted = ageConfirmed && acceptTerms && acknowledgeDonutRules;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFields({});
    setError(null);
    if (!allAccepted) {
      setError('You must accept all three statements before creating an account.');
      return;
    }
    if (password !== confirm) {
      setFields({ confirm: 'Passwords do not match.' });
      return;
    }
    setLoading(true);
    try {
      await register(username, email, password, { ageConfirmed, acceptTerms, acknowledgeDonutRules });
      success('Account created', 'Your starting DonutSMP balance has been added to your wallet.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create your Donutcash account"
      subtitle={
        config
          ? `Start with ${money(config.startingCredits)} DonutSMP money in your wallet.`
          : 'Start with a DonutSMP welcome balance in your wallet.'
      }
    >
      {config?.maintenance ? (
        <Alert tone="warning" title="Registration paused" className="mb-5">
          The platform is in maintenance mode. Please try again later.
        </Alert>
      ) : config && !config.registrationOpen ? (
        <Alert tone="info" title="Registrations closed" className="mb-5">
          An administrator has paused new registrations. Existing players can still sign in.
        </Alert>
      ) : null}
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="Username" htmlFor="username" error={fields.username} hint="3–20 characters. Letters, numbers, underscores.">
          <Input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="luckyseven"
            autoComplete="username"
            invalid={Boolean(fields.username)}
          />
        </Field>
        <Field label="Email" htmlFor="email" error={fields.email}>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            invalid={Boolean(fields.email)}
          />
        </Field>
        <Field label="Password" htmlFor="new-password" error={fields.password} hint="At least 10 characters with a letter and a number.">
          <PasswordInput
            id="new-password"
            value={password}
            onChange={setPassword}
            invalid={Boolean(fields.password)}
            autoComplete="new-password"
          />
          {password.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <div className="flex flex-1 gap-1">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className={`h-1 flex-1 rounded-full ${
                      index < strength.score ? (strength.score >= 4 ? 'bg-success' : 'bg-gold') : 'bg-surface-4'
                    }`}
                  />
                ))}
              </div>
              <span className="w-16 text-right text-[10.5px] text-faint">{strength.label}</span>
            </div>
          )}
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={fields.confirm}>
          <PasswordInput
            id="confirm"
            value={confirm}
            onChange={setConfirm}
            invalid={Boolean(fields.confirm)}
            autoComplete="new-password"
          />
        </Field>
        <div className="space-y-2.5 pt-1">
          <LegalCheckbox
            id="register-age"
            checked={ageConfirmed}
            onChange={setAgeConfirmed}
            error={fields.ageConfirmed}
            hint="Ik bevestig dat ik 18 jaar of ouder ben."
          >
            I confirm that I am 18 years or older.
          </LegalCheckbox>
          <LegalCheckbox
            id="register-terms"
            checked={acceptTerms}
            onChange={setAcceptTerms}
            error={fields.acceptTerms}
            hint="Ik ga akkoord met de Servicevoorwaarden en het Privacybeleid."
          >
            I agree to the{' '}
            <Link to="/terms" target="_blank" rel="noreferrer" className="font-medium text-gold underline decoration-gold/40 underline-offset-2">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" rel="noreferrer" className="font-medium text-gold underline decoration-gold/40 underline-offset-2">
              Privacy Policy
            </Link>
            .
          </LegalCheckbox>
          <LegalCheckbox
            id="register-donutsmp"
            checked={acknowledgeDonutRules}
            onChange={setAcknowledgeDonutRules}
            error={fields.acknowledgeDonutRules}
            hint="Ik begrijp dat deze activiteit in strijd kan zijn met de regels van DonutSMP en kan leiden tot een ban."
          >
            I understand that this activity may violate DonutSMP’s rules and could result in a ban.
          </LegalCheckbox>
        </div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={!allAccepted || Boolean(config?.maintenance) || config?.registrationOpen === false}
          className="w-full"
        >
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-[12.5px] text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-gold hover:text-gold-bright">
          Sign in
        </Link>
      </p>
      <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-[10.5px] text-faint">
        <ShieldCheck className="h-3 w-3" /> Passwords are salted and hashed. Sessions are httpOnly.
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resetPath, setResetPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const result = await api.post<{ message: string; resetPath?: string }>('/auth/forgot-password', { email });
      setMessage(result.message);
      setResetPath(result.resetPath ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email on your account. If it matches, we will issue a one-hour reset link."
    >
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </Link>
      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}
      {message && (
        <Alert tone="success" className="mb-5" title="Request received">
          {message}
        </Alert>
      )}
      {resetPath && (
        <div className="mb-5 rounded-xl border border-warning/25 bg-warning/5 p-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-warning">Local development shortcut</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Email delivery is not configured. Use this link to complete the reset flow.
          </p>
          <Link to={resetPath} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-gold">
            Open reset link <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="Account email" htmlFor="forgot-email">
          <Input
            id="forgot-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full" leftIcon={<Mail className="h-4 w-4" />}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFields({});
    if (password !== confirm) {
      setFields({ confirm: 'Passwords do not match.' });
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) setFields(err.fieldErrors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={done ? 'Password updated' : 'Choose a new password'}
      subtitle={done ? 'Your previous sessions have been revoked. Sign in with your new password.' : 'Set a strong password to regain access to your account.'}
    >
      {!token ? (
        <Alert tone="error" title="Missing reset token">
          This page needs a valid reset link. Request a new one from the{' '}
          <Link to="/forgot-password" className="underline">
            forgot password page
          </Link>
          .
        </Alert>
      ) : done ? (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/8 p-4">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <p className="text-[13px] text-success">Your password has been changed successfully.</p>
          </div>
          <Button variant="primary" className="w-full" onClick={() => navigate('/login')}>
            Continue to sign in
          </Button>
        </div>
      ) : (
        <>
          {error && (
            <Alert tone="error" className="mb-5">
              {error}
            </Alert>
          )}
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <Field label="New password" htmlFor="reset-password" error={fields.password} hint="At least 10 characters with a letter and a number.">
              <PasswordInput
                id="reset-password"
                value={password}
                onChange={setPassword}
                invalid={Boolean(fields.password)}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm new password" htmlFor="reset-confirm" error={fields.confirm}>
              <PasswordInput
                id="reset-confirm"
                value={confirm}
                onChange={setConfirm}
                invalid={Boolean(fields.confirm)}
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              Update password
            </Button>
          </form>
          <div className="mt-6 flex justify-center">
            <Loader2 className="hidden" />
          </div>
        </>
      )}
    </AuthLayout>
  );
}
