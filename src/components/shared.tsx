// FBV FleetOS — shared component inventory (design.md §6).
// Page agents import these; do not restyle per page.

import { create } from 'zustand';
import { AnimatePresence, motion } from 'framer-motion';
import {
  useCallback, useEffect, useId, useRef, useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet,
  Info, Layers, LocateFixed, Maximize, Minus, MoreHorizontal, Pause, Play,
  Plus, Upload, X, XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { StatusKey } from '@/lib/format';
import { scoreColor } from '@/lib/format';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ================================================================== */
/* 1. StatusPill                                                       */
/* ================================================================== */

const STATUS_STYLES: Record<StatusKey, { dot: string; pill: string }> = {
  ok: { dot: 'bg-ok', pill: 'bg-ok-soft text-ok-on-soft' },
  warn: { dot: 'bg-warn', pill: 'bg-warn-soft text-warn-on-soft' },
  alert: { dot: 'bg-alert', pill: 'bg-alert-soft text-alert-on-soft' },
  inactive: { dot: 'bg-inactive', pill: 'bg-inactive-soft text-inactive-on-soft' },
  info: { dot: 'bg-info', pill: 'bg-info-soft text-info-on-soft' },
};

export function StatusPill({ status, label, pulse, className }: {
  status: StatusKey; label: string; pulse?: boolean; className?: string;
}) {
  const s = STATUS_STYLES[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium uppercase tracking-[0.02em]', s.pill, className)}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className={cn('absolute inline-flex h-full w-full rounded-full animate-pulse-live-ring', s.dot)} />}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', s.dot)} />
      </span>
      {label}
    </span>
  );
}

/* ================================================================== */
/* 2. PlateTag — KE-plate styled chip                                  */
/* ================================================================== */

export function PlateTag({ plate, className }: { plate: string; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded border border-ink-900/80 bg-white px-1.5 py-0.5',
      'font-mono text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-900',
      className,
    )}>
      {plate}
    </span>
  );
}

/* ================================================================== */
/* 3. KPIStatCard — count-up value + delta chip + sparkline            */
/* ================================================================== */

function useCountUp(target: number, duration = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

export function Sparkline({ data, color = '#06B6D4', height = 40, className }: {
  data: number[]; color?: string; height?: number; className?: string;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <defs>
            <linearGradient id={`spk-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.8} fill={`url(#spk-${id})`} isAnimationActive animationDuration={800} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function KPIStatCard({ label, value, format, delta, deltaGood, spark, sparkColor, icon: Icon, onClick, className }: {
  label: string;
  value: number;
  format?: (v: number) => string;
  delta?: string;
  deltaGood?: boolean;
  spark?: number[];
  sparkColor?: string;
  icon: LucideIcon;
  onClick?: () => void;
  className?: string;
}) {
  const v = useCountUp(value);
  const shown = format ? format(v) : Math.round(v).toLocaleString('en-KE');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-1 rounded-card border border-border bg-white p-4 text-left shadow-card',
        'transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop active:scale-[0.99]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
          <Icon size={16} strokeWidth={2.2} />
        </span>
      </div>
      <div className="font-mono text-[26px] font-bold leading-8 tracking-[-0.01em] text-ink-900 tabular-nums">{shown}</div>
      <div className="flex items-center justify-between gap-2">
        {delta && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium',
            deltaGood === undefined ? 'bg-inactive-soft text-inactive-on-soft'
              : deltaGood ? 'bg-ok-soft text-ok-on-soft' : 'bg-alert-soft text-alert-on-soft',
          )}>
            {delta}
          </span>
        )}
        {spark && <Sparkline data={spark} color={sparkColor} height={28} className="max-w-[88px]" />}
      </div>
    </button>
  );
}

