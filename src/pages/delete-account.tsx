import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { Alert, Button, Card } from '../components/ui';
import { BrandMark } from '../components/BrandMark';

const LEDGER_NOTE =
  'Financial ledger entries may be retained in pseudonymous form where accounting, anti-fraud, or legal obligations require it. They are no longer linked to your name or email address.';

export function DeleteAccountPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const confirm = async () => {
    if (!acknowledged) {
      setError('Confirm that you understand this action cannot be undone.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/delete-account/confirm', { token });
      setDone(true);
      window.setTimeout(() => window.location.assign('/login?deleted=1'), 2800);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-surface-0 px-5 py-12">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-danger/6 blur-[130px]" />
      <div className="relative w-full max-w-lg">
        <Link to="/" className="inline-flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-gold/30 bg-gold/10">
            <BrandMark className="h-7 w-7" />
          </span>
          <span>
            <span className="block font-display text-base font-bold tracking-[0.2em] text-ink">DONUTSPIN</span>
            <span className="block text-[9px] uppercase tracking-[0.22em] text-faint">Account deletion</span>
          </span>
        </Link>

        <Card className="mt-6 p-6 sm:p-7">
          {done ? (
            <div className="text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-success/25 bg-success/10 text-success">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <h1 className="mt-5 font-display text-2xl font-semibold text-ink">Account deleted</h1>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                Your profile, email address, wallet access, sessions, rewards, support history, and other personal
                records have been removed.
              </p>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">{LEDGER_NOTE}</p>
              <p className="mt-5 text-[11px] text-faint">Taking you back to sign in…</p>
              <Link to="/login?deleted=1" className="mt-4 inline-block">
                <Button variant="secondary">Go to sign in</Button>
              </Link>
            </div>
          ) : (
            <>
              <span className="grid h-12 w-12 place-items-center rounded-2xl border border-danger/25 bg-danger/[0.07] text-danger">
                <Trash2 className="h-6 w-6" />
              </span>
              <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Delete your account?</h1>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                You are signed in as <span className="font-medium text-ink">{user.username}</span> (
                {user.email}). The link in your email is the final verification step.
              </p>

              {!token ? (
                <Alert tone="error" title="Missing deletion link" className="mt-5">
                  Open the confirmation link from your email, or request a new one from your{' '}
                  <Link to="/settings?tab=security" className="font-medium text-gold underline">
                    security settings
                  </Link>
                  .
                </Alert>
              ) : (
                <>
                  {error && (
                    <Alert tone="error" title="Could not delete the account" className="mt-5">
                      {error}
                    </Alert>
                  )}

                  <div className="mt-5 rounded-xl border border-danger/20 bg-danger/[0.04] p-3.5">
                    <p className="flex items-center gap-2 text-[12px] font-semibold text-ink">
                      <ShieldCheck className="h-4 w-4 text-danger" /> This cannot be undone
                    </p>
                    <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-muted">
                      <li>Your username, email address, password, and profile details are erased.</li>
                      <li>Your wallet, active sessions, rewards, tickets, and cashier history are deleted.</li>
                      <li>Any unfinished game and its wager are forfeited.</li>
                      <li>You will not be able to sign in or recover this account.</li>
                    </ul>
                  </div>

                  <p className="mt-3 text-[11px] leading-relaxed text-faint">{LEDGER_NOTE}</p>

                  <label className="mt-5 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2/50 p-3 text-[11.5px] text-ink/90">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong bg-surface-3 accent-[#f87b86]"
                    />
                    I understand that deleting my account is permanent and that I will lose access to my wallet and
                    account history.
                  </label>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                    <Link to="/settings?tab=security">
                      <Button variant="ghost" type="button">
                        Cancel
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      loading={busy}
                      disabled={!acknowledged}
                      onClick={() => void confirm()}
                      leftIcon={<Trash2 className="h-4 w-4" />}
                    >
                      Delete my account permanently
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </Card>

        {!done && (
          <p className="mt-4 text-center text-[11px] text-faint">
            Changed your mind?{' '}
            <Link to="/settings?tab=security" className="font-medium text-gold hover:text-gold-bright">
              Return to security settings
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
