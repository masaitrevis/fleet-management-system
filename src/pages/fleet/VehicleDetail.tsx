// FBV FleetOS — /vehicles/:id Vehicle 360° (design/vehicle-detail.md).
// Header band + tabs: Overview · Service History · Costs & TCO · Documents · Trips.

import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowLeft, BadgeCheck, Bus, CalendarClock, Car, CarFront,
  ChevronDown, CircleDot, Clock, Download, FileText, FileUp, Fuel, Gauge,
  KeyRound, MapPin, MoreHorizontal, Route, Sparkles, TrendingUp, Truck,
  UserPlus, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ConfirmDialog, DataTable, DonutChartCard, EmptyState, LineChartCard, Modal,
  PlateTag, ScoreRing, Sparkline, StatusPill, Tabs, toast, BarChartCard,
} from '@/components/shared';
import { SourceBadge } from '@/components/SourceBadge';
import type { Column } from '@/components/shared';
import {
  getById, update, useCollection, useLivePositions,
} from '@/lib/store';
import { corridorById } from '@/lib/telematics';
import {
  expiryKey, fmtDateEAT, fmtDateTimeEAT, fmtKES, fmtKm, fmtNum, fmtTimeEAT,
} from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type {
  DocumentRec, FuelLog, Inspection, SafetyEvent, Trip, Vehicle, VehicleType, WorkOrder,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { TODAY } from '@/lib/seed';
import {
  SectionCard, auditLog, demoDaysAgo, demoDaysUntil,
  driverById, exportXlsx, hashStr, isMtd, mtdCosts, scheduleDue,
  seededRange, tcoBreakdown, useFleetSignals, vendorById, woEstimate,
} from './lib';
import { vehiclePill } from './Vehicles';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const TYPE_ICON: Record<VehicleType, LucideIcon> = {
  truck: Truck, van: CarFront, pickup: Truck, car: Car, bus: Bus,
};

/* ---------------- 12-month economics series ---------------- */

interface MonthPoint {
  label: string;
  fuel: number;
  maint: number;
  dep: number;
  ins: number;
  km: number;
  costKm: number | null;
  spike: boolean;
}

const MONTH_LABELS = (() => {
  const out: string[] = [];
  const base = new Date(`${TODAY}T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    out.push(d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }));
  }
  return out;
})();

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function buildYearSeries(v: Vehicle, fuelLogs: FuelLog[], wos: WorkOrder[], trips: Trip[]): MonthPoint[] {
  const base = new Date(`${TODAY}T00:00:00Z`);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const dep = v.purchaseCostKes / 96; // 8y straight-line monthly
  const ins = v.purchaseCostKes * 0.045 / 12;

  const realFuel = new Map<string, number>();
  for (const f of fuelLogs.filter((x) => x.vehicleId === v.id)) {
    realFuel.set(monthKey(f.at), (realFuel.get(monthKey(f.at)) ?? 0) + f.totalKes);
  }
  const realMaint = new Map<string, number>();
  for (const w of wos.filter((x) => x.vehicleId === v.id && x.completedAt)) {
    realMaint.set(monthKey(w.completedAt!), (realMaint.get(monthKey(w.completedAt!)) ?? 0) + woEstimate(w));
  }
  const realKm = new Map<string, number>();
  for (const t of trips.filter((x) => x.vehicleId === v.id)) {
    realKm.set(monthKey(t.startAt), (realKm.get(monthKey(t.startAt)) ?? 0) + t.distanceKm);
  }

  // averages from the observed window, used to backfill earlier months deterministically
  const observed = months.filter((m) => realKm.has(m));
  const avgFuel = observed.length ? observed.reduce((s, m) => s + (realFuel.get(m) ?? 0), 0) / observed.length : v.purchaseCostKes * 0.01;
  const avgKm = observed.length ? observed.reduce((s, m) => s + (realKm.get(m) ?? 0), 0) / observed.length : 3200;
  const avgMaint = Math.max(8000, observed.reduce((s, m) => s + (realMaint.get(m) ?? 0), 0) / Math.max(1, observed.length));

  return months.map((m, i) => {
    const has = realKm.has(m);
    const seed = `${v.id}-${m}`;
    const fuel = has ? (realFuel.get(m) ?? 0) : Math.round(avgFuel * seededRange(`${seed}-f`, 0.82, 1.22));
    const km = has ? (realKm.get(m) ?? 0) : Math.round(avgKm * seededRange(`${seed}-k`, 0.85, 1.2));
    const spike = hashStr(seed) % 4 === 0;
    const maint = has
      ? (realMaint.get(m) ?? Math.round(avgMaint * 0.2))
      : Math.round(avgMaint * seededRange(`${seed}-m`, 0.1, 0.6)) + (spike ? Math.round(avgMaint * seededRange(`${seed}-sp`, 1.6, 3.2)) : 0);
    const costKm = km > 0 ? (fuel + maint) / km : null;
    return { label: MONTH_LABELS[i], fuel, maint, dep: Math.round(dep), ins: Math.round(ins), km, costKm, spike: maint > avgMaint * 1.5 };
  });
}

/* ---------------- expiry ring (documents tab) ---------------- */

export function ExpiryRing({ days, size = 56 }: { days: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const key = expiryKey(days);
  const color = { ok: '#16A34A', warn: '#F59E0B', alert: '#DC2626', inactive: '#64748B', info: '#2563EB' }[key];
  const frac = Math.max(0, Math.min(1, days / 90));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDF1F6" strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - frac) }}
          transition={{ duration: 0.7, ease: 'easeOut' }} />
      </svg>
      <span className="absolute text-center font-mono font-bold leading-none text-ink-900" style={{ fontSize: size * 0.24 }}>
        {days}
        <span className="block text-[8px] font-medium text-ink-400">days</span>
      </span>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function VehicleDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const v = getById('vehicles', id);
  const drivers = useCollection('drivers');
  const vendors = useCollection('vendors');
  const workOrders = useCollection('workOrders');
  const schedules = useCollection('schedules');
  const documents = useCollection('documents');
  const fuelLogs = useCollection('fuelLogs');
  const trips = useCollection('trips');
  const inspections = useCollection('inspections');
  const safetyEvents = useCollection('safetyEvents');
  const geofences = useCollection('geofences');
  const live = useLivePositions();
  const livePos = live.find((p) => p.vehicleId === id);
  const { byVehicle, health } = useFleetSignals();

  const [tab, setTab] = useState('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [decomOpen, setDecomOpen] = useState(false);

  const sig = byVehicle.get(id);
  const score = health.get(id) ?? 80;
  const mtd = useMemo(() => mtdCosts(id, fuelLogs, workOrders, trips), [id, fuelLogs, workOrders, trips]);
  const vDocs = useMemo(() => documents.filter((d) => d.entityType === 'vehicle' && d.entityId === id), [documents, id]);
  const vWos = useMemo(() => workOrders.filter((w) => w.vehicleId === id), [workOrders, id]);
  const vTrips = useMemo(() => trips.filter((t) => t.vehicleId === id), [trips, id]);
  const vSchedules = useMemo(() => schedules.filter((s) => s.vehicleId === id), [schedules, id]);

  if (!v) {
    return (
      <div className="mx-auto max-w-[1520px] p-6">
        <EmptyState icon={Truck} title="Vehicle not found"
          hint={`No vehicle with id ${id} in the registry.`}
          ctaLabel="Back to vehicles" onCta={() => navigate('/vehicles')} />
      </div>
    );
  }

  const pill = vehiclePill(v, livePos);
  const Icon = TYPE_ICON[v.type];
  const driver = driverById(drivers, v.assignedDriverId);
  const openWos = vWos.filter((w) => w.status !== 'done' && w.status !== 'cancelled');
  const litres60 = fuelLogs.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.litres, 0);
  const km60 = vTrips.reduce((s, t) => s + t.distanceKm, 0);
  const avgKml = litres60 > 0 ? km60 / litres60 : null;

  const stats: { label: string; value: string }[] = [
    { label: 'Odometer', value: fmtKm(v.odometerKm) },
    { label: 'Engine hrs', value: `${fmtNum(v.engineHours)} h` },
    { label: 'Fuel', value: `${v.fuelLevelPct}% / ${Math.round(v.tankCapacityL * v.fuelLevelPct / 100)} L` },
    { label: 'Avg consumption', value: avgKml ? `${avgKml.toFixed(1)} km/L` : '—' },
    { label: 'Cost/km Jul', value: mtd.costPerKm !== null ? `KES ${mtd.costPerKm.toFixed(2)}` : '—' },
    { label: 'Open WOs', value: String(openWos.length) },
  ];

  const locationText = (() => {
    if (livePos) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const g of geofences) {
        if (!g.center) continue;
        const d = Math.hypot(g.center.lat - livePos.lat, g.center.lng - livePos.lng);
        if (d < bestD) { bestD = d; best = g.name; }
      }
      if (best && bestD < 0.02) return `at ${best}`;
      if (best) return `near ${best}`;
      return corridorById(v.simRoute).name;
    }
    return corridorById(v.simRoute).name;
  })();

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="mx-auto flex max-w-[1520px] flex-col gap-5 p-6">
      {/* breadcrumb */}
      <Link to="/vehicles" className="flex w-fit items-center gap-1.5 text-[12px] font-semibold text-ink-400 hover:text-accent-strong">
        <ArrowLeft size={14} /> Vehicles
      </Link>

      {/* header band */}
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}
        className="flex flex-wrap items-center gap-6 rounded-drawer border border-border bg-white p-6 shadow-card">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-navy-900 text-accent-on-navy">
            <Icon size={32} strokeWidth={1.7} />
          </span>
          <div>
            <div className="flex items-center gap-3">
              <PlateTag plate={v.plate} className="px-2.5 py-1 text-[20px]" />
              <StatusPill status={pill.key} label={pill.label} pulse={pill.label === 'MOVING'} />
              <SourceBadge source={livePos?.source} />
              {livePos && (
                <span className={cn('flex items-center gap-1 text-micro font-semibold', livePos.ignition ? 'text-ok-on-soft' : 'text-ink-400')}>
                  <KeyRound size={12} /> {livePos.ignition ? 'IGN ON' : 'IGN OFF'}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[14px] font-semibold text-ink-900">
              {v.model} · {v.year} · {v.fuelType === 'diesel' ? 'Diesel' : 'Petrol'}
            </div>
            <div className="text-micro text-ink-400">
              {v.depot}{driver ? ` · ${driver.name}` : ' · Unassigned'}
              {v.deviceImei && (
                <span className="ml-2 font-mono text-ink-600">IMEI {v.deviceImei}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={score} size={96} stroke={9} />
          <span className="text-micro font-medium uppercase tracking-[0.06em] text-ink-400">Vehicle health</span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-micro uppercase tracking-[0.06em] text-ink-400">{s.label}</div>
              <div className="font-mono text-[13px] font-semibold text-ink-900">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link to="/" className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <MapPin size={15} /> Locate on map
          </Link>
          <Link to="/tracking" className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Route size={15} /> Replay today
          </Link>
          <Link to="/maintenance" className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
            <Wrench size={15} /> Work order
          </Link>
          <Link to="/documents" className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <FileUp size={15} /> Upload document
          </Link>
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-ink-600 hover:bg-surface-muted">
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-30 min-w-[180px] rounded-lg border border-border bg-white py-1 shadow-pop" onMouseLeave={() => setMenuOpen(false)}>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-muted"
                  onClick={() => { setMenuOpen(false); toast({ title: 'Edit vehicle', body: 'Registry edit opens from the vehicles table.', status: 'info' }); }}>
                  <Gauge size={14} /> Edit details
                </button>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-muted"
                  onClick={() => { setMenuOpen(false); navigate('/vehicles'); toast({ title: 'Assign driver', body: 'Use Assign driver on the vehicle card.', status: 'info' }); }}>
                  <UserPlus size={14} /> Assign driver
                </button>
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-alert hover:bg-surface-muted"
                  onClick={() => { setMenuOpen(false); setDecomOpen(true); }}>
                  <AlertTriangle size={14} /> Decommission
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {/* tabs */}
      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'history', label: 'Service History', count: vWos.length },
          { key: 'tco', label: 'Costs & TCO' },
          { key: 'documents', label: 'Documents', count: vDocs.length },
          { key: 'trips', label: 'Trips', count: vTrips.length },
        ]}
        active={tab} onChange={setTab}
      />

      {tab === 'overview' && (
        <OverviewTab v={v} livePos={livePos} locationText={locationText}
          sig={sig} schedules={vSchedules} docs={vDocs}
          trips={vTrips} fuelLogs={fuelLogs.filter((f) => f.vehicleId === v.id)}
          inspections={inspections.filter((i) => i.vehicleId === v.id)}
          safetyEvents={safetyEvents.filter((s) => s.vehicleId === v.id)} />
      )}
      {tab === 'history' && (
        <HistoryTab v={v} wos={vWos} inspections={inspections.filter((i) => i.vehicleId === v.id)} vendors={vendors} />
      )}
      {tab === 'tco' && <TcoTab v={v} fuelLogs={fuelLogs} wos={vWos} trips={vTrips} health={score} />}
      {tab === 'documents' && <DocsTab v={v} docs={vDocs} />}
      {tab === 'trips' && <TripsTab v={v} trips={vTrips} drivers={drivers} />}

      <ConfirmDialog open={decomOpen} onClose={() => setDecomOpen(false)} destructive typedConfirmation="RETIRE"
        title={`Decommission ${v.plate}?`} confirmLabel="Decommission"
        body="The vehicle is marked inactive, unassigned from its driver and excluded from dispatch. History and TCO records are retained."
        onConfirm={() => {
          update('vehicles', v.id, { tripStatus: 'inactive', assignedDriverId: null });
          auditLog('update', 'vehicles', v.id, `Decommissioned ${v.plate}`);
          toast({ title: 'Vehicle decommissioned', body: `${v.plate} marked inactive`, status: 'warn' });
        }} />
    </motion.div>
  );
}

/* ================================================================== */
/* TAB 1 — Overview                                                    */
/* ================================================================== */

function OverviewTab({ v, livePos, locationText, sig, schedules, docs, trips, fuelLogs, inspections, safetyEvents }: {
  v: Vehicle;
  livePos?: { lat: number; lng: number; speedKmh: number; ignition: boolean; at: number };
  locationText: string;
  sig: ReturnType<typeof useFleetSignals>['byVehicle'] extends Map<string, infer S> ? S | undefined : never;
  schedules: import('@/lib/types').MaintenanceSchedule[];
  docs: DocumentRec[];
  trips: Trip[];
  fuelLogs: FuelLog[];
  inspections: Inspection[];
  safetyEvents: SafetyEvent[];
}) {
  const feed = useMemo(() => {
    const items: { at: string; icon: LucideIcon; text: string; tone: StatusKey }[] = [];
    for (const t of trips.slice(0, 6)) {
      items.push({ at: t.endAt, icon: Route, text: `Trip ended — ${t.from} → ${t.to} · ${fmtNum(t.distanceKm)} km`, tone: 'inactive' });
    }
    for (const f of fuelLogs.slice(0, 4)) {
      items.push({ at: f.at, icon: Fuel, text: `Fueled ${fmtNum(f.litres, 0)} L @ ${f.station} · ${fmtKES(f.totalKes)}`, tone: 'info' });
    }
    for (const i of inspections.slice(0, 3)) {
      items.push({
        at: i.at, icon: BadgeCheck,
        text: `DVIR ${i.kind} ${i.result.toUpperCase()}${i.defectsCount ? ` — ${i.defectsCount} defect${i.defectsCount > 1 ? 's' : ''}` : ''}`,
        tone: i.result === 'pass' ? 'ok' : 'alert',
      });
    }
    for (const s of safetyEvents.slice(0, 3)) {
      items.push({
        at: s.at, icon: AlertTriangle,
        text: `${s.type.replace(/_/g, ' ')} event (${s.severity}) — ${s.location}`,
        tone: s.severity === 'critical' ? 'alert' : 'warn',
      });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  }, [trips, fuelLogs, inspections, safetyEvents]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* live status */}
      <SectionCard title="Live status" pad={false} className="overflow-hidden">
        <div className="relative h-[200px] bg-navy-900">
          {/* stylized dark mini-map */}
          <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden>
            <defs>
              <pattern id={`grid-${v.id}`} width="36" height="36" patternUnits="userSpaceOnUse">
                <path d="M 36 0 L 0 0 0 36" fill="none" stroke="#1A3A5C" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#grid-${v.id})`} />
            <path d="M-20,140 C80,120 160,90 320,70 S520,40 620,30" fill="none" stroke="#1A3A5C" strokeWidth="5" strokeLinecap="round" />
            <path d="M40,220 C120,180 200,150 340,130" fill="none" stroke="#1A3A5C" strokeWidth="3" />
          </svg>
          <span className="absolute left-[58%] top-[38%] flex h-4 w-4">
            {pillPing(v) && <span className="absolute h-full w-full rounded-full bg-accent-on-navy animate-pulse-live-ring" />}
            <span className={cn('relative h-4 w-4 rounded-full border-2 border-white shadow-pop', v.status === 'offline' ? 'bg-alert' : 'bg-accent')} />
          </span>
          <span className="absolute left-[52%] top-[52%] rounded-md bg-navy-950/80 px-2 py-1 font-mono text-[10px] font-semibold text-white">
            {livePos ? `${livePos.lat.toFixed(4)}, ${livePos.lng.toFixed(4)}` : `${v.homeLat.toFixed(4)}, ${v.homeLng.toFixed(4)}`}
          </span>
          <span className="absolute right-3 top-3 rounded-full bg-navy-950/80 px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.06em] text-accent-on-navy">
            TELEMATICS SIM
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <StatusChip label={`${Math.round(livePos?.speedKmh ?? 0)} km/h`} />
          <StatusChip label={livePos?.ignition ? 'IGNITION ON' : 'IGNITION OFF'} tone={livePos?.ignition ? 'ok' : 'inactive'} />
          <StatusChip label={locationText} />
          <StatusChip label={livePos ? `updated ${fmtTimeEAT(new Date(livePos.at).toISOString())} EAT` : 'no live fix'} mono />
        </div>
      </SectionCard>

      {/* active issues */}
      <SectionCard title="Active issues">
        <div className="flex flex-col gap-3">
          {sig?.activeDtc && (
            <Link to="/maintenance/schedules"
              className="flex items-start gap-3 rounded-lg border border-alert/30 bg-alert-soft px-3 py-2.5 transition-colors hover:bg-alert-soft/70">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-alert" />
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-alert-on-soft">
                  DTC {sig.activeDtc.code} — {sig.activeDtc.description}
                </div>
                <div className="text-micro text-alert-on-soft/80">
                  {sig.activeDtc.woNumber ? `Work order ${sig.activeDtc.woNumber} open` : 'No work order yet — open one from Schedules & DTC'}
                </div>
              </div>
            </Link>
          )}
          {schedules.map((s) => {
            const due = scheduleDue(s, v);
            if (!due) return null;
            const over = due.kind === 'km' ? due.remainingKm < 0 : due.remainingDays < 0;
            const pct = due.kind === 'km' && s.intervalKm
              ? Math.min(100, Math.max(0, ((s.intervalKm - due.remainingKm) / s.intervalKm) * 100))
              : over ? 100 : 70;
            return (
              <div key={s.id} className={cn('rounded-lg border px-3 py-2.5', over ? 'border-alert/30 bg-alert-soft' : 'border-warn/30 bg-warn-soft')}>
                <div className="flex items-center justify-between text-[13px] font-semibold">
                  <span className={over ? 'text-alert-on-soft' : 'text-warn-on-soft'}>{s.name}</span>
                  <span className={cn('font-mono text-micro', over ? 'text-alert-on-soft' : 'text-warn-on-soft')}>
                    {due.kind === 'km'
                      ? over ? `OVERDUE ${fmtNum(-due.remainingKm)} km` : `due in ${fmtNum(due.remainingKm)} km`
                      : over ? 'OVERDUE' : `due ${fmtDateEAT(due.dueAt)}`}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: EASE }}
                    className={cn('h-full rounded-full', over ? 'bg-alert' : 'bg-warn')} />
                </div>
              </div>
            );
          })}
          {docs.filter((d) => demoDaysUntil(d.expiresAt) <= 90).map((d) => (
            <Link key={d.id} to="/documents"
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 hover:bg-surface-muted">
              <span className="flex items-center gap-2 text-[13px] font-medium text-ink-900">
                <FileText size={14} className="text-ink-400" /> {d.docType} expires {fmtDateEAT(d.expiresAt)}
              </span>
              <StatusPill status={expiryKey(demoDaysUntil(d.expiresAt))} label={`${demoDaysUntil(d.expiresAt)} d`} />
            </Link>
          ))}
          {!sig?.activeDtc && schedules.length === 0 && docs.every((d) => demoDaysUntil(d.expiresAt) > 90) && (
            <div className="flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2.5 text-[13px] font-medium text-ok-on-soft">
              <BadgeCheck size={15} /> No active issues — service, documents and fault codes all clear.
            </div>
          )}
        </div>
      </SectionCard>

      {/* upcoming maintenance */}
      <SectionCard title="Upcoming maintenance"
        right={<Link to="/maintenance/schedules" className="text-[12px] font-semibold text-accent-strong hover:underline">All schedules →</Link>}>
        <div className="flex flex-col gap-2">
          {schedules.length === 0 && <p className="text-[13px] text-ink-400">No preventive schedules configured for this vehicle.</p>}
          {schedules.map((s) => {
            const due = scheduleDue(s, v);
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
                  {s.type === 'calendar' ? <CalendarClock size={16} /> : <Wrench size={16} />}
                </span>
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-ink-900">{s.name}</div>
                  <div className="font-mono text-micro text-ink-400">
                    last {fmtDateEAT(s.lastDoneAt)} · {fmtKm(s.lastDoneKm)}
                  </div>
                </div>
                {due && (
                  <span className={cn('font-mono text-[12px] font-semibold',
                    (due.kind === 'km' ? due.remainingKm : due.remainingDays) < 0 ? 'text-alert-on-soft' : 'text-ink-600')}>
                    {due.kind === 'km' ? `${fmtNum(due.remainingKm)} km left` : `${due.remainingDays} d left`}
                  </span>
                )}
                <Link to="/maintenance"
                  className="rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-semibold text-ink-600 hover:border-accent hover:text-accent-strong">
                  Create WO
                </Link>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* recent activity */}
      <SectionCard title="Recent activity">
        <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
          {feed.map((f, i) => (
            <motion.li key={`${f.at}-${i}`} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06, ease: EASE }} className="relative flex items-start gap-3">
              <span className={cn('absolute -left-[21px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white',
                f.tone === 'ok' ? 'bg-ok' : f.tone === 'warn' ? 'bg-warn' : f.tone === 'alert' ? 'bg-alert' : f.tone === 'info' ? 'bg-info' : 'bg-inactive')} />
              <f.icon size={14} className="mt-0.5 shrink-0 text-ink-400" />
              <span className="flex-1 text-[13px] leading-5 text-ink-900">{f.text}</span>
              <span className="shrink-0 font-mono text-micro text-ink-400">{fmtDateTimeEAT(f.at)}</span>
            </motion.li>
          ))}
        </ol>
      </SectionCard>
    </div>
  );
}

