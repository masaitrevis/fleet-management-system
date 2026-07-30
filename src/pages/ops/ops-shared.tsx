// FBV FleetOS — shared helpers for ops pages (fuel, dispatch, assets).
// Page-local utilities only; global shared components live in @/components/shared.

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TODAY } from '@/lib/seed';
import type { FuelLog, Job, Trip, Vehicle } from '@/lib/types';

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Demo "now" — 28 Jul 2026, 14:35 EAT stored as UTC-shifted ISO (see seed.ts). */
export const DEMO_NOW_ISO = `${TODAY}T11:35:00.000Z`;
export const DEMO_NOW = new Date(DEMO_NOW_ISO);

export function isoDaysAgo(days: number, h = 8, m = 0): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(h - 3, m, 0, 0);
  return d.toISOString();
}

export function daysAgoOf(iso: string): number {
  return Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(iso.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

export function withinDays(iso: string, days: number): boolean {
  const ago = daysAgoOf(iso);
  return ago >= 0 && ago < days;
}

/** Deterministic 0..1 hash from a string (for stable pseudo-random display values). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ------------------------------------------------------------------ */
/* Page chrome                                                         */
/* ------------------------------------------------------------------ */

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn('mx-auto flex max-w-[1520px] flex-col gap-4 p-4 sm:p-6', className)}
    >
      {children}
    </motion.div>
  );
}

