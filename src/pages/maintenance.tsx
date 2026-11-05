import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Gem, LogOut, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Alert, Button } from '../components/ui';

export function MaintenancePage() {
  const { config, logout, refresh, bootError } = useAuth();
  const [checking, setChecking] = useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-0 px-4 py-10">
      <div className="absolute inset-0 surface-grid opacity-25" />
      <div className="absolute left-1/2 top-0 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-gold/8 blur-[130px]" />
      <div className="relative w-full max-w-xl">
        <div className="flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-gold/30 bg-gold/10">
            <Gem className="h-5 w-5 text-gold" />
          </span>
          <div>
            <p className="font-display text-[17px] font-semibold leading-none tracking-[0.13em] text-ink">
              {config?.name?.toUpperCase() ?? 'DONUTSPIN'}
            </p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-faint">DonutSMP casino</p>
          </div>
        </div>

        <div className="mt-7 rounded-2xl border border-line bg-surface-1/90 p-7 text-center shadow-2xl sm:p-9">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-warning/30 bg-warning/8">
            <Wrench className="h-6 w-6 text-warning" />
          </span>
          <p className="mt-5 text-[10.5px] font-medium uppercase tracking-[0.18em] text-warning">Maintenance in progress</p>
          <h1 className="mt-2 font-display text-[27px] font-semibold leading-tight tracking-tight text-ink sm:text-[31px]">
            We&apos;re tuning the tables
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-muted">
            {config?.maintenanceMessage || 'We are tuning the tables. Please try again shortly.'}
          </p>

          <div className="mx-auto mt-6 flex max-w-md items-start gap-3 rounded-xl border border-line bg-surface-2/60 p-3.5 text-left">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <p className="text-[11.5px] leading-relaxed text-muted">
              Your wallet, ledger, and support tickets are safe. No wagers are accepted and new tickets are paused while
              the platform is offline for maintenance.
            </p>
          </div>

          <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row">
            <Button
              variant="primary"
              leftIcon={<RefreshCw className={checking ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
              loading={checking}
              onClick={() => void checkAgain()}
            >
              Check again
            </Button>
            <Button
              variant="ghost"
              leftIcon={<LogOut className="h-4 w-4" />}
              onClick={() => void logout()}
            >
              Sign out
            </Button>
          </div>
          {bootError && (
            <Alert tone="error" className="mt-5 text-left">
              Could not reach the server: {bootError}
            </Alert>
          )}
        </div>

        <p className="mt-5 text-center text-[10.5px] leading-relaxed text-faint">
          Staff and administrators can still sign in to manage the platform.
        </p>
      </div>
    </div>
  );
}

export function MaintenanceBanner() {
  const { config, user } = useAuth();
  if (!config?.maintenance) return null;
  const canManage = user?.permissions.includes('settings.manage');
  return (
    <div className="border-b border-warning/25 bg-warning/8">
      <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6 lg:px-8">
        <p className="flex items-center gap-2 text-[11.5px] text-warning">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="font-semibold">Maintenance mode is active.</span>{' '}
            <span className="text-warning/80">Players see a maintenance screen; wagers and new tickets are paused.</span>
          </span>
        </p>
        {canManage && (
          <Link to="/admin/settings" className="text-[11px] font-medium text-warning underline decoration-warning/40 underline-offset-2 hover:text-warning/80">
            Manage settings
          </Link>
        )}
      </div>
    </div>
  );
}
