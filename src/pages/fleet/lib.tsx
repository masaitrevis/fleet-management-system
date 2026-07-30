// FBV FleetOS — shared helpers for the fleet/maintenance page set
// (vehicles, vehicle 360, work orders, schedules & DTC, parts, documents).
// All derivation is anchored to the demo "today" (seed.TODAY = 2026-07-28).

import * as XLSX from 'xlsx';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { add, kvGet, kvSet, useCollection, useKV } from '@/lib/store';
import { toast } from '@/components/shared';
import { avatarTint, initials } from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import type {
  AlertRec, Driver, MaintenanceSchedule, Part, Vehicle, Vendor, WorkOrder,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/* ---------------- demo-anchored date math ---------------- */

const T0 = Date.parse(`${TODAY}T00:00:00Z`);

/** Days from demo "today" (2026-07-28) to an ISO date/datetime. Positive = future. */
export function demoDaysUntil(iso: string): number {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Math.round((t - T0) / 86400000);
}

export function addDaysISO(days: number): string {
  const d = new Date(T0 + days * 86400000);
  return d.toISOString().slice(0, 10);
}

export function nowIsoEAT(h = 9, m = 0): string {
  // demo-consistent "now" stamp stored EAT-wall-clock-as-UTC (seed convention)
  return new Date(Date.parse(`${TODAY}T00:00:00Z`) + (h - 3) * 3600000 + m * 60000).toISOString();
}

/** Age in whole days of an ISO date/datetime relative to demo today. */
export function demoDaysAgo(iso: string): number {
  return -demoDaysUntil(iso);
}

/* ---------------- deterministic hashing ---------------- */

export function hashStr(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** deterministic pseudo-random in [a,b) from a string seed */
export function seededRange(seed: string, a: number, b: number): number {
  return a + (hashStr(seed) % 1000) / 1000 * (b - a);
}

/* ---------------- small presentational atoms ---------------- */

export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', avatarTint(name), className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}

export function SectionCard({ title, right, children, className, pad = true }: {
  title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={cn('rounded-card border border-border bg-white shadow-card', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold leading-[22px] tracking-[-0.005em] text-ink-900">{title}</h2>
          {right}
        </header>
      )}
      <div className={cn(pad && 'p-5')}>{children}</div>
    </section>
  );
}

/** Maintenance module sub-nav pills (Work Orders · Schedules & DTC · Parts & Vendors). */
export function MaintSubNav({ active }: { active: 'wo' | 'schedules' | 'parts' }) {
  const items = [
    { key: 'wo', label: 'Work Orders', to: '/maintenance' },
    { key: 'schedules', label: 'Schedules & DTC', to: '/maintenance/schedules' },
    { key: 'parts', label: 'Parts & Vendors', to: '/maintenance/parts' },
  ] as const;
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {items.map((it, i) => {
        const isActive = it.key === active;
        const Icon = i === 0 && !isActive ? ArrowLeft : ArrowRight;
        return (
          <Link
            key={it.key}
            to={it.to}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors',
              isActive
                ? 'border-accent bg-accent-soft text-accent-strong'
                : 'border-border bg-white text-ink-600 hover:bg-surface-muted',
            )}
          >
            {!isActive && i === 0 && <Icon size={13} />}
            {it.label}
            {!isActive && i !== 0 && <Icon size={13} />}
          </Link>
        );
      })}
    </nav>
  );
}

/* ---------------- Excel export ---------------- */

export function exportXlsx(filename: string, rows: Record<string, unknown>[], sheet = 'Data') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, filename);
  toast({ title: 'Export ready', body: filename, status: 'ok' });
}

/* ---------------- audit helper ---------------- */

