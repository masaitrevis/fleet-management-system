// FBV FleetOS — /vehicles Vehicle Registry (design/vehicles.md).
// Grid/table of the 14 seeded vehicles with live status, health signals,
// assignment, alert chips, bulk filters and the 2-step add-vehicle modal.

import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bus, Car, CarFront, Check, Download, Gauge, KeyRound, LayoutGrid,
  Plus, Search, Table as TableIcon, Truck, UserPlus, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DataTable, KPIStatCard, Modal, PlateTag, StatusPill, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, nextSequence, update, useCollection, useLivePositions } from '@/lib/store';
import { corridorById } from '@/lib/telematics';
import {
  expiryKey, fmtKES, fmtKm, fmtNum, scoreColor,
} from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type { Driver, LivePosition, Vehicle, VehicleType } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Avatar, auditLog, exportXlsx, mtdCosts,
  useFleetSignals, vehicleHealth,
} from './lib';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const TYPE_ICON: Record<VehicleType, LucideIcon> = {
  truck: Truck, van: CarFront, pickup: Truck, car: Car, bus: Bus,
};
const TYPE_LABEL: Record<VehicleType, string> = {
  truck: 'Truck', van: 'Van', pickup: 'Pickup', car: 'Car', bus: 'Bus',
};

export function vehiclePill(v: Vehicle, live?: LivePosition): { key: StatusKey; label: string } {
  if (v.status === 'offline' && v.tripStatus === 'maintenance') return { key: 'alert', label: 'DO-NOT-DRIVE' };
  if (v.status === 'offline') return { key: 'alert', label: 'OFFLINE' };
  if (v.tripStatus === 'maintenance') return { key: 'warn', label: 'IN SHOP' };
  const s = live?.status ?? v.status;
  if (s === 'moving') return { key: 'ok', label: 'MOVING' };
  if (s === 'idling') return { key: 'warn', label: 'IDLING' };
  return { key: 'inactive', label: 'STOPPED' };
}

function locationSnippet(v: Vehicle, geofences: { name: string; center?: { lat: number; lng: number } }[], live?: LivePosition): string {
  if (live) {
    let best: string | null = null;
    let bestD = Infinity;
    for (const g of geofences) {
      if (!g.center) continue;
      const d = Math.hypot(g.center.lat - live.lat, g.center.lng - live.lng);
      if (d < bestD) { bestD = d; best = g.name; }
    }
    if (best && bestD < 0.02) return `at ${best}`;
    if (best) return `near ${best}`;
  }
  return corridorById(v.simRoute).name;
}

/* ---------------- alert chips ---------------- */

function AlertChips({ v }: { v: Vehicle }) {
  const { byVehicle } = useFleetSignals();
  const sig = byVehicle.get(v.id);
  if (!sig) return null;
  const chips: { label: string; cls: string; to: string }[] = [];
  if (sig.activeDtc) chips.push({ label: `DTC ${sig.activeDtc.code}`, cls: 'bg-alert-soft text-alert-on-soft', to: '/maintenance/schedules' });
  if (sig.nextServiceKmLeft !== null && sig.nextServiceKmLeft < 1000) {
    chips.push({
      label: sig.nextServiceKmLeft < 0 ? `Service OVERDUE ${fmtNum(-sig.nextServiceKmLeft)} km` : `Service in ${fmtNum(sig.nextServiceKmLeft)} km`,
      cls: sig.nextServiceKmLeft < 0 ? 'bg-alert-soft text-alert-on-soft' : 'bg-warn-soft text-warn-on-soft',
      to: '/maintenance/schedules',
    });
  }
  if (sig.worstDocDays !== null && sig.worstDocDays <= 90) {
    chips.push({ label: `Docs ${sig.worstDocDays} d`, cls: sig.worstDocDays <= 30 ? 'bg-alert-soft text-alert-on-soft' : 'bg-warn-soft text-warn-on-soft', to: '/documents' });
  }
  if (sig.openWos.length > 0) chips.push({ label: 'WO open', cls: 'bg-accent-soft text-accent-strong', to: '/maintenance' });
  const shown = chips.slice(0, 3);
  const extra = chips.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <Link key={c.label} to={c.to} onClick={(e) => e.stopPropagation()}
          className={cn('rounded-full px-2 py-0.5 text-micro font-semibold', c.cls)}>
          {c.label}
        </Link>
      ))}
      {extra > 0 && <span className="rounded-full bg-inactive-soft px-2 py-0.5 text-micro font-semibold text-inactive-on-soft">+{extra}</span>}
    </div>
  );
}