/* ================================================================== */
/* 4. DataTable                                                        */
/* ================================================================== */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  mono?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export function DataTable<T extends { id: string }>({
  columns, rows, loading, empty, onRowClick, rowActions, pageSize = 12, compact, className,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean }[];
  pageSize?: number;
  compact?: boolean;
  className?: string;
}) {
  const [page, setPage] = useState(0);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => { if (page >= pages) setPage(0); }, [pages, page]);

  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-white shadow-card', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="sticky top-0 border-b border-border bg-surface-muted/70">
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}
                  className={cn('h-9 px-3 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400',
                    c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                  {c.header}
                </th>
              ))}
              {rowActions && <th className="h-9 w-10 px-2" />}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3', compact ? 'h-9' : 'h-11')}>
                      <div className="h-3.5 animate-pulse rounded bg-surface-muted" style={{ width: `${55 + ((i * 17 + c.key.length * 13) % 40)}%` }} />
                    </td>
                  ))}
                  {rowActions && <td />}
                </tr>
              ))
              : pageRows.map((row, i) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.025, ease: EASE }}
                  onClick={() => onRowClick?.(row)}
                  className={cn('border-b border-border/60 transition-colors duration-100 hover:bg-surface-muted',
                    onRowClick && 'cursor-pointer')}
                >
                  {columns.map((c) => (
                    <td key={c.key}
                      className={cn('px-3 text-ink-900', compact ? 'h-9' : 'h-11',
                        c.mono && 'font-mono text-[12px] tracking-[0.02em]',
                        c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                      {c.render(row, i)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="relative px-2" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-surface-muted hover:text-ink-900">
                        <MoreHorizontal size={16} />
                      </button>
                      {menuFor === row.id && (
                        <div className="absolute right-2 top-8 z-30 min-w-[160px] rounded-lg border border-border bg-white py-1 shadow-pop" onMouseLeave={() => setMenuFor(null)}>
                          {rowActions(row).map((a) => (
                            <button key={a.label} type="button"
                              onClick={() => { setMenuFor(null); a.onClick(); }}
                              className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-muted',
                                a.danger ? 'text-alert' : 'text-ink-900')}>
                              {a.icon && <a.icon size={14} />}
                              {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  )}
                </motion.tr>
              ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length === 0 && <div className="p-6">{empty ?? <EmptyState title="Nothing here yet" hint="Records will appear here once added." />}</div>}
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-micro text-ink-400">
        <span className="font-mono">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-muted disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="font-mono">{page + 1} / {pages}</span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-muted disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 5. Drawer (right, 480px / full-screen mobile)                       */
/* ================================================================== */

export function Drawer({ open, onClose, title, children, footer, width = 480 }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[900] bg-navy-950/45"
          />
          <motion.aside
            initial={{ x: width }} animate={{ x: 0 }} exit={{ x: width }}
            transition={{ duration: 0.3, ease: EASE }}
            style={{ width: 'min(100vw, ' + width + 'px)' }}
            className="fixed right-0 top-0 z-[901] flex h-full flex-col bg-white shadow-pop sm:rounded-l-drawer"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="text-[15px] font-semibold leading-[22px] text-ink-900">{title}</div>
              <button type="button" onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-muted hover:text-ink-900">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="border-t border-border px-5 py-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ================================================================== */
/* 6. Modal / ConfirmDialog (incl. typed-confirmation destructive)     */
/* ================================================================== */

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[950] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }} onClick={onClose} className="absolute inset-0 bg-navy-950/45" />
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE }}
            className={cn('relative w-full rounded-drawer bg-white shadow-pop', wide ? 'max-w-2xl' : 'max-w-md')}
          >
            {title && (
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div className="text-[15px] font-semibold text-ink-900">{title}</div>
                <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-surface-muted"><X size={18} /></button>
              </div>
            )}
            <div className="px-5 py-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', destructive, typedConfirmation }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; body?: ReactNode; confirmLabel?: string; destructive?: boolean;
  /** e.g. "DELETE" — user must type it to enable the button */
  typedConfirmation?: string;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);
  const blocked = typedConfirmation ? typed !== typedConfirmation : false;
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={blocked} onClick={() => { onConfirm(); onClose(); }}
            className={cn('h-9 rounded-lg px-4 text-[13px] font-semibold text-white transition-colors disabled:opacity-40',
              destructive ? 'bg-alert hover:bg-alert-on-soft' : 'bg-accent hover:bg-accent-strong')}>
            {confirmLabel}
          </button>
        </>
      }>
      <div className={cn('flex flex-col gap-3 text-[14px] text-ink-600', destructive && 'text-alert-on-soft')}>
        {destructive && (
          <div className="flex items-center gap-2 rounded-lg bg-alert-soft px-3 py-2 text-[13px] font-medium text-alert-on-soft">
            <AlertTriangle size={16} /> This action cannot be undone.
          </div>
        )}
        <div className="text-ink-600">{body}</div>
        {typedConfirmation && (
          <label className="flex flex-col gap-1 text-[13px] text-ink-600">
            Type <span className="font-mono font-semibold text-ink-900">{typedConfirmation}</span> to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)}
              className="h-9 rounded-lg border border-border px-3 font-mono text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* 7. Tabs — underline style                                           */
/* ================================================================== */

export function Tabs({ tabs, active, onChange, className }: {
  tabs: { key: string; label: string; count?: number }[];
  active: string; onChange: (key: string) => void; className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-border', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={cn('relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors',
            active === t.key ? 'text-ink-900' : 'text-ink-400 hover:text-ink-600')}>
          {t.label}
          {t.count !== undefined && (
            <span className="rounded-full bg-inactive-soft px-1.5 py-0.5 text-micro font-medium text-inactive-on-soft">{t.count}</span>
          )}
          {active === t.key && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 8. Toast (+ toast store)                                            */
/* ================================================================== */

export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  status: StatusKey;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Fire a toast from anywhere. */
export function toast(t: Omit<ToastItem, 'id'>) {
  useToastStore.getState().push(t);
}

const TOAST_BAR: Record<StatusKey, string> = {
  ok: 'bg-ok', warn: 'bg-warn', alert: 'bg-alert', inactive: 'bg-inactive', info: 'bg-info',
};
const TOAST_ICON: Record<StatusKey, LucideIcon> = {
  ok: CheckCircle2, warn: AlertTriangle, alert: XCircle, inactive: Info, info: Info,
};

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[1000] flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.status];
          return (
            <motion.div key={t.id}
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="pointer-events-auto flex overflow-hidden rounded-xl border border-border bg-white shadow-pop">
              <div className={cn('w-1 shrink-0', TOAST_BAR[t.status])} />
              <div className="flex flex-1 items-start gap-2.5 px-3 py-2.5">
                <Icon size={16} className={cn('mt-0.5 shrink-0', TOAST_BAR[t.status].replace('bg-', 'text-'))} />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-ink-900">{t.title}</div>
                  {t.body && <div className="text-[12px] leading-4 text-ink-600">{t.body}</div>}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="text-ink-400 hover:text-ink-900"><X size={14} /></button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/* 9. AlertBanner                                                      */
/* ================================================================== */

export function AlertBanner({ severity, message, actionLabel, onAction, onDismiss, className }: {
  severity: 'warn' | 'alert'; message: ReactNode;
  actionLabel?: string; onAction?: () => void; onDismiss?: () => void; className?: string;
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2 text-[13px] font-medium',
      severity === 'alert' ? 'bg-alert-soft text-alert-on-soft' : 'bg-warn-soft text-warn-on-soft',
      className,
    )}>
      <AlertTriangle size={15} className="shrink-0" />
      <div className="flex-1">{message}</div>
      {actionLabel && (
        <button type="button" onClick={onAction} className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80">{actionLabel}</button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100"><X size={14} /></button>
      )}
    </div>
  );
}

/* ================================================================== */
/* 10. TimelineSlider — route-replay scrubber                          */
/* ================================================================== */

export interface TimelineEvent {
  at: number;              // 0..1 fraction along timeline
  kind: 'harsh' | 'stop' | 'geofence';
  label?: string;
}

export function TimelineSlider({ durationLabel, events = [], playing, speed, onPlayPause, onSpeed, onScrub, progress }: {
  durationLabel: string;
  events?: TimelineEvent[];
  playing: boolean;
  speed: number;
  onPlayPause: () => void;
  onSpeed: (s: number) => void;
  onScrub: (frac: number) => void;
  progress: number; // 0..1
}) {
  const SPEEDS = [1, 4, 16, 60];
  const ref = useRef<HTMLDivElement>(null);
  const scrub = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onScrub(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  }, [onScrub]);
  return (
    <div className="flex items-center gap-3 rounded-card border border-border bg-white px-4 py-3 shadow-card">
      <button type="button" onClick={onPlayPause}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 text-white hover:bg-navy-800">
        {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={() => onSpeed(s)}
            className={cn('rounded-md px-1.5 py-0.5 font-mono text-micro font-medium',
              speed === s ? 'bg-accent-soft text-accent-strong' : 'text-ink-400 hover:bg-surface-muted')}>
            {s}×
          </button>
        ))}
      </div>
      <div ref={ref} className="relative h-8 flex-1 cursor-pointer select-none"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); scrub(e.clientX); }}
        onPointerMove={(e) => e.buttons === 1 && scrub(e.clientX)}>
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-muted" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
        {events.map((ev, i) => (
          <span key={i} title={ev.label}
            className={cn('absolute top-1/2 h-2.5 w-1 -translate-y-1/2 rounded-full',
              ev.kind === 'harsh' ? 'bg-alert' : ev.kind === 'stop' ? 'bg-inactive' : 'bg-accent')}
            style={{ left: `${ev.at * 100}%` }} />
        ))}
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-card"
          style={{ left: `${progress * 100}%` }} />
      </div>
      <div className="shrink-0 font-mono text-[12px] font-medium tracking-[0.02em] text-ink-600">{durationLabel}</div>
    </div>
  );
}