export function auditLog(action: 'create' | 'update' | 'delete', collection: string, recordId: string, summary: string) {
  add('audit', {
    id: `aud-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    at: nowIsoEAT(11, 30),
    userId: 'usr-02', userName: 'Wanjiru Maina',
    action, collection, recordId, summary,
  });
}

/* ---------------- KV-backed UI state (local, non-server keys) ---------------- */

export function useLocalKV<T>(key: string, fallback: T): [T, (v: T) => void] {
  const raw = useKV(key as 'profile') as unknown as T | undefined;
  const val = (raw === undefined ? fallback : raw) as T;
  const set = (v: T) => kvSet(key as 'profile', v as never);
  return [val, set];
}

export function localKVGet<T>(key: string, fallback: T): T {
  const raw = kvGet(key as 'profile') as unknown as T | undefined;
  return raw === undefined ? fallback : raw;
}

/* ---------------- fleet derived metrics ---------------- */

export function woEstimate(wo: WorkOrder): number {
  return wo.items.reduce((s, it) => s + it.qty * it.unitCostKes, 0) + wo.laborCostKes;
}

export function isWoOverdue(wo: WorkOrder): boolean {
  return wo.status !== 'done' && wo.status !== 'cancelled' && !!wo.dueAt && demoDaysUntil(wo.dueAt) < 0;
}

export interface VehicleSignals {
  openWos: WorkOrder[];
  overdueSchedule: MaintenanceSchedule | null;
  nextServiceKmLeft: number | null;
  worstDocDays: number | null;
  activeDtc: DtcRow | null;
}

/** Deterministic vehicle health score (0–100) from live signals. */
export function vehicleHealth(v: Vehicle, sig: VehicleSignals): number {
  if (v.status === 'offline') return 42;
  let s = 96;
  s -= sig.openWos.length * 6;
  if (sig.openWos.some((w) => w.priority === 'high')) s -= 6;
  if (sig.overdueSchedule) s -= 12;
  if (sig.nextServiceKmLeft !== null && sig.nextServiceKmLeft < 1000) s -= 4;
  if (sig.worstDocDays !== null && sig.worstDocDays <= 30) s -= 8;
  else if (sig.worstDocDays !== null && sig.worstDocDays <= 90) s -= 3;
  if (sig.activeDtc) s -= 7;
  if (v.tripStatus === 'maintenance') s -= 18;
  // light deterministic spread so identical-signal vehicles differ
  s -= Math.floor(seededRange(v.id, 0, 5));
  return Math.max(35, Math.min(98, s));
}

/* ---------------- DTC log derivation ---------------- */

type ID = string;

export interface DtcRow {
  id: string;
  code: string;
  description: string;
  vehicleId: ID;
  severity: 'critical' | 'major' | 'minor';
  firstSeen: string;
  occurrences: number;
  status: 'active' | 'acknowledged' | 'cleared' | 'wo-open';
  woNumber?: string;
  action: string;
  clearedAt?: string;
}

const DTC_BOOK: Record<string, { desc: string; action: string; severity: DtcRow['severity'] }> = {
  P0401: { desc: 'EGR flow insufficient', action: 'Clean/inspect EGR valve & passages — safe to drive, fix within 14 d', severity: 'minor' },
  P0571: { desc: 'Brake switch A circuit', action: 'Inspect brake switch & wiring — safe to drive, fix within 7 d', severity: 'major' },
  P0420: { desc: 'Catalyst system efficiency below threshold', action: 'Monitor; check for exhaust leaks before catalyst replacement', severity: 'minor' },
  P0302: { desc: 'Cylinder 2 misfire detected', action: 'Inspect coil & plug on cylinder 2 — risk of catalyst damage, fix promptly', severity: 'major' },
  U0100: { desc: 'Lost communication with ECM/PCM', action: 'Check telematics harness & ECM power — vehicle offline until resolved', severity: 'critical' },
  P0128: { desc: 'Coolant thermostat below regulating temperature', action: 'Replace thermostat at next service — monitor coolant temp', severity: 'minor' },
};

/**
 * Builds the DTC log from store data (dtc alerts, dtc-sourced WOs, offline
 * vehicles) plus a small set of curated telematics entries the design doc
 * calls for (P0420 acknowledged, P0302 active, P0128 cleared).
 */
export function deriveDtcLog(vehicles: Vehicle[], alerts: AlertRec[], workOrders: WorkOrder[]): DtcRow[] {
  const rows: DtcRow[] = [];
  const seen = new Set<string>();
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  // 1. DTC-sourced work orders → WO OPEN
  for (const wo of workOrders.filter((w) => w.source === 'dtc')) {
    const m = wo.title.match(/([PU]\d{4})/);
    const code = m?.[1] ?? 'P0401';
    const book = DTC_BOOK[code] ?? DTC_BOOK.P0401;
    const key = `${wo.vehicleId}-${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: `dtc-${key}`, code, description: book.desc, vehicleId: wo.vehicleId,
      severity: book.severity, firstSeen: wo.openedAt, occurrences: 3 + (hashStr(key) % 5),
      status: wo.status === 'done' ? 'cleared' : 'wo-open', woNumber: wo.number, action: book.action,
      clearedAt: wo.status === 'done' ? wo.completedAt ?? undefined : undefined,
    });
  }

  // 2. DTC alerts without a WO → ACTIVE / ACKNOWLEDGED
  for (const al of alerts.filter((a) => a.type === 'dtc')) {
    const m = al.message.match(/([PU]\d{4})/);
    const code = m?.[1] ?? 'P0401';
    const key = `${al.entityRef.id}-${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const book = DTC_BOOK[code] ?? DTC_BOOK.P0401;
    rows.push({
      id: `dtc-${key}`, code, description: book.desc, vehicleId: al.entityRef.id,
      severity: book.severity, firstSeen: al.at, occurrences: 2 + (hashStr(key) % 6),
      status: al.acknowledged ? 'acknowledged' : 'active', action: book.action,
    });
  }

  // 3. Offline vehicles → U0100 lost comms (explains offline status)
  for (const v of vehicles.filter((x) => x.status === 'offline')) {
    const key = `${v.id}-U0100`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: `dtc-${key}`, code: 'U0100', description: DTC_BOOK.U0100.desc, vehicleId: v.id,
      severity: 'critical', firstSeen: isoDaysBack(2), occurrences: 1,
      status: 'active', action: DTC_BOOK.U0100.action,
    });
  }

  // 4. Curated telematics entries (design maintenance-schedules.md §2 seed list)
  const curated: Array<[string, string, DtcRow['status'], number, string?]> = [
    ['veh-13', 'P0420', 'acknowledged', 9],
    ['veh-14', 'P0302', 'active', 2],
    ['veh-02', 'P0128', 'cleared', 15, addDaysISO(-4)],
  ];
  for (const [vehicleId, code, status, daysAgo, clearedAt] of curated) {
    const key = `${vehicleId}-${code}`;
    if (seen.has(key) || !byId.has(vehicleId)) continue;
    seen.add(key);
    const book = DTC_BOOK[code];
    rows.push({
      id: `dtc-${key}`, code, description: book.desc, vehicleId,
      severity: book.severity, firstSeen: isoDaysBack(daysAgo), occurrences: 1 + (hashStr(key) % 7),
      status, action: book.action, clearedAt,
    });
  }

  return rows.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));
}

function isoDaysBack(days: number): string {
  return new Date(T0 - days * 86400000 + 6 * 3600000).toISOString();
}

/** Deterministic freeze-frame snapshot for a DTC row. */
export function freezeFrame(dtc: DtcRow) {
  const s = dtc.id;
  return {
    rpm: Math.round(seededRange(`${s}-rpm`, 900, 3200) / 10) * 10,
    speedKmh: Math.round(seededRange(`${s}-spd`, 0, 96)),
    coolantC: Math.round(seededRange(`${s}-clt`, 78, 104)),
    loadPct: Math.round(seededRange(`${s}-load`, 24, 88)),
    fuelTrimPct: Number(seededRange(`${s}-trim`, -6, 9).toFixed(1)),
    batteryV: Number(seededRange(`${s}-bat`, 11.8, 14.4).toFixed(1)),
  };
}

/* ---------------- schedule helpers ---------------- */

export type ScheduleDue =
  | { kind: 'km'; remainingKm: number; dueKm: number }
  | { kind: 'days'; remainingDays: number; dueAt: string };

function dueScore(d: ScheduleDue): number {
  return d.kind === 'km' ? d.remainingKm / 65 : d.remainingDays;
}

/** Earliest due point across the schedule's triggers. */
export function scheduleDue(s: MaintenanceSchedule, v: Vehicle | undefined): ScheduleDue | null {
  const cands: ScheduleDue[] = [];
  if (s.nextDueKm && v) cands.push({ kind: 'km', remainingKm: s.nextDueKm - v.odometerKm, dueKm: s.nextDueKm });
  if (s.nextDueAt) cands.push({ kind: 'days', remainingDays: demoDaysUntil(s.nextDueAt), dueAt: s.nextDueAt });
  if (cands.length === 0) return null;
  // normalize: km remaining ~ 65 km/day equivalent to compare across triggers
  cands.sort((a, b) => dueScore(a) - dueScore(b));
  return cands[0];
}

export function scheduleStatus(d: ScheduleDue | null): { key: StatusKey; label: 'overdue' | 'due-now' | 'due-soon' | 'on-track' } {
  if (!d) return { key: 'inactive', label: 'on-track' };
  const over = d.kind === 'km' ? d.remainingKm < 0 : d.remainingDays < 0;
  if (over) return { key: 'alert', label: 'overdue' };
  const soon = d.kind === 'km' ? d.remainingKm <= 500 : d.remainingDays <= 3;
  if (soon) return { key: 'alert', label: 'due-now' };
  const near = d.kind === 'km' ? d.remainingKm <= 1000 : d.remainingDays <= 7;
  if (near) return { key: 'warn', label: 'due-soon' };
  return { key: 'ok', label: 'on-track' };
}

/* ---------------- part helpers ---------------- */

export function partStatus(p: Part): { key: StatusKey; label: 'OK' | 'LOW' | 'OUT' } {
  if (p.qty <= 0) return { key: 'alert', label: 'OUT' };
  if (p.qty <= p.reorderLevel) return { key: 'warn', label: 'LOW' };
  return { key: 'ok', label: 'OK' };
}

export function partCategory(p: Part): string {
  const pre = p.sku.split('-')[0];
  const map: Record<string, string> = {
    FLT: 'Filters', BRK: 'Brakes', TYR: 'Tyres', BAT: 'Electrical', BLB: 'Electrical',
    OIL: 'Fluids', WPR: 'Body', BLT: 'Engine',
  };
  return map[pre] ?? 'General';
}

/* ---------------- vendor / driver lookups ---------------- */

export function vendorStats(vendorId: string, workOrders: WorkOrder[]) {
  const wos = workOrders.filter((w) => w.vendorId === vendorId);
  const spend = wos.reduce((s, w) => s + woEstimate(w), 0);
  return {
    wos,
    count: wos.length,
    spend,
    turnaroundDays: Number(seededRange(vendorId, 0.8, 3.2).toFixed(1)),
  };
}

export function driverById(drivers: Driver[], id: string | null): Driver | undefined {
  return drivers.find((d) => d.id === id);
}

export function vendorById(vendors: Vendor[], id: string | null): Vendor | undefined {
  return vendors.find((v) => v.id === id);
}

/* ---------------- per-vehicle signal map (reactive) ---------------- */

export interface FleetSignals {
  dtcs: DtcRow[];
  byVehicle: Map<string, VehicleSignals>;
  health: Map<string, number>;
}

/** Combines store collections into per-vehicle maintenance/compliance signals. */
export function useFleetSignals(): FleetSignals {
  const vehicles = useCollection('vehicles');
  const workOrders = useCollection('workOrders');
  const schedules = useCollection('schedules');
  const documents = useCollection('documents');
  const alerts = useCollection('alerts');
  const [dtcState] = useLocalKV<Record<string, DtcRow['status']>>('dtcState', {});

  return useMemo(() => {
    const dtcs = deriveDtcLog(vehicles, alerts, workOrders).map((d) => ({
      ...d,
      status: dtcState[d.id] ?? d.status,
    }));
    const byVehicle = new Map<string, VehicleSignals>();
    const health = new Map<string, number>();
    for (const v of vehicles) {
      const openWos = workOrders.filter((w) => w.vehicleId === v.id && w.status !== 'done' && w.status !== 'cancelled');
      const vScheds = schedules.filter((s) => s.vehicleId === v.id);
      let overdueSchedule: MaintenanceSchedule | null = null;
      let nextServiceKmLeft: number | null = null;
      for (const s of vScheds) {
        const d = scheduleDue(s, v);
        const st = scheduleStatus(d);
        if (st.label === 'overdue' && !overdueSchedule) overdueSchedule = s;
        if (d?.kind === 'km') nextServiceKmLeft = nextServiceKmLeft === null ? d.remainingKm : Math.min(nextServiceKmLeft, d.remainingKm);
      }
      const vDocs = documents.filter((doc) => doc.entityType === 'vehicle' && doc.entityId === v.id);
      const worstDocDays = vDocs.length ? Math.min(...vDocs.map((doc) => demoDaysUntil(doc.expiresAt))) : null;
      const activeDtc = dtcs.find((d) => d.vehicleId === v.id && (d.status === 'active' || d.status === 'wo-open')) ?? null;
      const sig: VehicleSignals = { openWos, overdueSchedule, nextServiceKmLeft, worstDocDays, activeDtc };
      byVehicle.set(v.id, sig);
      health.set(v.id, vehicleHealth(v, sig));
    }
    return { dtcs, byVehicle, health };
  }, [vehicles, workOrders, schedules, documents, alerts, dtcState]);
}

/* ---------------- cost / TCO helpers ---------------- */

import type { FuelLog, Trip } from '@/lib/types';

/** July 2026 month-to-date = demo days 0..27 back from TODAY (28 Jul). */
export function isMtd(iso: string): boolean {
  const d = demoDaysAgo(iso);
  return d >= 0 && d <= 27;
}

export interface MtdCosts {
  fuelKes: number;
  maintKes: number;
  km: number;
  /** variable cost/km (fuel + maintenance) or null when no km logged */
  costPerKm: number | null;
}

export function mtdCosts(vehicleId: string, fuelLogs: FuelLog[], workOrders: WorkOrder[], trips: Trip[]): MtdCosts {
  const fuelKes = fuelLogs.filter((f) => f.vehicleId === vehicleId && isMtd(f.at)).reduce((s, f) => s + f.totalKes, 0);
  const maintKes = workOrders
    .filter((w) => w.vehicleId === vehicleId && w.completedAt && isMtd(w.completedAt))
    .reduce((s, w) => s + woEstimate(w), 0);
  const km = trips.filter((t) => t.vehicleId === vehicleId && isMtd(t.startAt)).reduce((s, t) => s + t.distanceKm, 0);
  const costPerKm = km > 0 ? (fuelKes + maintKes) / km : null;
  return { fuelKes, maintKes, km, costPerKm };
}

export interface TcoBreakdown {
  purchaseKes: number;
  depreciationKes: number;
  fuelKes: number;
  maintenanceKes: number;
  insuranceKes: number;
  tcoKes: number;
  costPerKmLifetime: number | null;
  yearsOwned: number;
  depPct: number;
}

/** Fleetio-grade lifetime TCO: 8-year straight-line depreciation + lifetime
 *  fuel/maintenance scaled from the 60-day history by lifetime km, insurance
 *  at 4.5% of purchase value per year (Kenyan comprehensive norm). */
export function tcoBreakdown(v: Vehicle, fuelLogs: FuelLog[], workOrders: WorkOrder[], trips: Trip[]): TcoBreakdown {
  const yearsOwned = Math.max(0.2, demoDaysAgo(v.createdAt) / 365);
  const depPct = Math.min(1, yearsOwned / 8);
  const depreciationKes = Math.round(v.purchaseCostKes * depPct);
  const km60 = Math.max(1, trips.filter((t) => t.vehicleId === v.id).reduce((s, t) => s + t.distanceKm, 0));
  const scale = v.odometerKm / km60;
  const fuel60 = fuelLogs.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.totalKes, 0);
  const fuelKes = Math.round(fuel60 * scale);
  const maintWO = workOrders.filter((w) => w.vehicleId === v.id).reduce((s, w) => s + woEstimate(w), 0);
  const maintenanceKes = Math.round(maintWO * Math.max(1, scale * 0.6));
  const insuranceKes = Math.round(v.purchaseCostKes * 0.045 * yearsOwned);
  const tcoKes = depreciationKes + fuelKes + maintenanceKes + insuranceKes;
  const costPerKmLifetime = v.odometerKm > 0 ? tcoKes / v.odometerKm : null;
  return { purchaseKes: v.purchaseCostKes, depreciationKes, fuelKes, maintenanceKes, insuranceKes, tcoKes, costPerKmLifetime, yearsOwned, depPct };
}
