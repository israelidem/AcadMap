/**
 * AcadMap design system primitives: buttons, inputs, cards, modals, states.
 *
 * The vocabulary is a registry document. Controls are stamped (monospaced, upper
 * case, squared corners), figures are set in mono because they are columns of
 * numbers, and every card is a sheet with an index tab rather than a floating
 * panel. Nothing here changes a component's API — only what it looks like.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

import { cn, uid } from '@/lib/utils';

/* --------------------------------- Button -------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-brand-fg border border-brand hover:bg-brand-ink hover:border-brand-ink active:translate-y-px',
  secondary:
    'bg-surface text-fg border border-border hover:border-brand hover:text-brand active:translate-y-px',
  ghost: 'border border-transparent text-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white border border-danger hover:opacity-90 active:translate-y-px',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-micro',
  md: 'h-11 px-4 text-micro',
  lg: 'h-12 px-6 text-xs tracking-[0.1em]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        // Mono, upper case, tight radius: a control on a form, not a pill.
        'inline-flex items-center justify-center gap-2 rounded-lg font-mono font-medium uppercase',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* --------------------------------- Fields -------------------------------- */

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  return (
    <div>
      {label && (
        <label className="am-label" htmlFor={id}>
          {label}
        </label>
      )}
      {children(id)}
      {error ? <p className="am-error">{error}</p> : hint ? <p className="am-hint">{hint}</p> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, className, ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <input
          id={id}
          className={cn('am-input', error && 'border-danger', className)}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
      )}
    </Field>
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Select({ label, hint, error, className, children, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <select id={id} className={cn('am-input pr-8', error && 'border-danger', className)} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, className, ...rest }: TextareaProps) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <textarea id={id} className={cn('am-input min-h-[96px]', error && 'border-danger', className)} {...rest} />
      )}
    </Field>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-sm text-fg"
    >
      {/* A switch on a form is a box that is either ticked or not. */}
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-sm border transition-colors',
          checked ? 'border-brand bg-brand' : 'border-border bg-surface-2',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-[18px] w-[18px] rounded-sm bg-surface transition-all',
            checked ? 'left-[24px]' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  );
}

/* ---------------------------------- Card --------------------------------- */

export function Card({
  title,
  description,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cn('am-card', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-rule bg-surface-2/60 px-4 py-3 sm:px-5">
          {/* min-w-0 on the text, shrink-0 on the control: without both, a long
              title pushes the action out of the card on a narrow screen. */}
          <div className="min-w-0">
            {title && (
              <h2 className="am-tab-label text-sm font-semibold uppercase tracking-[0.06em]">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 pl-3 text-sm text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'brand' | 'success' | 'warning';
}) {
  const tones = {
    default: 'text-fg',
    brand: 'text-brand',
    success: 'text-success',
    warning: 'text-warning',
  } as const;
  const rules = {
    default: 'before:bg-border',
    brand: 'before:bg-brand',
    success: 'before:bg-success',
    warning: 'before:bg-warning',
  } as const;
  return (
    <div
      className={cn(
        // The left rule is the column edge on a result sheet: it says which
        // figure this is without spending a word on it.
        'am-card relative overflow-hidden px-4 py-4 pl-5',
        'before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[""]',
        rules[tone],
      )}
    >
      <p className="am-eyebrow">{label}</p>
      <p className={cn('tabular mt-2 text-3xl font-medium leading-none', tones[tone])}>{value}</p>
      {sub && <p className="mt-2 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'border-border bg-surface-2 text-muted',
    brand: 'border-brand/40 bg-brand-soft text-brand',
    success: 'border-success/40 bg-success/10 text-success',
    warning: 'border-warning/40 bg-warning/10 text-warning',
    danger: 'border-danger/40 bg-danger/10 text-danger',
  } as const;
  return (
    <span
      className={cn(
        // Stamped, not rounded: a mark applied to a record.
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-micro font-medium uppercase',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------- States -------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    // A blank field on a form, hatched the way an unused box is struck through.
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-hatch px-6 py-10 text-center">
      {icon && <div className="mb-3 text-brand">{icon}</div>}
      <h3 className="text-sm font-semibold uppercase tracking-[0.06em]">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('am-skeleton h-4 w-full', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="h-6 w-6 animate-spin text-brand" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="am-card border-danger/50 px-5 py-6 text-center">
      <XCircle className="mx-auto h-6 w-6 text-danger" />
      <p className="mt-2 text-sm text-fg">{message}</p>
      {onRetry && (
        <Button className="mt-4" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* --------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  /*
   * The panel is height-capped and scrolls inside itself.
   *
   * It used to size itself to its content, with only the body capped at 70vh. Add
   * a header, a footer and the sheet's own padding and the whole thing could be
   * taller than the screen — and because it is aligned to the bottom edge on a
   * phone, the overflow went off the *top*, taking the close button with it.
   * There is no way to scroll a flex item back into view, so a tall dialog such
   * as Sync or Notifications became a dead end: nothing to dismiss, nothing to
   * scroll. Capping the panel and giving the body `min-h-0` inside a column keeps
   * the header and footer reachable at any height, on any screen.
   *
   * Rendered into `document.body` rather than where it is declared, and that is
   * not a detail. `backdrop-filter` — which the app header uses — makes an
   * element a containing block for its fixed-position descendants, so a modal
   * opened from a header button resolved `inset-0` against the 48px-tall header
   * instead of the viewport. The notification and sync dialogs were squeezed into
   * that strip: unreadable, with the close button off-screen. A portal puts the
   * dialog beyond the reach of any ancestor's filter, transform or overflow.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overscroll-contain p-0 sm:items-center sm:p-4">

      <div
        className="absolute inset-0 bg-fg/45 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col animate-slide-up rounded-t-2xl border border-border bg-surface shadow-lift sm:max-h-[85dvh] sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-rule bg-surface-2/60 px-5 py-3">
          <h2 className="am-tab-label min-w-0 truncate text-sm font-semibold uppercase tracking-[0.06em]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="am-touch -mr-2 grid shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        {/* pb-safe: the home-indicator area on an installed phone app. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-rule px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}


export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Confirm',
  title,
  body,
  variant = 'danger',
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  title: string;
  body: string;
  variant?: Variant;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={variant}
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{body}</p>
      </Modal>
    </>
  );
}

/* --------------------------------- Toasts -------------------------------- */

interface Toast {
  id: string;
  message: string;
  tone: 'success' | 'error' | 'info';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = uid('tst');
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-lift"
          >
            {toast.tone === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
            {toast.tone === 'error' && <XCircle className="h-4 w-4 shrink-0 text-danger" />}
            {toast.tone === 'info' && <Info className="h-4 w-4 shrink-0 text-brand" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------------------------- Misc --------------------------------- */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 border-b border-rule pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <h1 className="text-2xl font-semibold leading-tight sm:text-[1.75rem]">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
        </div>
        {/*
          The action wraps to its own line as a whole, rather than its own contents
          wrapping: a page header's button ending up half under its label is the
          "displaced button" this fixes.
        */}
        {action && <div className="am-row-x shrink-0 justify-end">{action}</div>}
      </div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-sm border border-border bg-surface-2">
        <div
          className="h-full origin-left animate-tally bg-brand transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {label && (
        <p className="mt-1.5 flex items-baseline justify-between gap-2 text-xs text-muted">
          <span>{label}</span>
          <span className="tabular shrink-0">{clamped}%</span>
        </p>
      )}
    </div>
  );
}