function pillPing(v: Vehicle): boolean {
  return v.status !== 'offline';
}

function StatusChip({ label, tone, mono }: { label: string; tone?: StatusKey; mono?: boolean }) {
  return (
    <span className={cn('rounded-full px-2 py-1 text-micro font-semibold',
      mono && 'font-mono',
      tone === 'ok' ? 'bg-ok-soft text-ok-on-soft' : tone === 'inactive' ? 'bg-inactive-soft text-inactive-on-soft' : 'bg-surface-muted text-ink-600')}>
      {label}
    </span>
  );
}

/* ================================================================== */
/* TAB 2 — Service History                                             */
/* ================================================================== */

interface HistoryEntry {
  id: string;
  at: string;
  kind: 'scheduled' | 'repair' | 'inspection' | 'dvir';
  title: string;
  vendor?: string;
  woNumber?: string;
  cost?: number;
  odoKm?: number;
  items?: { description: string; qty: number; unitCostKes: number }[];
  labor?: number;
}

const KIND_META: Record<HistoryEntry['kind'], { label: string; icon: LucideIcon; cls: string }> = {
  scheduled: { label: 'Scheduled', icon: Wrench, cls: 'bg-navy-900 text-white' },
  repair: { label: 'Repair', icon: AlertTriangle, cls: 'bg-warn text-navy-950' },
  inspection: { label: 'Inspection', icon: BadgeCheck, cls: 'bg-ok text-white' },
  dvir: { label: 'DVIR defect', icon: FileText, cls: 'bg-accent text-navy-950' },
};

