import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Crown,
  Info,
  Loader2,
  Lock,
  X,
  XCircle,
} from 'lucide-react';
import {
  ROLE_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type AccountStatus,
  type Role,
  type TicketPriority,
  type TicketStatus,
} from '../../shared/types';
import { money, initials } from '../lib/format';
import { compactAmount, parseAmount } from '../lib/amount';

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

/* --------------------------------- Button -------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variantClasses: Record<Variant, string> = {
  primary:
    'relative overflow-hidden bg-gradient-to-b from-[#f4d99f] via-[#e6c27a] to-[#d2a85c] text-[#211706] shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_10px_24px_-14px_rgba(230,194,122,0.8)] hover:brightness-[1.06] hover:-translate-y-px active:translate-y-0 active:brightness-95',
  secondary:
    'border border-line-strong/90 bg-white/[0.045] text-ink shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] hover:border-line-strong hover:bg-white/[0.075] active:bg-white/[0.04]',
  ghost: 'text-muted hover:bg-white/[0.055] hover:text-ink active:bg-white/[0.035]',
  danger: 'border border-danger/30 bg-danger/10 text-danger hover:border-danger/45 hover:bg-danger/16 active:bg-danger/10',
  success: 'border border-success/30 bg-success/10 text-success hover:border-success/45 hover:bg-success/16 active:bg-success/10',
  outline: 'border border-line-strong/80 text-ink hover:border-gold/40 hover:bg-white/[0.04] hover:text-gold-bright',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8.5 px-3 text-[12px] rounded-lg gap-1.5',
  md: 'h-10.5 px-4 text-[13px] rounded-xl gap-2',
  lg: 'h-12 px-6 text-[14px] rounded-xl gap-2.5',
  icon: 'h-9.5 w-9.5 rounded-xl',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leftIcon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'group inline-flex select-none items-center justify-center whitespace-nowrap font-semibold tracking-[-0.01em] transition-all duration-200 ease-out disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {variant === 'primary' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-[140%] skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-[240%]"
        />
      )}
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : leftIcon}
      {children}
    </button>
  );
}

/* --------------------------------- Badge --------------------------------- */

export type Tone = 'neutral' | 'gold' | 'success' | 'danger' | 'warning' | 'info' | 'violet';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-white/[0.045] text-muted border-line-strong/80',
  gold: 'bg-gold/10 text-gold-bright border-gold/25',
  success: 'bg-success/10 text-success border-success/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  info: 'bg-info/10 text-info border-info/25',
  violet: 'bg-violet/10 text-violet border-violet/25',
};

const dotClasses: Record<Tone, string> = {
  neutral: 'bg-faint',
  gold: 'bg-gold',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  info: 'bg-info',
  violet: 'bg-violet',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold leading-none tracking-[0.015em] whitespace-nowrap',
        toneClasses[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full shadow-[0_0_6px_currentColor]', dotClasses[tone])} />}
      {children}
    </span>
  );
}