/* ---------------- vehicle card ---------------- */

function VehicleCard({ v, live, geofences, drivers, health, index, onAssign }: {
  v: Vehicle; live?: LivePosition;
  geofences: { name: string; center?: { lat: number; lng: number } }[];
  drivers: Driver[]; health: number; index: number;
  onAssign: (v: Vehicle) => void;
}) {
  const navigate = useNavigate();
  const pill = vehiclePill(v, live);
  const Icon = TYPE_ICON[v.type];
  const offline = v.status === 'offline';
  const driver = drivers.find((d) => d.id === v.assignedDriverId);
  return (
    <motion.article
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: 0.05 * index, ease: EASE }}
      onClick={() => navigate(`/vehicles/${v.id}`)}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-drawer border border-border bg-white p-[18px] shadow-card',
        'transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop',
        offline && 'border-l-4 border-l-alert',
      )}
    >
      <div className={cn('flex flex-col gap-3', offline && 'opacity-60 saturate-[0.4]')}>
        <div className="flex items-start justify-between">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-navy-50 text-navy-800">
            {pill.label === 'MOVING' && <span className="absolute inset-0 rounded-xl ring-2 ring-accent/40 animate-pulse" />}
            <Icon size={24} strokeWidth={1.8} />
          </span>
          <StatusPill status={pill.key} label={pill.label} pulse={pill.label === 'MOVING'} />
        </div>
        <div>
          <PlateTag plate={v.plate} className="px-2 py-1 text-[16px]" />
          <div className="mt-1.5 text-[14px] font-semibold text-ink-900">{v.model} · {v.year}</div>
          <div className="text-micro text-ink-400">{v.depot}</div>
        </div>
        {!offline && live && (
          <div className="flex items-center gap-3 text-micro text-ink-600">
            <span className="font-mono font-semibold text-ink-900">{Math.round(live.speedKmh)} km/h</span>
            <span className={cn('flex items-center gap-1', live.ignition ? 'text-ok-on-soft' : 'text-ink-400')}>
              <KeyRound size={11} /> {live.ignition ? 'IGN ON' : 'IGN OFF'}
            </span>
            <span className="truncate">{locationSnippet(v, geofences, live)}</span>
          </div>
        )}
        <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
          <div className="px-2.5 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Odometer</div>
            <div className="font-mono text-[13px] font-semibold text-ink-900">{fmtKm(v.odometerKm)}</div>
          </div>
          <div className="px-2.5 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Fuel</div>
            <div className="font-mono text-[13px] font-semibold text-ink-900">{v.fuelLevelPct}%</div>
          </div>
          <div className="px-2.5 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Health</div>
            <div className="font-mono text-[13px] font-bold transition-colors duration-300" style={{ color: scoreColor(health) }}>{health}</div>
          </div>
        </div>
        <AlertChips v={v} />
      </div>
      {offline && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-alert-soft px-3 py-2 text-[12px] font-medium text-alert-on-soft">
          <span>No signal 2 d — U0100 comms fault</span>
          <Link to="/maintenance" onClick={(e) => e.stopPropagation()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 font-semibold shadow-card hover:bg-surface-muted">
            <Wrench size={12} /> Create WO
          </Link>
        </div>
      )}
      <footer className="mt-auto flex items-center justify-between border-t border-border pt-3">
        {driver ? (
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink-900">
            <Avatar name={driver.name} size={24} /> {driver.name}
          </span>
        ) : (
          <button type="button" onClick={(e) => { e.stopPropagation(); onAssign(v); }}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-ink-400/60 px-2.5 py-1 text-[12px] font-semibold text-ink-400 hover:border-accent hover:text-accent-strong">
            <UserPlus size={13} /> Assign driver
          </button>
        )}
        <span className="text-[13px] font-semibold text-accent-strong transition-transform duration-150 group-hover:translate-x-[3px]">Open →</span>
      </footer>
    </motion.article>
  );
}

/* ---------------- add vehicle modal ---------------- */