function HistoryTab({ v, wos, inspections, vendors }: {
  v: Vehicle; wos: WorkOrder[]; inspections: Inspection[]; vendors: import('@/lib/types').Vendor[];
}) {
  const [filter, setFilter] = useState<'all' | HistoryEntry['kind']>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const entries = useMemo<HistoryEntry[]>(() => {
    const out: HistoryEntry[] = [];
    for (const w of wos) {
      out.push({
        id: w.id, at: w.completedAt ?? w.openedAt,
        kind: w.source === 'schedule' ? 'scheduled' : w.source === 'dvir' ? 'dvir' : 'repair',
        title: w.title, vendor: vendorById(vendors, w.vendorId)?.name,
        woNumber: w.number, cost: woEstimate(w), items: w.items, labor: w.laborCostKes,
        odoKm: Math.max(0, v.odometerKm - demoDaysAgo(w.completedAt ?? w.openedAt) * 180),
      });
    }
    for (const i of inspections) {
      out.push({
        id: i.id, at: i.at,
        kind: i.result === 'fail' ? 'dvir' : 'inspection',
        title: `DVIR ${i.kind} — ${i.result.toUpperCase()}${i.defectsCount ? ` (${i.defectsCount} defect${i.defectsCount > 1 ? 's' : ''})` : ''}`,
        odoKm: i.odometerKm,
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [wos, inspections, vendors, v.odometerKm]);

  const shown = entries.filter((e) => filter === 'all' || e.kind === filter);
  const svcWos = wos.filter((w) => w.status === 'done');
  const spend12 = svcWos.reduce((s, w) => s + woEstimate(w), 0);
  const avgInterval = svcWos.length > 1 ? Math.round(v.odometerKm / svcWos.length / 100) * 100 : null;

  return (
    <div className="flex flex-col gap-4">
      {/* summary strip */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-card border border-border bg-white px-5 py-3 shadow-card">
        <span className="text-[13px] text-ink-600">Services 12 mo: <b className="font-mono text-ink-900">{svcWos.length}</b></span>
        <span className="text-[13px] text-ink-600">Spend <b className="font-mono text-ink-900">{fmtKES(spend12)}</b></span>
        <span className="text-[13px] text-ink-600">Avg interval <b className="font-mono text-ink-900">{avgInterval ? fmtKm(avgInterval) : '—'}</b></span>
        <span className="ml-auto flex items-center gap-2">
          {(['all', 'scheduled', 'repair', 'inspection', 'dvir'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={cn('h-7 rounded-full border px-2.5 text-[11px] font-semibold',
                filter === f ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
              {f === 'all' ? 'All' : KIND_META[f].label + (f === 'repair' ? 's' : f === 'inspection' ? 's' : f === 'dvir' ? 's' : '')}
            </button>
          ))}
          <button type="button"
            onClick={() => exportXlsx(`${v.plate.replace(' ', '-')}-service-history.xlsx`, shown.map((e) => ({
              Date: fmtDateEAT(e.at), Type: KIND_META[e.kind].label, Title: e.title,
              Vendor: e.vendor ?? '', WO: e.woNumber ?? '', 'Cost (KES)': e.cost ?? '', 'Odometer (km)': e.odoKm ?? '',
            })), 'Service history')}
            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={12} /> Excel
          </button>
        </span>
      </div>

      {/* timeline */}
      <ol className="relative ml-3 flex flex-col gap-4 border-l-2 border-border pl-6">
        {shown.map((e, i) => {
          const meta = KIND_META[e.kind];
          const d = new Date(e.at);
          return (
            <motion.li key={e.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i, 8) * 0.06, ease: EASE }}
              className="relative">
              <span className={cn('absolute -left-[39px] top-3 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white shadow-card', meta.cls)}>
                <meta.icon size={13} />
              </span>
              <div className="rounded-card border border-border bg-white shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-pop">
                <button type="button" onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1">
                    <span className="font-mono text-[15px] font-bold leading-4 text-ink-900">{String(d.getUTCDate()).padStart(2, '0')}</span>
                    <span className="font-mono text-[9px] font-semibold uppercase text-ink-400">
                      {d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink-900">{e.title}</span>
                    <span className="block text-micro text-ink-400">
                      {meta.label}{e.vendor ? ` · ${e.vendor}` : ''}{e.odoKm ? ` · ${fmtKm(e.odoKm)}` : ''}
                    </span>
                  </span>
                  {e.woNumber && (
                    <Link to="/maintenance" onClick={(ev) => ev.stopPropagation()}
                      className="font-mono text-[12px] font-semibold text-accent-strong hover:underline">{e.woNumber}</Link>
                  )}
                  {e.cost !== undefined && <span className="font-mono text-[13px] font-bold text-ink-900">{fmtKES(e.cost)}</span>}
                  {e.items && <ChevronDown size={15} className={cn('text-ink-400 transition-transform', expanded === e.id && 'rotate-180')} />}
                </button>
                {expanded === e.id && e.items && (
                  <div className="border-t border-border px-4 py-3">
                    <table className="w-full text-table">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-400">
                          <th className="pb-1">Line item</th><th className="pb-1 text-right">Qty</th>
                          <th className="pb-1 text-right">Unit</th><th className="pb-1 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.items.map((it, k) => (
                          <tr key={k} className="border-t border-border/60">
                            <td className="py-1.5">{it.description}</td>
                            <td className="py-1.5 text-right font-mono">{it.qty}</td>
                            <td className="py-1.5 text-right font-mono">{fmtKES(it.unitCostKes)}</td>
                            <td className="py-1.5 text-right font-mono">{fmtKES(it.qty * it.unitCostKes)}</td>
                          </tr>
                        ))}
                        <tr className="border-t border-border/60">
                          <td className="py-1.5">Labour</td><td /><td />
                          <td className="py-1.5 text-right font-mono">{fmtKES(e.labor ?? 0)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
        {shown.length === 0 && (
          <li className="rounded-card border border-border bg-white p-8 text-center text-[13px] text-ink-400">
            No entries in this category yet.
          </li>
        )}
      </ol>
    </div>
  );
}

/* ================================================================== */
/* TAB 3 — Costs & TCO                                                 */
/* ================================================================== */

function TcoTab({ v, fuelLogs, wos, trips, health }: {
  v: Vehicle; fuelLogs: FuelLog[]; wos: WorkOrder[]; trips: Trip[]; health: number;
}) {
  const [monthSel, setMonthSel] = useState<'jul' | 'jun' | 'ytd'>('jul');
  const [assumpOpen, setAssumpOpen] = useState(false);

  const tco = useMemo(() => tcoBreakdown(v, fuelLogs, wos, trips), [v, fuelLogs, wos, trips]);
  const series = useMemo(() => buildYearSeries(v, fuelLogs, wos, trips), [v, fuelLogs, wos, trips]);
  const mtd = useMemo(() => mtdCosts(v.id, fuelLogs, wos, trips), [v.id, fuelLogs, wos, trips]);

  const donut = useMemo(() => {
    let fuel: number, maint: number, dep: number, ins: number;
    if (monthSel === 'jul') {
      const m = series[11];
      fuel = mtd.fuelKes; maint = mtd.maintKes; dep = m.dep; ins = m.ins;
    } else if (monthSel === 'jun') {
      const m = series[10];
      fuel = m.fuel; maint = m.maint; dep = m.dep; ins = m.ins;
    } else {
      fuel = series.reduce((s, m) => s + m.fuel, 0);
      maint = series.reduce((s, m) => s + m.maint, 0);
      dep = series.reduce((s, m) => s + m.dep, 0);
      ins = series.reduce((s, m) => s + m.ins, 0);
    }
    const total = Math.max(1, fuel + maint + dep + ins);
    return {
      rows: [
        { name: 'Fuel', value: fuel, color: '#06B6D4', pct: fuel / total },
        { name: 'Depreciation', value: dep, color: '#0F2540', pct: dep / total },
        { name: 'Maintenance', value: maint, color: '#F59E0B', pct: maint / total },
        { name: 'Insurance', value: ins, color: '#64748B', pct: ins / total },
      ],
    };
  }, [monthSel, series, mtd]);

  // replacement intelligence
  const verdict = useMemo(() => {
    const recent = series.slice(9).map((m) => m.costKm ?? 0);
    const earlier = series.slice(0, 3).map((m) => m.costKm ?? 0);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    const yoyPct = avg(earlier) > 0 ? ((avg(recent) - avg(earlier)) / avg(earlier)) * 100 : 0;
    const majorRepairs = wos.filter((w) => woEstimate(w) > 30000 && demoDaysAgo(w.openedAt) <= 180).length;
    const annualKm = (series[11].km + series[10].km) * 6;
    const fleetBenchmarkKm = 14; // KES/km for a healthy unit this class
    const curKm = avg(recent);
    const saveYear = Math.max(0, (curKm - fleetBenchmarkKm) * annualKm);
    const consider = yoyPct > 25 || majorRepairs >= 2 || (v.odometerKm > 150000 && health < 70);
    const year6 = v.year + 6;
    return { yoyPct, majorRepairs, saveYear, consider, curKm, year6 };
  }, [series, wos, v, health]);

  const kpis: { label: string; value: number; sub?: string; highlight?: boolean }[] = [
    { label: 'Purchase', value: tco.purchaseKes },
    { label: 'Depreciation to date', value: tco.depreciationKes, sub: `${Math.round(tco.depPct * 100)}% · straight-line 8y` },
    { label: 'Fuel — lifetime', value: tco.fuelKes },
    { label: 'Maintenance — lifetime', value: tco.maintenanceKes },
    { label: 'Insurance & other', value: tco.insuranceKes },
    { label: 'Lifetime TCO', value: tco.tcoKes, sub: `${tco.costPerKmLifetime ? `KES ${tco.costPerKmLifetime.toFixed(2)}/km` : ''}`, highlight: true },
  ];

  const exportPdf = async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    doc.setFillColor(10, 26, 47);
    doc.rect(0, 0, 210, 26, 'F');
    doc.setTextColor(34, 211, 238);
    doc.setFontSize(15);
    doc.text('FBV FleetOS — Vehicle TCO Report', 14, 12);
    doc.setTextColor(201, 217, 234);
    doc.setFontSize(9);
    doc.text(`${v.plate} · ${v.model} ${v.year} · generated 28 Jul 2026 (EAT)`, 14, 19);
    doc.setTextColor(14, 27, 42);
    doc.setFontSize(12);
    doc.text('Lifetime cost of ownership', 14, 40);
    doc.setFontSize(10);
    const rows: [string, string][] = [
      ['Purchase price', fmtKES(tco.purchaseKes)],
      [`Depreciation to date (${Math.round(tco.depPct * 100)}%, straight-line 8y)`, fmtKES(tco.depreciationKes)],
      ['Fuel — lifetime', fmtKES(tco.fuelKes)],
      ['Maintenance — lifetime', fmtKES(tco.maintenanceKes)],
      ['Insurance & other', fmtKES(tco.insuranceKes)],
      ['Lifetime TCO', fmtKES(tco.tcoKes)],
      ['Lifetime cost per km', tco.costPerKmLifetime ? `KES ${tco.costPerKmLifetime.toFixed(2)}` : '—'],
      ['Variable cost per km (July 2026)', mtd.costPerKm !== null ? `KES ${mtd.costPerKm.toFixed(2)}` : '—'],
    ];
    rows.forEach(([k, val], i) => {
      doc.setFont('helvetica', 'normal');
      doc.text(k, 14, 50 + i * 8);
      doc.setFont('courier', 'bold');
      doc.text(val, 196, 50 + i * 8, { align: 'right' });
    });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Replacement recommendation', 14, 126);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(
      verdict.consider
        ? `CONSIDER REPLACEMENT — cost/km trend ${verdict.yoyPct >= 0 ? '+' : ''}${verdict.yoyPct.toFixed(0)}% vs a year ago, ${verdict.majorRepairs} major repairs in 6 months. Replacing now saves approx ${fmtKES(verdict.saveYear)}/yr versus keeping this unit.`
        : `HOLD — cost/km stable (KES ${verdict.curKm.toFixed(2)}/km recent), reliability strong. Projected replacement window ${verdict.year6} (year 6 of service).`,
      180);
    doc.text(lines, 14, 134);
    doc.setFontSize(8);
    doc.setTextColor(124, 141, 162);
    doc.text('FBV FleetOS · Future Bright Ventures Ltd · Nairobi, Kenya · demo build v2.4.1', 14, 285);
    doc.save(`${v.plate.replace(' ', '-')}-TCO-jul-2026.pdf`);
    toast({ title: 'TCO report exported', body: `${v.plate.replace(' ', '-')}-TCO-jul-2026.pdf`, status: 'ok' });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* TCO KPI band */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.1, ease: EASE }}
            className={cn('rounded-card border p-4 shadow-card',
              k.highlight ? 'border-navy-700 bg-navy-900' : 'border-border bg-white')}>
            <div className={cn('text-[11px] font-medium uppercase tracking-[0.06em]', k.highlight ? 'text-navy-100' : 'text-ink-400')}>{k.label}</div>
            <div className={cn('mt-1 font-mono text-[16px] font-bold leading-6', k.highlight ? 'text-accent-on-navy' : 'text-ink-900')}>
              {fmtKES(k.value, { compact: k.value >= 1_000_000 })}
            </div>
            {k.sub && <div className={cn('mt-0.5 text-micro', k.highlight ? 'text-navy-100/80' : 'text-ink-400')}>{k.sub}</div>}
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* cost per km hero */}
        <SectionCard title="Cost per kilometre"
          right={<button type="button" onClick={exportPdf}
            className="flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={12} /> TCO report (PDF)
          </button>}>
          <div className="mb-2 flex flex-wrap items-end gap-6">
            <div>
              <div className="font-mono text-[26px] font-bold leading-8 text-ink-900">
                {tco.costPerKmLifetime ? `KES ${tco.costPerKmLifetime.toFixed(2)}` : '—'}
                <span className="ml-1 text-[13px] font-medium text-ink-400">/km lifetime</span>
              </div>
            </div>
            <div className="font-mono text-[15px] font-semibold text-ink-600">
              {mtd.costPerKm !== null ? `KES ${mtd.costPerKm.toFixed(2)}` : '—'}
              <span className="ml-1 text-[12px] font-medium text-ink-400">/km variable (Jul)</span>
            </div>
          </div>
          <LineChartCard
            data={series.map((m) => ({ m: m.label, costKm: m.costKm !== null ? Number(m.costKm.toFixed(2)) : 0 }))}
            xKey="m" series={[{ key: 'costKm', name: 'KES/km', color: '#06B6D4' }]} height={210} area />
          <div className="mt-2 flex flex-wrap gap-3 text-micro text-ink-400">
            {series.filter((m) => m.spike).slice(0, 4).map((m) => (
              <span key={m.label} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-alert" /> {m.label} maintenance spike ({fmtKES(m.maint, { compact: true })})
              </span>
            ))}
          </div>
        </SectionCard>

        {/* donut */}
        <SectionCard title="Cost breakdown"
          right={
            <div className="flex gap-1">
              {([['jul', 'Jul'], ['jun', 'Jun'], ['ytd', '12 mo']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMonthSel(k)}
                  className={cn('h-7 rounded-full border px-2.5 text-[11px] font-semibold',
                    monthSel === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border text-ink-600 hover:bg-surface-muted')}>
                  {l}
                </button>
              ))}
            </div>
          }>
          <div className="flex items-center gap-4">
            <DonutChartCard data={donut.rows} height={190} className="w-1/2" />
            <ul className="flex flex-1 flex-col gap-2">
              {donut.rows.map((r) => (
                <li key={r.name} className="flex items-center gap-2 text-[13px]">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                  <span className="flex-1 text-ink-600">{r.name}</span>
                  <span className="font-mono font-semibold text-ink-900">{fmtKES(r.value, { compact: true })}</span>
                  <span className="w-10 text-right font-mono text-micro text-ink-400">{Math.round(r.pct * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
          {/* monthly stacked */}
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Monthly cost stack — 12 mo</div>
            <BarChartCard stacked height={190}
              data={series.map((m) => ({ m: m.label, Fuel: m.fuel, Maintenance: m.maint, Insurance: m.ins, Depreciation: m.dep }))}
              xKey="m"
              series={[
                { key: 'Fuel', name: 'Fuel', color: '#06B6D4' },
                { key: 'Maintenance', name: 'Maintenance', color: '#F59E0B' },
                { key: 'Insurance', name: 'Insurance', color: '#64748B' },
                { key: 'Depreciation', name: 'Depreciation', color: '#0F2540' },
              ]} />
          </div>
        </SectionCard>
      </div>

      {/* replacement recommendation */}
      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}
        className={cn('rounded-card border-2 bg-white p-5 shadow-card',
          verdict.consider ? 'border-alert/50' : 'border-accent/50')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl',
            verdict.consider ? 'bg-alert-soft text-alert' : 'bg-accent-soft text-accent-strong')}>
            {verdict.consider ? <AlertTriangle size={18} /> : <Sparkles size={18} />}
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink-900">Replacement recommendation</h3>
              <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3, delay: 0.2 }}>
                <StatusPill
                  status={verdict.consider ? 'alert' : 'ok'}
                  label={verdict.consider ? 'CONSIDER REPLACEMENT' : 'HOLD — optimal'} />
              </motion.span>
            </div>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-ink-600">
              {verdict.consider
                ? `Cost/km ${verdict.yoyPct >= 0 ? 'up' : 'down'} ${Math.abs(verdict.yoyPct).toFixed(0)}% vs a year ago (KES ${verdict.curKm.toFixed(2)}/km recent), ${verdict.majorRepairs} major repair${verdict.majorRepairs === 1 ? '' : 's'} in 6 months — replacing now saves ≈ ${fmtKES(verdict.saveYear)}/yr vs keeping.`
                : `Cost/km stable at KES ${verdict.curKm.toFixed(2)}, reliability strong. Projected replacement window ${verdict.year6} (≈ ${fmtNum(v.odometerKm + 60000)} km, year 6).`}
            </p>
          </div>
          <button type="button" onClick={() => setAssumpOpen(true)}
            className="text-[12px] font-semibold text-accent-strong underline underline-offset-2 hover:opacity-80">
            Assumptions
          </button>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 border-t border-border pt-3 text-[12px] text-ink-600 sm:grid-cols-3">
          <li className="flex items-center gap-2"><TrendingUp size={13} className="text-ink-400" /> YoY cost/km Δ {verdict.yoyPct >= 0 ? '+' : ''}{verdict.yoyPct.toFixed(0)}%</li>
          <li className="flex items-center gap-2"><Wrench size={13} className="text-ink-400" /> Major repairs 6 mo: <b className="font-mono">{verdict.majorRepairs}</b></li>
          <li className="flex items-center gap-2"><CircleDot size={13} className="text-ink-400" /> Odometer {fmtKm(v.odometerKm)} · health {health}</li>
        </ul>
      </motion.section>

      <Modal open={assumpOpen} onClose={() => setAssumpOpen(false)} title="TCO model assumptions">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] leading-5 text-ink-600">
          <li>Depreciation: straight-line over 8 years from purchase ({fmtKES(v.purchaseCostKes)}).</li>
          <li>Fuel: diesel {fmtKES(189.5)}/L / petrol {fmtKES(204.3)}/L reference; lifetime spend scaled from the 60-day history by lifetime km.</li>
          <li>Maintenance: actual work-order spend scaled to lifetime utilization.</li>
          <li>Insurance & compliance: 4.5% of purchase value per year (Kenyan comprehensive norm).</li>
          <li>Utilization: {fmtNum(series[11].km)} km in July 2026; replacement benchmark KES 14.00/km variable for this class.</li>
        </ul>
      </Modal>
    </div>
  );
}

/* ================================================================== */
/* TAB 4 — Documents                                                   */
/* ================================================================== */

function DocsTab({ v, docs }: { v: Vehicle; docs: DocumentRec[] }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {docs.map((d, i) => {
          const days = demoDaysUntil(d.expiresAt);
          return (
            <motion.div key={d.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
              className="flex items-center gap-4 rounded-card border border-border bg-white p-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-pop">
              <ExpiryRing days={Math.max(0, days)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-ink-900">{d.docType}</span>
                  <StatusPill status={expiryKey(days)} label={days < 0 ? 'EXPIRED' : `${days} days`} pulse={days <= 7 && days >= 0} />
                </div>
                <div className="mt-0.5 font-mono text-micro text-ink-400">{d.number}</div>
                <div className="font-mono text-micro text-ink-400">expires {fmtDateEAT(d.expiresAt)}</div>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => navigate('/documents')}
                    className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-semibold text-ink-600 hover:bg-surface-muted">View in vault</button>
                  <button type="button" onClick={() => navigate('/documents')}
                    className="rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-navy-950 hover:bg-accent-strong">Replace / renew</button>
                </div>
              </div>
            </motion.div>
          );
        })}
        {docs.length === 0 && (
          <EmptyState icon={FileText} title="No documents on file"
            hint={`Insurance, NTSA inspection certificates and road service licences for ${v.plate} live in the document vault.`}
            ctaLabel="Open document vault" onCta={() => navigate('/documents')} />
        )}
      </div>
      <p className="text-micro text-ink-400">
        {v.plate} — NTSA inspection & insurance compliance is tracked fleet-wide in the <Link to="/documents" className="font-semibold text-accent-strong">Document Vault</Link> (90/60/30-day radar).
      </p>
    </div>
  );
}

/* ================================================================== */
/* TAB 5 — Trips                                                       */
/* ================================================================== */

function TripsTab({ v, trips, drivers }: { v: Vehicle; trips: Trip[]; drivers: import('@/lib/types').Driver[] }) {
  const monthlyKm = useMemo(() => {
    const out: number[] = [];
    const base = new Date(`${TODAY}T00:00:00Z`);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
      const key = d.toISOString().slice(0, 7);
      out.push(trips.filter((t) => t.startAt.slice(0, 7) === key).reduce((s, t) => s + t.distanceKm, 0));
    }
    return out;
  }, [trips]);

  const columns: Column<Trip>[] = [
    { key: 'date', header: 'Date', mono: true, render: (t) => fmtDateTimeEAT(t.startAt) },
    { key: 'route', header: 'From → To', render: (t) => <span className="font-medium">{t.from} → {t.to}</span> },
    { key: 'dist', header: 'Distance', mono: true, align: 'right', render: (t) => fmtKm(t.distanceKm) },
    { key: 'dur', header: 'Duration', mono: true, align: 'right', render: (t) => `${Math.floor(t.durationMin / 60)}h ${String(t.durationMin % 60).padStart(2, '0')}m` },
    { key: 'idle', header: 'Idle', mono: true, align: 'right', render: (t) => `${t.idleMin} min` },
    { key: 'driver', header: 'Driver', render: (t) => driverById(drivers, t.driverId)?.name ?? '—' },
    {
      key: 'class', header: 'Class', render: (t) => (
        <StatusPill
          status={t.classification === 'business' ? 'ok' : t.classification === 'private' ? 'warn' : 'inactive'}
          label={t.classification} />
      ),
    },
    {
      key: 'replay', header: '', render: () => (
        <Link to="/tracking" onClick={(e) => e.stopPropagation()} className="text-[12px] font-semibold text-accent-strong hover:underline">
          Replay →
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-6 rounded-card border border-border bg-white px-5 py-4 shadow-card">
        <div>
          <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Distance — Jul 2026</div>
          <div className="font-mono text-[20px] font-bold text-ink-900">{fmtKm(trips.filter((t) => isMtd(t.startAt)).reduce((s, t) => s + t.distanceKm, 0))}</div>
        </div>
        <div className="w-56">
          <div className="mb-1 text-micro uppercase tracking-[0.06em] text-ink-400">Monthly km — 6 mo</div>
          <Sparkline data={monthlyKm} height={36} />
        </div>
        <div className="text-micro text-ink-400">
          <Clock size={11} className="mr-1 inline" />{trips.length} trips in the 60-day window · corridor {corridorById(v.simRoute).name}
        </div>
      </div>
      <DataTable<Trip> columns={columns} rows={trips} pageSize={12} compact
        empty={<EmptyState icon={Route} title="No trips recorded" hint="Trips appear automatically as the telematics feed detects movement." />} />
    </div>
  );
}
