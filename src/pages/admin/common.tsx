// FBV FleetOS — shared helpers for admin/insights pages (alerts, reports,
// analytics, users, audit, bulk upload, settings). Page-local; not part of
// the global shared component inventory.

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { cn } from '@/lib/utils';
import { add, list } from '@/lib/store';
import type { AuditEntry, CollectionName } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { fmtDateTimeEAT } from '@/lib/format';

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ---------------- layout primitives ---------------- */

export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn('mx-auto max-w-[1520px] p-4 md:p-6', className)}
    >
      {children}
    </motion.div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-card border border-border bg-white shadow-card', className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-[18px] font-bold leading-[26px] tracking-[-0.01em] text-ink-900', className)}>{children}</div>;
}

/* ---------------- buttons ---------------- */

type BtnVariant = 'accent' | 'navy' | 'outline' | 'danger' | 'ghost';

const BTN: Record<BtnVariant, string> = {
  accent: 'bg-accent text-navy-950 hover:bg-accent-strong font-semibold',
  navy: 'bg-navy-900 text-white hover:bg-navy-800 font-semibold',
  outline: 'border border-border bg-white text-ink-600 hover:bg-surface-muted font-medium',
  danger: 'bg-alert text-white hover:bg-alert-on-soft font-semibold',
  ghost: 'text-ink-600 hover:bg-surface-muted font-medium',
};

export function Btn({ variant = 'outline', className, ...rest }: {
  variant?: BtnVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] transition-all duration-150 ease-ops active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40',
        BTN[variant], className,
      )}
    />
  );
}

export const inputCls =
  'h-9 w-full rounded-lg border border-border bg-white px-3 text-[13px] text-ink-900 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30';

export const selectCls = inputCls;

/* ---------------- chips ---------------- */

export function Chip({ children, tone = 'inactive', className }: {
  children: ReactNode;
  tone?: 'ok' | 'warn' | 'alert' | 'inactive' | 'info' | 'accent' | 'navy';
  className?: string;
}) {
  const tones: Record<string, string> = {
    ok: 'bg-ok-soft text-ok-on-soft',
    warn: 'bg-warn-soft text-warn-on-soft',
    alert: 'bg-alert-soft text-alert-on-soft',
    inactive: 'bg-inactive-soft text-inactive-on-soft',
    info: 'bg-info-soft text-info-on-soft',
    accent: 'bg-accent-soft text-accent-strong',
    navy: 'bg-navy-900 text-white',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

/* ---------------- admin sub-nav ---------------- */

export function AdminSubNav({ active }: { active: 'users' | 'audit' | 'bulk' }) {
  const items = [
    { key: 'users' as const, label: 'Users & Roles', to: '/admin/users' },
    { key: 'audit' as const, label: 'Audit Trail', to: '/admin/audit' },
    { key: 'bulk' as const, label: 'Bulk Upload', to: '/admin/bulk-upload' },
  ];
  return (
    <div className="flex items-center gap-1">
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className={cn(
            'rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
            active === it.key ? 'bg-navy-900 text-white' : 'bg-white text-ink-600 border border-border hover:bg-surface-muted',
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

/* ---------------- demo-time helpers ---------------- */

/** Current wall-clock pinned to the demo universe's "today" (2026-07-28),
 *  stored EAT-wall-clock-as-UTC like the seed data. */
export function demoNowIso(): string {
  const n = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${TODAY}T${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}.000Z`;
}

/** Days from demo TODAY to an ISO date (positive = future). */
export function daysUntilDemo(isoDate: string): number {
  const target = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${TODAY}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** ISO date (yyyy-mm-dd) n days before demo TODAY. */
export function demoDateDaysAgo(days: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Whether an ISO datetime falls within the last `days` days of demo time. */
export function withinDemoDays(iso: string, days: number): boolean {
  return iso.slice(0, 10) >= demoDateDaysAgo(days);
}

/* ---------------- current user + audit ---------------- */

export function currentUser() {
  const users = list('users');
  return users[0] ?? { id: 'usr-01', name: 'Admin User', email: 'admin@fbv.co.ke', role: 'Admin' as const, active: true, lastLoginAt: null };
}

let auditCounter = 0;

/** Append an entry to the audit trail (who/when/what, optional before→after diff). */
export function logAudit(
  action: AuditEntry['action'],
  collection: string,
  recordId: string,
  summary: string,
  diff?: { field: string; before: unknown; after: unknown }[],
): void {
  const me = currentUser();
  add('audit', {
    id: `aud-${Date.now().toString(36)}-${(auditCounter++).toString(36)}`,
    at: demoNowIso(),
    userId: me.id,
    userName: me.name,
    action,
    collection,
    recordId,
    summary,
    diff,
  });
}

/* ---------------- downloads ---------------- */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/* ---------------- Excel export (SheetJS) ---------------- */

export interface XlsxSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/** Multi-sheet .xlsx export. Returns total data-row count. */
export function exportXlsx(filename: string, sheets: XlsxSheet[]): number {
  const wb = XLSX.utils.book_new();
  let total = 0;
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    total += s.rows.length;
  }
  XLSX.writeFile(wb, filename);
  return total;
}

/* ---------------- PDF export (jsPDF + autotable) ---------------- */

const NAVY: [number, number, number] = [10, 26, 47];
const CYAN: [number, number, number] = [6, 182, 212];

export function exportPdf(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  head: string[];
  rows: (string | number)[][];
  landscape?: boolean;
}): void {
  const doc = new jsPDF({ orientation: opts.landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // navy header band + cyan rule
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 64, 'F');
  doc.setFillColor(...CYAN);
  doc.rect(0, 64, pageW, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(`FBV FleetOS · ${opts.title}`, 40, 30);
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(201, 217, 234);
  doc.text(opts.subtitle ?? `Generated ${fmtDateTimeEAT(demoNowIso())}`, 40, 48);

  autoTable(doc, {
    startY: 84,
    head: [opts.head],
    body: opts.rows.map((r) => r.map(String)),
    styles: { font: 'courier', fontSize: 8, cellPadding: 4, textColor: [14, 27, 42] },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], font: 'helvetica', fontSize: 8, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 245, 249] },
    margin: { left: 40, right: 40 },
  });

  // footer page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(124, 141, 162);
    doc.text(
      `FBV FleetOS · Page ${i} of ${pages} · Generated ${fmtDateTimeEAT(demoNowIso())}`,
      40,
      doc.internal.pageSize.getHeight() - 20,
    );
  }
  doc.save(opts.filename);
}

/* ---------------- collection label map ---------------- */

export const COLLECTION_LABELS: Record<string, string> = {
  vehicles: 'Vehicles',
  drivers: 'Drivers',
  jobs: 'Dispatch',
  workOrders: 'Maintenance',
  fuelLogs: 'Fuel',
  documents: 'Documents',
  settings: 'Settings',
  users: 'Users',
  reports: 'Reports',
  backup: 'Backup',
  alerts: 'Alerts',
  geofences: 'Geofences',
  trips: 'Trips',
  inspections: 'DVIR',
  shifts: 'Shifts',
  audit: 'Audit',
  schedules: 'Maintenance',
  parts: 'Maintenance',
  assets: 'Assets',
  rewards: 'Rewards',
  safetyEvents: 'Safety',
};

export function collectionLabel(c: string): string {
  return COLLECTION_LABELS[c] ?? c;
}

export type { CollectionName };