export function PageHeader({ title, sub, actions }: {
  title: string; sub?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">{title}</h1>
        {sub && <div className="mt-0.5 text-[13px] text-ink-400">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Btn({ icon: Icon, children, onClick, variant = 'primary', disabled, type = 'button', className }: {
  icon?: LucideIcon; children: React.ReactNode; onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'ok'; disabled?: boolean;
  type?: 'button' | 'submit'; className?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-all duration-100 active:scale-[0.97] disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-navy-950 hover:bg-accent-strong',
        variant === 'ok' && 'bg-ok text-white hover:bg-ok-on-soft',
        variant === 'danger' && 'bg-alert text-white hover:bg-alert-on-soft',
        variant === 'ghost' && 'border border-border bg-white text-ink-600 hover:bg-surface-muted',
        className,
      )}>
      {Icon && <Icon size={15} strokeWidth={2.2} />}
      {children}
    </button>
  );
}

/** Sub-nav pills (e.g. Fuel Log / Analytics & Idling). */
export function SubNavPills({ items }: { items: { to: string; label: string }[] }) {
  const { pathname } = useLocation();
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-white p-1 shadow-card w-fit">
      {items.map((it) => {
        const active = pathname === it.to;
        return (
          <Link key={it.to} to={it.to}
            className={cn('rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'bg-navy-900 text-white' : 'text-ink-600 hover:bg-surface-muted')}>
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: {
  title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
  className?: string; pad?: boolean;
}) {
  return (
    <section className={cn('rounded-card border border-border bg-white shadow-card', pad && 'p-4 sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold leading-[22px] tracking-[-0.005em] text-ink-900">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* MiniMap — stylized SVG map (map-fallback.svg base) with pins/lines  */
/* ------------------------------------------------------------------ */

export interface MapPin {
  lat: number; lng: number; color: string; label?: string;
  kind?: 'station' | 'truck' | 'stop' | 'dot'; ring?: boolean;
}
export interface MapLine { pts: { lat: number; lng: number }[]; color: string; dashed?: boolean; width?: number }

export function MiniMap({ pins, lines, height = 200, className }: {
  pins: MapPin[]; lines?: MapLine[]; height?: number; className?: string;
}) {
  const W = 800; const H = 400;
  const allPts = [...pins, ...(lines ?? []).flatMap((l) => l.pts)];
  // Nairobi-environs fallback bbox when there is nothing to plot
  const lats = allPts.length ? allPts.map((p) => p.lat) : [-1.38, -1.14];
  const lngs = allPts.length ? allPts.map((p) => p.lng) : [36.7, 37.02];
  const padLat = Math.max(0.02, (Math.max(...lats) - Math.min(...lats)) * 0.18);
  const padLng = Math.max(0.02, (Math.max(...lngs) - Math.min(...lngs)) * 0.18);
  const minLat = Math.min(...lats) - padLat; const maxLat = Math.max(...lats) + padLat;
  const minLng = Math.min(...lngs) - padLng; const maxLng = Math.max(...lngs) + padLng;
  const x = (lng: number) => 24 + ((lng - minLng) / (maxLng - minLng || 1)) * (W - 48);
  const y = (lat: number) => 20 + ((maxLat - lat) / (maxLat - minLat || 1)) * (H - 40);

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border bg-surface-muted', className)} style={{ height }}>
      <img src="/map-fallback.svg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {(lines ?? []).map((l, i) => (
          <motion.polyline key={i}
            points={l.pts.map((p) => `${x(p.lng)},${y(p.lat)}`).join(' ')}
            fill="none" stroke={l.color} strokeWidth={l.width ?? 3}
            strokeDasharray={l.dashed ? '7 6' : undefined} strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        ))}
      </svg>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {pins.map((p, i) => {
          const cx = x(p.lng); const cy = y(p.lat);
          return (
            <motion.g key={i} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.08 * i, duration: 0.3, ease: EASE }} style={{ transformOrigin: `${cx}px ${cy}px` }}>
              {p.ring && <circle cx={cx} cy={cy} r={16} fill="none" stroke="#06B6D4" strokeWidth={2.5} opacity={0.7} />}
              {p.kind === 'stop' ? (
                <>
                  <circle cx={cx} cy={cy} r={11} fill={p.color} stroke="#fff" strokeWidth={2.5} />
                  <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" fontFamily="JetBrains Mono">{p.label}</text>
                </>
              ) : (
                <>
                  <circle cx={cx} cy={cy} r={p.kind === 'dot' ? 5 : 8} fill={p.color} stroke="#fff" strokeWidth={2.5} />
                  {p.label && (
                    <text x={cx} y={cy - 13} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="#0E1B2A" fontFamily="Inter">{p.label}</text>
                  )}
                </>
              )}
            </motion.g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fuel math                                                           */
/* ------------------------------------------------------------------ */

export const IDLE_L_PER_H = 1.05; // diesel idle burn estimate

/** km/L for a fill: km driven since the previous fill of the same vehicle / litres.
 *  NOTE: the seeded dataset increments odometers "backwards" (older fills carry
 *  higher odometers), so we diff against the previous fill IN TIME and take abs. */
export function kmSincePrev(log: FuelLog, logs: FuelLog[]): number | null {
  const prev = logs
    .filter((l) => l.vehicleId === log.vehicleId && l.id !== log.id && l.at < log.at)
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!prev) return null;
  const km = Math.abs(log.odometerKm - prev.odometerKm);
  return km > 0 ? km : null;
}

export function kmPerLitre(log: FuelLog, logs: FuelLog[]): number | null {
  const km = kmSincePrev(log, logs);
  if (km == null || log.litres <= 0) return null;
  return km / log.litres;
}

/** Rolling 5-fill km/L average for a vehicle (excluding the given log). */
export function rollingAvgKmpl(vehicleId: string, logs: FuelLog[], excludeId?: string): number | null {
  const mine = logs
    .filter((l) => l.vehicleId === vehicleId && l.id !== excludeId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5);
  const vals = mine.map((l) => kmPerLitre(l, logs)).filter((v): v is number => v != null && v > 2 && v < 30);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export interface AnomalyFlag { code: string; label: string; severity: 'alert' | 'warn' }

/** Anomaly engine: volume > tank · GPS mismatch >5 km · consumption spike >35% · price outlier ±15%. */
export function evaluateFuelLog(log: FuelLog, vehicle: Vehicle | undefined, logs: FuelLog[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  if (vehicle && log.litres > vehicle.tankCapacityL) {
    flags.push({ code: 'VOL > TANK', label: `VOL > TANK (${log.litres.toFixed(0)} L > ${vehicle.tankCapacityL} L)`, severity: 'alert' });
  }
  if (log.anomaly === 'location_mismatch') {
    // Vehicle GPS at fill time vs station coords (seeded mismatch cases)
    const d = Math.max(6, Math.round(haversineKm(log.lat, log.lng, vehicle?.homeLat ?? -1.3031, vehicle?.homeLng ?? 36.8526) + hash01(log.id) * 28));
    flags.push({ code: 'GPS MISMATCH', label: `GPS MISMATCH ${d} km`, severity: 'alert' });
  }
  const avg = rollingAvgKmpl(log.vehicleId, logs, log.id);
  const kmpl = kmPerLitre(log, logs);
  if (log.anomaly === 'consumption_spike' || (avg != null && kmpl != null && kmpl < avg * 0.65)) {
    const pct = avg != null && kmpl != null ? Math.max(36, Math.round((1 - kmpl / avg) * 100)) : 42;
    flags.push({ code: 'CONSUMPTION SPIKE', label: `CONSUMPTION SPIKE +${pct}%`, severity: 'warn' });
  }
  // Price outlier ±15% vs area (station) average
  const area = logs.filter((l) => l.station === log.station && l.id !== log.id);
  if (area.length >= 2) {
    const areaAvg = area.reduce((a, l) => a + l.pricePerLKes, 0) / area.length;
    const dev = (log.pricePerLKes - areaAvg) / areaAvg;
    if (Math.abs(dev) > 0.15) {
      flags.push({ code: 'PRICE OUTLIER', label: `PRICE OUTLIER ${dev > 0 ? '+' : ''}${Math.round(dev * 100)}%`, severity: 'warn' });
    }
  }
  return flags;
}

/** Idle minutes per vehicle per day offset (0 = today) from trips. */
export function idleMinutesByVehicleDay(trips: Trip[], days: number): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of trips) {
    const ago = daysAgoOf(t.startAt);
    if (ago >= 0 && ago < days) {
      const k = `${t.vehicleId}|${ago}`;
      m.set(k, (m.get(k) ?? 0) + t.idleMin);
    }
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* Jobs / dispatch helpers                                             */
/* ------------------------------------------------------------------ */

export const JOB_STATUS_ORDER = ['draft', 'assigned', 'en-route', 'arrived', 'delivered'] as const;
export const JOB_STATUS_LABEL: Record<Job['status'], string> = {
  draft: 'New', assigned: 'Assigned', 'en-route': 'En route', arrived: 'Arrived', delivered: 'Delivered', cancelled: 'Cancelled',
};

export function jobStopsSummary(job: Job): { origin: string; middle: number; dest: string } {
  const first = job.stops[0];
  const last = job.stops[job.stops.length - 1];
  return {
    origin: first ? first.label.replace(/^(Pickup|Drop) — /, '') : '—',
    middle: Math.max(0, job.stops.length - 2),
    dest: last ? last.label.replace(/^(Pickup|Drop) — /, '') : '—',
  };
}

/** Rough route distance across stops (haversine × 1.28 road factor). */
export function jobDistanceKm(job: Job): number {
  let d = 0;
  for (let i = 1; i < job.stops.length; i++) {
    d += haversineKm(job.stops[i - 1].lat, job.stops[i - 1].lng, job.stops[i].lat, job.stops[i].lng);
  }
  return Math.round(d * 1.28);
}

export function jobDurationMin(job: Job): number {
  const km = jobDistanceKm(job);
  return Math.round(km / 0.85 + job.stops.length * 15); // ~51 km/h avg + service time
}

/** Progress 0..1 for en-route jobs (completed stops + deterministic leg fraction). */
export function jobProgress(job: Job): number {
  const done = job.stops.filter((s) => s.completedAt).length;
  if (job.status === 'delivered') return 1;
  if (job.stops.length === 0) return 0;
  const leg = job.status === 'en-route' ? 0.35 + hash01(job.id) * 0.45 : 0;
  return Math.min(0.98, (done + leg) / job.stops.length);
}

export function jobEta(job: Job): string {
  if (job.status !== 'en-route') return '—';
  const mins = Math.round((1 - jobProgress(job)) * jobDurationMin(job));
  const eta = new Date(DEMO_NOW.getTime() + mins * 60000);
  return `${String(eta.getUTCHours()).padStart(2, '0')}:${String(eta.getUTCMinutes()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Excel helpers (xlsx)                                                */
/* ------------------------------------------------------------------ */

export function downloadSheet(rows: Record<string, unknown>[], filename: string, sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export function downloadWorkbook(sheets: { name: string; rows: Record<string, unknown>[] }[], filename: string) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  XLSX.writeFile(wb, filename);
}

export async function readSheetRows(file: File): Promise<Record<string, unknown>[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function useReducedMotion(): boolean {
  return useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
}

export function relTime(iso: string): string {
  const mins = Math.round((DEMO_NOW.getTime() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}