/* ================================================================== */
/* 11. MapControls — floating control stack                            */
/* ================================================================== */

export interface MapLayerToggles {
  geofences: boolean;
  trails: boolean;
  labels: boolean;
  traffic: boolean;
}

export function MapControls({ onZoomIn, onZoomOut, onFitFleet, layers, onLayers, onFullscreen, replay, onReplay }: {
  onZoomIn: () => void; onZoomOut: () => void; onFitFleet: () => void;
  layers: MapLayerToggles; onLayers: (l: MapLayerToggles) => void;
  onFullscreen?: () => void;
  replay?: boolean; onReplay?: () => void;
}) {
  const [layersOpen, setLayersOpen] = useState(false);
  const btn = cn(
    'flex h-9 w-9 items-center justify-center text-ink-600 transition-colors hover:bg-surface-muted hover:text-ink-900',
  );
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-white shadow-card">
        <button type="button" title="Zoom in" onClick={onZoomIn} className={btn}><Plus size={16} /></button>
        <div className="h-px bg-border" />
        <button type="button" title="Zoom out" onClick={onZoomOut} className={btn}><Minus size={16} /></button>
      </div>
      <div className="relative">
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-white shadow-card">
          <button type="button" title="Layers" onClick={() => setLayersOpen(!layersOpen)}
            className={cn(btn, layersOpen && 'bg-accent-soft text-accent-strong')}><Layers size={16} /></button>
          <div className="h-px bg-border" />
          <button type="button" title="Fit fleet" onClick={onFitFleet} className={btn}><LocateFixed size={16} /></button>
          {onFullscreen && (
            <>
              <div className="h-px bg-border" />
              <button type="button" title="Fullscreen" onClick={onFullscreen} className={btn}><Maximize size={15} /></button>
            </>
          )}
        </div>
        {layersOpen && (
          <div className="absolute right-11 top-0 z-20 w-44 rounded-lg border border-border bg-white p-2 shadow-pop" onMouseLeave={() => setLayersOpen(false)}>
            {([
              ['geofences', 'Geofences'], ['trails', 'Trails'], ['labels', 'Labels'], ['traffic', 'Traffic'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-900 hover:bg-surface-muted">
                <input type="checkbox" checked={layers[k]}
                  onChange={(e) => onLayers({ ...layers, [k]: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#06B6D4]" />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>
      {onReplay && (
        <button type="button" onClick={onReplay}
          className={cn('rounded-lg border px-2.5 py-1.5 text-micro font-semibold uppercase tracking-[0.06em] shadow-card transition-colors',
            replay ? 'border-accent bg-accent text-navy-950' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
          Replay
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/* 12. ScoreRing                                                       */
/* ================================================================== */

export function ScoreRing({ score, size = 88, stroke = 8, className }: {
  score: number; size?: number; stroke?: number; className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDF1F6" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute font-mono font-bold text-ink-900" style={{ fontSize: size * 0.24 }}>{Math.round(score)}</span>
    </div>
  );
}

/* ================================================================== */
/* 13. HeatmapGrid                                                     */
/* ================================================================== */

export function heatColor(v: number): string {
  // 0..1 grey → cyan → amber → red
  if (v < 0.33) {
    const t = v / 0.33;
    return `rgb(${Math.round(226 + (6 - 226) * t)}, ${Math.round(232 + (182 - 232) * t)}, ${Math.round(240 + (212 - 240) * t)})`;
  }
  if (v < 0.66) {
    const t = (v - 0.33) / 0.33;
    return `rgb(${Math.round(6 + (245 - 6) * t)}, ${Math.round(182 + (158 - 182) * t)}, ${Math.round(212 + (11 - 212) * t)})`;
  }
  const t = (v - 0.66) / 0.34;
  return `rgb(${Math.round(245 + (220 - 245) * t)}, ${Math.round(158 + (38 - 158) * t)}, ${Math.round(11 + (38 - 11) * t)})`;
}

export function HeatmapGrid({ rows, cols, values, onCellClick, cellSize = 22, className }: {
  rows: string[]; cols: string[];
  /** values[r][c] in 0..1 (null = no data) */
  values: (number | null)[][];
  onCellClick?: (r: number, c: number) => void;
  cellSize?: number; className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <div className="inline-flex flex-col gap-1">
        <div className="flex gap-1">
          <div style={{ width: 120 }} />
          {cols.map((c) => (
            <div key={c} className="truncate text-center text-micro text-ink-400" style={{ width: cellSize }}>{c}</div>
          ))}
        </div>
        {rows.map((r, ri) => (
          <div key={r} className="flex items-center gap-1">
            <div className="truncate pr-2 text-[12px] font-medium text-ink-600" style={{ width: 120 }}>{r}</div>
            {cols.map((_, ci) => {
              const v = values[ri]?.[ci];
              return (
                <button key={ci} type="button" onClick={() => onCellClick?.(ri, ci)}
                  title={v == null ? 'No data' : v.toFixed(2)}
                  className="rounded-[4px] transition-transform hover:scale-110"
                  style={{ width: cellSize, height: cellSize, background: v == null ? '#F2F5F9' : heatColor(v) }} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 14. Chart wrappers (Recharts)                                       */
/* ================================================================== */

const AXIS = { fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#7C8DA2' } as const;
const GRID = '#EDF1F6';

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-pop">
      {label !== undefined && <div className="mb-1 text-micro font-medium uppercase tracking-[0.06em] text-ink-400">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[12px] text-ink-900">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <b>{p.value}</b>
        </div>
      ))}
    </div>
  );
}

export function LineChartCard({ data, xKey, series, height = 240, area, className }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color?: string }[];
  height?: number; area?: boolean; className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const ChartEl = area ? AreaChart : LineChart;
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ChartEl data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`g-${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? '#06B6D4'} stopOpacity={0.25} />
                <stop offset="100%" stopColor={s.color ?? '#06B6D4'} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} />
          <RTooltip content={<ChartTooltip />} />
          {series.map((s, i) => area ? (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? '#06B6D4'} strokeWidth={2}
              fill={`url(#g-${id}-${i})`} isAnimationActive animationDuration={800} dot={false} />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? '#06B6D4'} strokeWidth={2}
              isAnimationActive animationDuration={800} dot={false} />
          ))}
        </ChartEl>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChartCard({ data, xKey, series, height = 240, stacked, className }: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color?: string }[];
  height?: number; stacked?: boolean; className?: string;
}) {
  const palette = ['#0F2540', '#06B6D4', '#7C3AED', '#DB2777'];
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} />
          <RTooltip content={<ChartTooltip />} cursor={{ fill: '#F2F5F9' }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId={stacked ? 'stack' : undefined}
              fill={s.color ?? palette[i % palette.length]} radius={stacked ? 0 : [4, 4, 0, 0]}
              isAnimationActive animationDuration={800} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutChartCard({ data, height = 220, className }: {
  data: { name: string; value: number; color: string }[];
  height?: number; className?: string;
}) {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="88%" paddingAngle={2}
            strokeWidth={0} isAnimationActive animationDuration={800}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <RTooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ================================================================== */
/* 15. FileDropzone                                                    */
/* ================================================================== */

export function FileDropzone({ onFiles, accept = '.xlsx,.csv', sampleHref, className }: {
  onFiles: (files: File[]) => void; accept?: string; sampleHref?: string; className?: string;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(Array.from(e.dataTransfer.files)); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors',
        drag ? 'border-accent bg-accent-soft/40' : 'border-border bg-white hover:border-ink-400/50',
        className,
      )}
    >
      <input ref={inputRef} type="file" accept={accept} multiple className="hidden"
        onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
        <FileSpreadsheet size={20} />
      </span>
      <div className="text-[14px] font-semibold text-ink-900">Drop .xlsx / .csv here, or click to browse</div>
      <div className="flex items-center gap-1 text-[12px] text-ink-400">
        <Upload size={12} /> Rows are validated before anything is written
      </div>
      {sampleHref && (
        <a href={sampleHref} onClick={(e) => e.stopPropagation()} className="text-[12px] font-medium text-accent-strong underline underline-offset-2">
          Download sample template
        </a>
      )}
    </div>
  );
}

/* ================================================================== */
/* 16. ColumnMapper                                                    */
/* ================================================================== */

export interface ColumnMapping {
  source: string;
  target: string | null;
  confidence: number; // 0..1
}

export function ColumnMapper({ mappings, targets, onChange, className }: {
  mappings: ColumnMapping[];
  targets: { key: string; label: string; required?: boolean }[];
  onChange: (m: ColumnMapping[]) => void;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-white', className)}>
      <div className="grid grid-cols-[1fr,32px,1fr,90px] items-center gap-2 border-b border-border bg-surface-muted/70 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
        <span>Source column</span><span /><span>Target field</span><span>Match</span>
      </div>
      {mappings.map((m, i) => (
        <div key={m.source} className="grid grid-cols-[1fr,32px,1fr,90px] items-center gap-2 border-b border-border/60 px-4 py-2.5 last:border-0">
          <span className="font-mono text-[12px] text-ink-900">{m.source}</span>
          <ChevronRight size={14} className="text-ink-400" />
          <select
            value={m.target ?? ''}
            onChange={(e) => {
              const next = [...mappings];
              next[i] = { ...m, target: e.target.value || null };
              onChange(next);
            }}
            className="h-8 rounded-lg border border-border bg-white px-2 text-[13px] text-ink-900 outline-none focus:border-accent"
          >
            <option value="">— skip —</option>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>{t.label}{t.required ? ' *' : ''}</option>
            ))}
          </select>
          <span className={cn('justify-self-start rounded-full px-2 py-0.5 text-micro font-medium',
            m.confidence > 0.85 ? 'bg-ok-soft text-ok-on-soft' : m.confidence > 0.5 ? 'bg-warn-soft text-warn-on-soft' : 'bg-inactive-soft text-inactive-on-soft')}>
            {Math.round(m.confidence * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 17. AuditDiff                                                       */
/* ================================================================== */

export function AuditDiff({ rows, className }: {
  rows: { field: string; before: unknown; after: unknown }[];
  className?: string;
}) {
  const fmt = (v: unknown) => (v === null || v === undefined || v === '') ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return (
    <div className={cn('overflow-hidden rounded-lg border border-border', className)}>
      {rows.map((r) => (
        <div key={r.field} className="grid grid-cols-[140px,1fr,1fr] border-b border-border/60 text-[12px] last:border-0">
          <div className="bg-surface-muted/60 px-3 py-2 font-medium text-ink-600">{r.field}</div>
          <div className="bg-alert-soft/50 px-3 py-2 font-mono text-alert-on-soft line-through decoration-alert/50">{fmt(r.before)}</div>
          <div className="bg-ok-soft/50 px-3 py-2 font-mono text-ok-on-soft">{fmt(r.after)}</div>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* 18. EmptyState                                                      */
/* ================================================================== */

export function EmptyState({ icon: Icon, image, title, hint, ctaLabel, onCta, className }: {
  icon?: LucideIcon; image?: string; title: string; hint?: string;
  ctaLabel?: string; onCta?: () => void; className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      {image ? (
        <img src={image} alt="" className="w-48 opacity-90" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-50 text-navy-800">
          {Icon ? <Icon size={24} /> : <Info size={24} />}
        </span>
      )}
      <div className="text-[18px] font-bold leading-[26px] tracking-[-0.01em] text-ink-900">{title}</div>
      {hint && <div className="max-w-sm text-[13px] leading-5 text-ink-400">{hint}</div>}
      {ctaLabel && (
        <button type="button" onClick={onCta}
          className="mt-1 h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/* 19. SignaturePad                                                    */
/* ================================================================== */

export function SignaturePad({ onDone, height = 180, className }: {
  onDone: (dataUrl: string) => void; height?: number; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement!;
    canvas.width = parent.clientWidth * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    ctx.strokeStyle = '#0E1B2A';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-white', className)}>
      <canvas
        ref={ref}
        className="touch-none"
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath(); ctx.moveTo(x, y);
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.lineTo(x, y); ctx.stroke();
        }}
        onPointerUp={() => { drawing.current = false; }}
      />
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
        <button type="button"
          onClick={() => {
            const c = ref.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
          }}
          className="h-8 rounded-lg border border-border px-3 text-[12px] font-medium text-ink-600 hover:bg-surface-muted">
          Clear
        </button>
        <button type="button" disabled={empty}
          onClick={() => onDone(ref.current!.toDataURL('image/png'))}
          className="h-8 rounded-lg bg-accent px-3 text-[12px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
          Done
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/* 20. ChecklistItem (DVIR)                                            */
/* ================================================================== */

export function ChecklistItem({ label, value, note, onChange, onNote, className }: {
  label: string;
  value: 'ok' | 'defect' | 'na';
  note?: string;
  onChange: (v: 'ok' | 'defect' | 'na') => void;
  onNote?: (note: string) => void;
  className?: string;
}) {
  const opts = [
    { v: 'ok' as const, label: 'OK', active: 'bg-ok text-white' },
    { v: 'defect' as const, label: 'Defect', active: 'bg-alert text-white' },
    { v: 'na' as const, label: 'N/A', active: 'bg-inactive text-white' },
  ];
  return (
    <div className={cn('rounded-card border border-border bg-white p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-medium text-ink-900">{label}</span>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {opts.map((o) => (
            <button key={o.v} type="button" onClick={() => onChange(o.v)}
              className={cn('px-3 py-1.5 text-[12px] font-semibold transition-colors',
                value === o.v ? o.active : 'bg-white text-ink-400 hover:bg-surface-muted')}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {value === 'defect' && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              value={note ?? ''}
              onChange={(e) => onNote?.(e.target.value)}
              placeholder="Describe the defect…"
              rows={2}
              className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <span className="text-micro text-ink-400">Photo capture attaches here on mobile.</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