const statusTones: Record<TicketStatus, Tone> = {
  new: 'info',
  open: 'success',
  in_progress: 'gold',
  on_hold: 'warning',
  waiting_user: 'violet',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'danger',
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge tone={statusTones[status]} dot>
      {TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

const priorityTones: Record<TicketPriority, Tone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge tone={priorityTones[priority]}>{TICKET_PRIORITY_LABELS[priority]}</Badge>;
}

const roleTones: Record<Role, Tone> = {
  user: 'neutral',
  support: 'info',
  moderator: 'violet',
  admin: 'gold',
  owner: 'gold',
};

export function RoleBadge({ role, strict = false }: { role: Role; strict?: boolean }) {
  return (
    <Badge tone={roleTones[role]}>
      {(role === 'owner' || (role === 'admin' && strict)) && <Crown className="h-3 w-3" />}
      {ROLE_LABELS[role]}
    </Badge>
  );
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const tones: Record<AccountStatus, Tone> = { active: 'success', restricted: 'warning', suspended: 'danger' };
  return (
    <Badge tone={tones[status]} dot>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

/* --------------------------------- Cards --------------------------------- */

export function Card({
  children,
  className,
  as: Tag = 'div',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cn(
        'min-w-0 rounded-2xl border border-line/90 premium-card',
        interactive &&
          'transition-all duration-300 hover:-translate-y-0.5 hover:border-line-strong/90 hover:shadow-[0_28px_50px_-32px_rgba(0,0,0,0.9)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line/80 px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
        {description && <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card interactive className={cn('relative overflow-hidden p-5', className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/50 to-transparent" />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{label}</p>
        {icon && (
          <span className={cn('grid h-9 w-9 place-items-center rounded-xl border', toneClasses[tone])}>{icon}</span>
        )}
      </div>
      <p className="mt-4 font-display text-[30px] font-semibold leading-none tracking-[-0.03em] tnum text-ink">{value}</p>
      {hint && <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">{hint}</p>}
    </Card>
  );
}

export function Money({
  amount,
  signed = false,
  className,
  size = 'md',
}: {
  amount: number;
  signed?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const positive = amount > 0;
  const negative = amount < 0;
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 font-display font-semibold tnum',
        size === 'sm' && 'text-[12.5px]',
        size === 'md' && 'text-[14.5px]',
        size === 'lg' && 'text-2xl',
        signed && positive && 'text-success',
        signed && negative && 'text-danger',
        !signed && 'text-ink',
        className,
      )}
    >
      {signed && positive ? '+' : ''}
      {money(amount)}
      <span className="text-[9px] font-medium uppercase tracking-wider text-faint">money</span>
    </span>
  );
}

/* --------------------------------- Forms --------------------------------- */

interface FieldProps {
  label?: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-[12px] font-semibold text-ink/90">
          {label}
          {required && <span className="text-gold">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-[11.5px] leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
        </p>
      ) : (
        hint && <p className="text-[11.5px] leading-relaxed text-faint">{hint}</p>
      )}
    </div>
  );
}

const controlBase =
  'w-full rounded-xl border bg-surface-2/90 px-3.5 text-[13px] text-ink shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)] placeholder:text-faint/80 transition-all duration-150 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-2/50';

export function Input({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        controlBase,
        'h-11',
        invalid
          ? 'border-danger/60 focus:border-danger/70 focus:ring-danger/15'
          : 'border-line/90 hover:border-line-strong focus:border-gold/60 focus:ring-gold/15',
        className,
      )}
      {...props}
    />
  );
}

export function AmountInput({
  value,
  onChange,
  onInvalid,
  allowNegative = false,
  invalid = false,
  onFocus,
  onBlur,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'onInvalid'> & {
  value: number | '';
  onChange: (value: number | '') => void;
  onInvalid?: (message: string | null) => void;
  allowNegative?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value === '' ? '' : compactAmount(value));
  const [focused, setFocused] = useState(false);
  const [unparsed, setUnparsed] = useState(false);

  useEffect(() => {
    if (!focused && !unparsed) setText(value === '' ? '' : compactAmount(value));
  }, [value, focused, unparsed]);

  return (
    <Input
      {...props}
      type="text"
      inputMode="text"
      autoComplete="off"
      value={text}
      invalid={invalid || unparsed}
      onFocus={(event) => {
        setFocused(true);
        setUnparsed(false);
        event.currentTarget.select();
        onFocus?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        if (!raw.trim()) {
          setUnparsed(false);
          onInvalid?.(null);
          onChange('');
          return;
        }
        const parsed = parseAmount(raw, { allowNegative });
        if (parsed !== null) {
          setUnparsed(false);
          onInvalid?.(null);
          onChange(parsed);
        } else {
          setUnparsed(true);
          onInvalid?.('Enter a valid amount, for example 100k, 2.5M, 5B or 1T.');
        }
      }}
      onBlur={(event) => {
        setFocused(false);
        const parsed = parseAmount(text, { allowNegative });
        if (parsed === null) {
          const hasText = text.trim().length > 0;
          setUnparsed(hasText);
          onInvalid?.(hasText ? 'Enter a valid amount, for example 100k, 2.5M, 5B or 1T.' : null);
        } else {
          setUnparsed(false);
          onInvalid?.(null);
          onChange(parsed);
          setText(compactAmount(parsed));
        }
        onBlur?.(event);
      }}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(
        controlBase,
        'min-h-26 resize-y py-2.5 leading-relaxed',
        invalid
          ? 'border-danger/60 focus:border-danger/70 focus:ring-danger/15'
          : 'border-line/90 hover:border-line-strong focus:border-gold/60 focus:ring-gold/15',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(
        controlBase,
        'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-9',
        'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 24 24%27 stroke=%27%239ba2b0%27 stroke-width=%272%27%3E%3Cpath stroke-linecap=%27round%27 stroke-linejoin=%27round%27 d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E")]',
        invalid
          ? 'border-danger/60 focus:border-danger/70 focus:ring-danger/15'
          : 'border-line/90 hover:border-line-strong focus:border-gold/60 focus:ring-gold/15',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative h-[26px] w-[46px] shrink-0 rounded-full border p-[3px] transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 disabled:cursor-not-allowed disabled:opacity-40',
        checked
          ? 'border-gold/50 bg-gradient-to-r from-[#c69c4f] via-[#e6c27a] to-[#f3d89e] shadow-[0_0_18px_-6px_rgba(230,194,122,0.8),inset_0_1px_1px_rgba(255,255,255,0.35)]'
          : 'border-line-strong/80 bg-surface-4 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] group-hover:bg-surface-4/80',
      )}
    >
      <span
        className={cn(
          'block h-[18px] w-[18px] rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          checked
            ? 'translate-x-5 bg-[#1c1405] shadow-[0_1px_3px_rgba(0,0,0,0.35),inset_0_1px_1px_rgba(255,255,255,0.2)]'
            : 'translate-x-0 bg-[#c7cdd8] shadow-[0_1px_3px_rgba(0,0,0,0.5)] group-hover:bg-white',
        )}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed text-muted', disabled && 'cursor-not-allowed opacity-50')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0',
          checked
            ? 'border-gold bg-gradient-to-b from-[#f1d49a] to-[#d6ac61] text-[#211706] shadow-[0_2px_8px_-3px_rgba(230,194,122,0.8)]'
            : 'border-line-strong bg-surface-2 hover:border-gold/40',
        )}
      >
        <Check className={cn('h-3 w-3 transition-transform duration-200', checked ? 'scale-100' : 'scale-0')} strokeWidth={3.5} />
      </button>
      <span className="select-none">{label}</span>
    </label>
  );
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-[5px] animate-fade-in"
        onClick={() => dismissible && onClose()}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 w-full overflow-hidden rounded-t-3xl border border-line-strong/70 bg-surface-1 shadow-[0_40px_90px_-20px_rgba(0,0,0,0.9)] animate-pop-in sm:rounded-3xl',
          widths[size],
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/60 to-transparent" />
        <div className="flex items-start justify-between gap-4 border-b border-line/80 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="font-display text-[18px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
            {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-faint transition-colors hover:bg-surface-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {children && <div className="max-h-[66vh] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/80 bg-surface-2/50 px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'primary',
  loading = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/* ---------------------------------- Tabs --------------------------------- */

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'scrollbar-none inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line/80 bg-surface-1/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        className,
      )}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative flex h-8.5 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60',
              active
                ? 'bg-surface-3 text-ink shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_12px_-6px_rgba(0,0,0,0.8)]'
                : 'text-muted hover:bg-white/[0.04] hover:text-ink',
            )}
          >
            {active && <span className="h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(230,194,122,0.8)]" />}
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9.5px] font-bold tnum',
                  active ? 'bg-gold/15 text-gold-bright' : 'bg-white/[0.06] text-faint',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- Table ---------------------------------- */

