import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '../components/ui';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  push: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
} as const;

const tones = {
  success: 'border-success/25 text-success',
  error: 'border-danger/25 text-danger',
  info: 'border-info/25 text-info',
  warning: 'border-warning/25 text-warning',
} as const;

const barTones = {
  success: 'bg-success',
  error: 'bg-danger',
  info: 'bg-info',
  warning: 'bg-warning',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    ({ title, description, variant = 'info' }) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-3), { id, title, description, variant }]);
      window.setTimeout(() => dismiss(id), 5400);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ title, description, variant: 'success' }),
      error: (title, description) => push({ title, description, variant: 'error' }),
      info: (title, description) => push({ title, description, variant: 'info' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-20 z-[100] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px] lg:bottom-5"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => {
          const Icon = icons[toast.variant];
          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-2xl border bg-surface-2/95 px-4 py-3.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-xl animate-fade-up',
                tones[toast.variant],
              )}
              role="status"
            >
              <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.06]', tones[toast.variant])}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-ink">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{toast.description}</p>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                className="rounded-md p-1 text-faint transition-colors hover:bg-white/[0.06] hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-0 bottom-0 h-[2px] origin-left animate-[toast-progress_5.4s_linear_forwards]',
                  barTones[toast.variant],
                )}
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
