import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Loader2, MailWarning, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { BrandMark } from '../components/BrandMark';
import { Alert, Button, Card } from '../components/ui';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, refresh } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [message, setMessage] = useState('Confirming your email address…');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState('error');
      setMessage('This link is missing its verification token. Request a new email from your settings.');
      return;
    }
    api
      .post<{ message: string }>('/auth/verify-email', { token })
      .then(async (result) => {
        setState('done');
        setMessage(result.message);
        if (user) await refresh();
      })
      .catch((error) => {
        setState('error');
        setMessage(errorMessage(error));
      });
  }, [token, user, refresh]);

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-10">
      <div className="absolute inset-0 surface-grid opacity-25" />
      <div className="absolute left-1/2 top-1/4 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-gold/[0.08] blur-[120px]" />
      <div className="relative w-full max-w-md">
        <Link to="/" className="mx-auto mb-7 flex w-fit items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/20 to-transparent">
            <BrandMark className="h-7 w-7" />
          </span>
          <span>
            <span className="block font-display text-[15px] font-bold tracking-[0.18em] text-ink">DONUTCASH</span>
            <span className="block text-[8.5px] font-semibold uppercase tracking-[0.22em] text-gold-dim">DonutSMP casino</span>
          </span>
        </Link>

        <Card className="overflow-hidden text-center">
          <div className="relative p-7 sm:p-9">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
            <div
              className={
                state === 'done'
                  ? 'mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-success/30 bg-success/10 text-success'
                  : state === 'error'
                    ? 'mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-danger/30 bg-danger/10 text-danger'
                    : 'mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-gold/30 bg-gold/10 text-gold'
              }
            >
              {state === 'done' ? (
                <BadgeCheck className="h-8 w-8" />
              ) : state === 'error' ? (
                <MailWarning className="h-8 w-8" />
              ) : (
                <Loader2 className="h-8 w-8 animate-spin" />
              )}
            </div>
            <h1 className="mt-5 font-display text-[25px] font-semibold tracking-[-0.03em] text-ink">
              {state === 'done' ? 'Email verified' : state === 'error' ? 'We could not verify this link' : 'Verifying your email'}
            </h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{message}</p>

            {state === 'error' && (
              <Alert tone="info" className="mt-5 text-left">
                Verification links expire after 24 hours and can only be used once. Sign in to request a fresh link from
                your profile settings.
              </Alert>
            )}

            <div className="mt-7 flex flex-col gap-2">
              {state === 'done' ? (
                <>
                  <Link to={user ? '/settings' : '/login'}>
                    <Button variant="primary" className="w-full" leftIcon={user ? <ShieldCheck className="h-4 w-4" /> : undefined}>
                      {user ? 'Review account security' : 'Sign in to your account'} <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/games">
                    <Button variant="ghost" className="w-full">
                      Go to the lobby
                    </Button>
                  </Link>
                </>
              ) : state === 'error' ? (
                <>
                  <Link to={user ? '/settings' : '/login'}>
                    <Button variant="primary" className="w-full">
                      {user ? 'Go to settings' : 'Go to sign in'}
                    </Button>
                  </Link>
                  <Link to="/">
                    <Button variant="ghost" className="w-full">
                      Back to lobby
                    </Button>
                  </Link>
                </>
              ) : (
                <p className="text-[11px] text-faint">This only takes a moment.</p>
              )}
            </div>
          </div>
        </Card>
        <p className="mt-5 text-center text-[10px] leading-relaxed text-faint">
          Email links are single-use and tied to the address on your account.
        </p>
      </div>
    </div>
  );
}