const PLATE_RE = /^K[A-Z]{2} \d{3}[A-Z]$/;
const IMEI_RE = /^\d{15}$/;

function AddVehicleModal({ open, onClose, drivers }: { open: boolean; onClose: () => void; drivers: Driver[] }) {
  const [step, setStep] = useState(1);
  const [plate, setPlate] = useState('');
  const [type, setType] = useState<VehicleType>('truck');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2024');
  const [color, setColor] = useState('');
  const [tank, setTank] = useState('100');
  const [cost, setCost] = useState('');
  const [costDate, setCostDate] = useState('2026-07-28');
  const [odo, setOdo] = useState('0');
  const [driverId, setDriverId] = useState('');
  const [imei, setImei] = useState('');
  const [saving, setSaving] = useState(false);

  const plateOk = PLATE_RE.test(plate);
  const imeiOk = imei === '' || IMEI_RE.test(imei);
  const step1Ok = plateOk && make.trim() && model.trim() && Number(year) >= 1990;

  const reset = () => {
    setStep(1); setPlate(''); setType('truck'); setMake(''); setModel(''); setYear('2024');
    setColor(''); setTank('100'); setCost(''); setCostDate('2026-07-28'); setOdo('0'); setDriverId('');
    setImei('');
  };

  const save = async () => {
    setSaving(true);
    const seq = await nextSequence('vehicle');
    const deviceLabel = imei ? `IMEI ${imei}` : `SIM-KE-${seq.slice(-3)}`;
    const rec = add('vehicles', {
      id: `veh-${seq.slice(-3)}`,
      plate, type, make: make.trim(), model: `${make.trim()} ${model.trim()}`, year: Number(year),
      status: 'stopped', tripStatus: 'active',
      odometerKm: Number(odo) || 0, engineHours: 0, fuelLevelPct: 100,
      tankCapacityL: Number(tank) || 80, fuelType: 'diesel',
      purchaseCostKes: Number(cost) || 0,
      assignedDriverId: driverId || null,
      depot: 'FBV Depot — Industrial Area',
      simRoute: 'city-industrial', homeLat: -1.3031, homeLng: 36.8526,
      lastServiceKm: Number(odo) || 0,
      createdAt: costDate,
      ...(imei ? { deviceImei: imei } : {}),
    });
    auditLog('create', 'vehicles', rec.id, `Registered vehicle ${plate} (${make} ${model}, device ${deviceLabel})`);
    toast({ title: 'Vehicle added', body: `${plate} registered · telematics ${deviceLabel}`, status: 'ok' });
    setSaving(false);
    onClose();
    reset();
  };

  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const label = 'text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400';

  return (
    <Modal open={open} onClose={onClose} wide
      title={
        <div className="flex items-center gap-3">
          <span>Add vehicle</span>
          <span className="flex items-center gap-1 text-micro font-medium text-ink-400">
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', step === 1 ? 'bg-accent text-navy-950' : 'bg-ok text-white')}>{step === 1 ? '1' : <Check size={11} />}</span> Identity
            <span className="text-border">——</span>
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold', step === 2 ? 'bg-accent text-navy-950' : 'bg-inactive-soft text-inactive-on-soft')}>2</span> Setup
          </span>
        </div>
      }
      footer={
        <>
          {step === 2 && (
            <button type="button" onClick={() => setStep(1)}
              className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Back</button>
          )}
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          {step === 1 ? (
            <button type="button" disabled={!step1Ok} onClick={() => setStep(2)}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Continue</button>
          ) : (
            <button type="button" disabled={saving || !imeiOk} onClick={save}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
              {saving ? 'Saving…' : 'Save vehicle'}
            </button>
          )}
        </>
      }>
      {step === 1 ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1">
            <span className={label}>Registration plate</span>
            <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="KDJ 123A" className={cn(input, 'font-mono uppercase tracking-[0.04em]', plate && !plateOk && 'border-alert')} />
            {plate && !plateOk
              ? <span className="text-micro font-medium text-alert-on-soft">Use format KDJ 123A</span>
              : <span className="text-micro text-ink-400">Kenyan format: KXX 000X</span>}
          </label>
          <div className="col-span-2 flex flex-col gap-1">
            <span className={label}>Type</span>
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(TYPE_ICON) as VehicleType[]).map((t) => {
                const I = TYPE_ICON[t];
                return (
                  <button key={t} type="button" onClick={() => setType(t)}
                    className={cn('flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-micro font-semibold transition-colors',
                      type === t ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border text-ink-600 hover:bg-surface-muted')}>
                    <I size={18} /> {TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex flex-col gap-1"><span className={label}>Make</span>
            <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Isuzu" className={input} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="FRR Box Truck" className={input} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Year</span>
            <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Colour</span>
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="White" className={input} /></label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className={label}>Tank capacity (L)</span>
            <input value={tank} onChange={(e) => setTank(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Odometer now (km)</span>
            <input value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Purchase cost (KES)</span>
            <input value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} placeholder="5,000,000" className={cn(input, 'font-mono')} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Purchase date</span>
            <input type="date" value={costDate} onChange={(e) => setCostDate(e.target.value)} className={cn(input, 'font-mono')} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Assign driver (optional)</span>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={input}>
              <option value="">— unassigned —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className={label}>GPS device IMEI (optional)</span>
            <input value={imei} onChange={(e) => setImei(e.target.value.replace(/\D/g, '').slice(0, 15))}
              placeholder="861234567890123" inputMode="numeric"
              className={cn(input, 'font-mono tracking-[0.04em]', imei && !imeiOk && 'border-alert')} />
            {imei && !imeiOk
              ? <span className="text-micro font-medium text-alert-on-soft">IMEI must be exactly 15 digits ({imei.length}/15)</span>
              : <span className="text-micro text-ink-400">From the tracker installed in the vehicle — leave empty to keep this vehicle simulated</span>}
          </label>
          <p className="col-span-2 rounded-lg bg-accent-soft/50 px-3 py-2 text-[12px] text-ink-600">
            Purchase cost & date feed the TCO model (8-year straight-line depreciation) on the vehicle 360° page.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- assign driver modal ---------------- */

function AssignDriverModal({ v, drivers, onClose }: { v: Vehicle | null; drivers: Driver[]; onClose: () => void }) {
  const [driverId, setDriverId] = useState('');
  return (
    <Modal open={!!v} onClose={onClose} title={`Assign driver — ${v?.plate ?? ''}`}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!driverId} onClick={() => {
            if (!v) return;
            update('vehicles', v.id, { assignedDriverId: driverId });
            const d = drivers.find((x) => x.id === driverId);
            auditLog('update', 'vehicles', v.id, `Assigned ${d?.name ?? driverId} to ${v.plate}`);
            toast({ title: 'Driver assigned', body: `${d?.name} → ${v.plate}`, status: 'ok' });
            onClose();
          }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Assign</button>
        </>
      }>
      <div className="flex flex-col gap-2">
        {drivers.map((d) => (
          <button key={d.id} type="button" onClick={() => setDriverId(d.id)}
            className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
              driverId === d.id ? 'border-accent bg-accent-soft/50' : 'border-border hover:bg-surface-muted')}>
            <Avatar name={d.name} size={28} />
            <span className="flex-1">
              <span className="block text-[13px] font-semibold text-ink-900">{d.name}</span>
              <span className="block font-mono text-micro text-ink-400">{d.licenseNo} · safety {Math.round(d.safetyScore)}</span>
            </span>
            {driverId === d.id && <Check size={16} className="text-accent-strong" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- main page ---------------- */

export default function Vehicles() {
  const navigate = useNavigate();
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const geofences = useCollection('geofences');
  const workOrders = useCollection('workOrders');
  const fuelLogs = useCollection('fuelLogs');
  const trips = useCollection('trips');
  const live = useLivePositions();
  const liveBy = useMemo(() => new Map(live.map((p) => [p.vehicleId, p])), [live]);
  const { byVehicle, health } = useFleetSignals();

  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<VehicleType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'workshop' | 'offline'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [assignV, setAssignV] = useState<Vehicle | null>(null);

  const kpis = useMemo(() => {
    const inWorkshop = vehicles.filter((v) => workOrders.some((w) => w.vehicleId === v.id && w.status === 'in-progress')).length;
    const offline = vehicles.filter((v) => v.status === 'offline').length;
    return { size: vehicles.length, active: vehicles.length - inWorkshop - offline, inWorkshop, offline };
  }, [vehicles, workOrders]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (typeFilter !== 'all' && v.type !== typeFilter) return false;
      if (statusFilter === 'offline' && v.status !== 'offline') return false;
      if (statusFilter === 'workshop' && !workOrders.some((w) => w.vehicleId === v.id && w.status === 'in-progress')) return false;
      if (statusFilter === 'active' && (v.status === 'offline' || workOrders.some((w) => w.vehicleId === v.id && w.status === 'in-progress'))) return false;
      if (needle) {
        const driver = drivers.find((d) => d.id === v.assignedDriverId)?.name.toLowerCase() ?? '';
        const hay = `${v.plate} ${v.make} ${v.model} ${driver}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [vehicles, q, typeFilter, statusFilter, workOrders, drivers]);

  const typeCounts = useMemo(() => {
    const m = new Map<VehicleType, number>();
    for (const v of vehicles) m.set(v.type, (m.get(v.type) ?? 0) + 1);
    return m;
  }, [vehicles]);

  const columns: Column<Vehicle>[] = [
    {
      key: 'status', header: 'Status', render: (v) => {
        const p = vehiclePill(v, liveBy.get(v.id));
        return <StatusPill status={p.key} label={p.label} />;
      },
    },
    { key: 'plate', header: 'Plate', render: (v) => <PlateTag plate={v.plate} /> },
    { key: 'vehicle', header: 'Vehicle', render: (v) => <span className="font-medium">{v.model} · {v.year}</span> },
    { key: 'type', header: 'Type', render: (v) => TYPE_LABEL[v.type] },
    {
      key: 'driver', header: 'Driver', render: (v) => {
        const d = drivers.find((x) => x.id === v.assignedDriverId);
        return d ? <span className="flex items-center gap-1.5"><Avatar name={d.name} size={20} />{d.name}</span> : <span className="text-ink-400">Unassigned</span>;
      },
    },
    { key: 'odo', header: 'Odometer', mono: true, align: 'right', render: (v) => fmtKm(v.odometerKm) },
    { key: 'fuel', header: 'Fuel', mono: true, align: 'right', render: (v) => `${v.fuelLevelPct}%` },
    {
      key: 'health', header: 'Health', mono: true, align: 'right', render: (v) => (
        <span className="font-bold" style={{ color: scoreColor(health.get(v.id) ?? 0) }}>{health.get(v.id)}</span>
      ),
    },
    {
      key: 'service', header: 'Next service', mono: true, align: 'right', render: (v) => {
        const sig = byVehicle.get(v.id);
        if (sig?.nextServiceKmLeft == null) return <span className="text-ink-400">—</span>;
        const over = sig.nextServiceKmLeft < 0;
        return <span className={over ? 'font-semibold text-alert-on-soft' : ''}>{over ? `-${fmtNum(-sig.nextServiceKmLeft)} km` : `${fmtNum(sig.nextServiceKmLeft)} km`}</span>;
      },
    },
    {
      key: 'docs', header: 'Docs', render: (v) => {
        const sig = byVehicle.get(v.id);
        if (sig?.worstDocDays == null) return <span className="text-ink-400">—</span>;
        return <StatusPill status={expiryKey(sig.worstDocDays)} label={`${sig.worstDocDays} d`} />;
      },
    },
    {
      key: 'wos', header: 'Open WOs', mono: true, align: 'center', render: (v) => byVehicle.get(v.id)?.openWos.length ?? 0,
    },
    {
      key: 'costkm', header: 'Cost/km MTD', mono: true, align: 'right', render: (v) => {
        const c = mtdCosts(v.id, fuelLogs, workOrders, trips);
        return c.costPerKm === null ? <span className="text-ink-400">—</span> : `KES ${c.costPerKm.toFixed(2)}`;
      },
    },
  ];

  const doExport = () => {
    exportXlsx('vehicles-2026-07-28.xlsx', filtered.map((v) => ({
      Plate: v.plate, Vehicle: `${v.model} ${v.year}`, Type: TYPE_LABEL[v.type],
      Status: vehiclePill(v, liveBy.get(v.id)).label,
      Driver: drivers.find((d) => d.id === v.assignedDriverId)?.name ?? 'Unassigned',
      'Odometer (km)': v.odometerKm, 'Fuel %': v.fuelLevelPct,
      'Health score': health.get(v.id), Depot: v.depot,
      'Purchase cost (KES)': v.purchaseCostKes,
    })), 'Vehicles');
    auditLog('update', 'vehicles', 'bulk', 'Exported vehicle registry to Excel');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="mx-auto flex max-w-[1520px] flex-col gap-5 p-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Vehicles</h1>
          <p className="text-[13px] text-ink-400">Fleet asset registry · health, assignment & compliance signals</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border bg-white">
            <button type="button" onClick={() => setView('grid')}
              className={cn('flex h-9 items-center gap-1.5 px-3 text-[12px] font-semibold', view === 'grid' ? 'bg-accent-soft text-accent-strong' : 'text-ink-600 hover:bg-surface-muted')}>
              <LayoutGrid size={14} /> Grid
            </button>
            <button type="button" onClick={() => setView('table')}
              className={cn('flex h-9 items-center gap-1.5 px-3 text-[12px] font-semibold', view === 'table' ? 'bg-accent-soft text-accent-strong' : 'text-ink-600 hover:bg-surface-muted')}>
              <TableIcon size={14} /> Table
            </button>
          </div>
          <button type="button" onClick={doExport}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={15} /> Export Excel
          </button>
          <button type="button" onClick={() => setAddOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
            <Plus size={15} /> Add vehicle
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPIStatCard label="Fleet size" value={kpis.size} icon={Truck} spark={[12, 12, 13, 13, 14, 14, 14]} />
        <KPIStatCard label="Active now" value={kpis.active} icon={Gauge} delta="on the road / ready" deltaGood spark={[9, 10, 10, 11, 11, 12, 12]} />
        <KPIStatCard label="In workshop" value={kpis.inWorkshop} icon={Wrench} delta="WO in progress" deltaGood={false} sparkColor="#F59E0B" spark={[0, 1, 0, 1, 2, 1, 1]} />
        <KPIStatCard label="Offline / DND" value={kpis.offline} icon={KeyRound} delta="comms fault" deltaGood={false} sparkColor="#DC2626" spark={[0, 0, 1, 1, 1, 2, 2]} />
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plate, make or driver…"
            className="h-9 w-64 rounded-lg border border-border bg-white pl-8 pr-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </div>
        <button type="button" onClick={() => setTypeFilter('all')}
          className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', typeFilter === 'all' ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
          All types · {vehicles.length}
        </button>
        {(Object.keys(TYPE_ICON) as VehicleType[]).map((t) => (
          <button key={t} type="button" onClick={() => setTypeFilter(typeFilter === t ? 'all' : t)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', typeFilter === t ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {TYPE_LABEL[t]} · {typeCounts.get(t) ?? 0}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {([['all', 'Any status'], ['active', 'Active'], ['workshop', 'In workshop'], ['offline', 'Offline']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatusFilter(k)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', statusFilter === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {l}
          </button>
        ))}
      </div>

      {/* content */}
      {view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((v, i) => (
            <VehicleCard key={v.id} v={v} index={i}
              live={liveBy.get(v.id)}
              geofences={geofences}
              drivers={drivers}
              health={health.get(v.id) ?? vehicleHealth(v, { openWos: [], overdueSchedule: null, nextServiceKmLeft: null, worstDocDays: null, activeDtc: null })}
              onAssign={setAssignV} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-card border border-border bg-white p-10 text-center text-[13px] text-ink-400">
              No vehicles match the current filters.
            </div>
          )}
        </div>
      ) : (
        <DataTable<Vehicle>
          columns={columns}
          rows={filtered}
          pageSize={14}
          onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
          rowActions={(v) => [
            { label: 'Open 360°', icon: Gauge, onClick: () => navigate(`/vehicles/${v.id}`) },
            { label: 'Assign driver', icon: UserPlus, onClick: () => setAssignV(v) },
            { label: 'Create work order', icon: Wrench, onClick: () => navigate('/maintenance') },
          ]}
        />
      )}

      {/* fuel price footnote */}
      <p className="text-micro text-ink-400">
        Fuel reference — diesel {fmtKES(189.5)}/L · petrol {fmtKES(204.3)}/L · odometers & plates in mono per ops-console convention.
      </p>

      <AddVehicleModal open={addOpen} onClose={() => setAddOpen(false)} drivers={drivers} />
      <AssignDriverModal v={assignV} drivers={drivers} onClose={() => setAssignV(null)} />
    </motion.div>
  );
}