export function TableWrap({
  children,
  className,
  minWidth = 760,
}: {
  children: ReactNode;
  className?: string;
  minWidth?: number;
}) {
  return (
    <div className={cn('w-full min-w-0 overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-[12.5px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-line/80 bg-surface-2/35 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-faint',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  colSpan,
  title,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} className={cn('border-b border-line/60 px-4 py-3.5 align-middle text-muted', className)}>
      {children}
    </td>
  );
}

export function Tr({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={cn('group/row transition-colors hover:bg-white/[0.025]', onClick && 'cursor-pointer', className)}
    >
      {children}
    </tr>
  );
}

/* -------------------------------- Feedback ------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-gold', className)} aria-label="Loading" />;
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="relative grid h-12 w-12 place-items-center">
        <span className="absolute inset-0 rounded-full border border-gold/20" />
        <Spinner />
      </div>
      <p className="text-[12.5px] text-muted">{label}…</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}>
      {icon && (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-gradient-to-b from-surface-3 to-surface-2 text-faint shadow-inner">
          {icon}
        </div>
      )}
      <h3 className="font-display text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const toneMap = {
    info: { wrap: 'border-info/25 bg-info/[0.07] text-info', Icon: Info },
    error: { wrap: 'border-danger/25 bg-danger/[0.07] text-danger', Icon: XCircle },
    success: { wrap: 'border-success/25 bg-success/[0.07] text-success', Icon: CheckCircle2 },
    warning: { wrap: 'border-warning/25 bg-warning/[0.07] text-warning', Icon: AlertTriangle },
  } as const;
  const { wrap, Icon } = toneMap[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-xl border px-3.5 py-3 text-[12.5px] backdrop-blur-sm', wrap, className)} role="alert">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={cn('leading-relaxed opacity-90', title ? 'mt-0.5' : '')}>{children}</div>}
      </div>
    </div>
  );
}

export function Progress({
  value,
  max,
  tone = 'gold',
  className,
}: {
  value: number;
  max: number;
  tone?: 'gold' | 'success' | 'info';
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-surface-4/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          tone === 'gold' && 'bg-gradient-to-r from-[#b78f4a] to-[#f8e5b8]',
          tone === 'success' && 'bg-gradient-to-r from-[#248a68] to-[#6ce7b8]',
          tone === 'info' && 'bg-gradient-to-r from-[#3d74b8] to-[#9cc9ff]',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
  unit = 'results',
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
  unit?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <p className="text-[11.5px] text-faint tnum">
        {total.toLocaleString()} {unit} · page {page} of {Math.max(1, totalPages)}
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-xl', className)} />;
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full border border-gold/20 bg-gradient-to-br from-gold/18 to-gold/[0.04] font-display font-semibold text-gold-bright shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
    >
      {initials(name)}
    </span>
  );
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-[18px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LockedNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-[11.5px] text-warning', className)}>
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
