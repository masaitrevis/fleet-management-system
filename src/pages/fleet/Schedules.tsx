// FBV FleetOS — /maintenance/schedules (design/maintenance-schedules.md).
// Preventive schedules (km / engine-hours / calendar triggers) + live DTC log.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bell, BellRing, CalendarClock, Check, CheckCheck, Download, Gauge, Info,
  Pause, Plus, Radio, Search, Wrench,
} from 'lucide-react';
import {
  ConfirmDialog, DataTable, Drawer, KPIStatCard, Modal, PlateTag, ScoreRing,
  StatusPill, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, update, useCollection } from '@/lib/store';
import {
  SEVERITY_TO_KEY, fmtDateEAT, fmtDateTimeEAT, fmtKm, fmtKES, fmtNum,
} from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type { MaintenanceSchedule, Vehicle, WorkOrder } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TODAY } from '@/lib/seed';
import {
  MaintSubNav, auditLog, addDaysISO, deriveDtcLog, exportXlsx,
  freezeFrame, hashStr, scheduleDue, scheduleStatus, useLocalKV,
} from './lib';
import type { DtcRow } from './lib';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const SERVICE_ICON: Record<string, typeof Wrench> = {
  odometer: Wrench, 'engine-hours': Gauge, calendar: CalendarClock,
};

/* ---------------- schedule remaining bar ---------------- */

function RemainingCell({ s, v }: { s: MaintenanceSchedule; v: Vehicle | undefined }) {
  const due = scheduleDue(s, v);
  const st = scheduleStatus(due);
  if (!due) return <span className="text-ink-400">—</span>;
  let pct = 50;
  if (due.kind === 'km' && s.intervalKm) pct = Math.min(100, Math.max(2, ((s.intervalKm - due.remainingKm) / s.intervalKm) * 100));
  if (due.kind === 'days' && s.intervalDays) pct = Math.min(100, Math.max(2, ((s.intervalDays - due.remainingDays) / s.intervalDays) * 100));
  const color = st.label === 'overdue' || st.label === 'due-now' ? 'bg-alert' : st.label === 'due-soon' ? 'bg-warn' : 'bg-accent';
  return (
    <div className="flex min-w-[150px] flex-col gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: EASE }}
          className={cn('h-full rounded-full', color, st.label === 'overdue' && 'animate-pulse')} />
      </div>
      <span className={cn('font-mono text-[11px] font-semibold', st.key === 'alert' ? 'text-alert-on-soft' : st.key === 'warn' ? 'text-warn-on-soft' : 'text-ink-600')}>
        {due.kind === 'km'
          ? due.remainingKm < 0 ? `OVERDUE ${fmtNum(-due.remainingKm)} km` : `${fmtNum(due.remainingKm)} km`
          : due.remainingDays < 0 ? `OVERDUE ${-due.remainingDays} d` : `${due.remainingDays} days`}
      </span>
    </div>
  );
}

/* ---------------- mark-done modal ---------------- */

function MarkDoneModal({ s, v, onClose }: { s: MaintenanceSchedule | null; v?: Vehicle; onClose: () => void }) {
  if (!s) return null;
  return <MarkDoneForm key={s.id} s={s} v={v} onClose={onClose} />;
}

function MarkDoneForm({ s, v, onClose }: { s: MaintenanceSchedule; v?: Vehicle; onClose: () => void }) {
  const [date, setDate] = useState(TODAY);
  const [odo, setOdo] = useState(String(v?.odometerKm ?? 0));
  const [cost, setCost] = useState('');
  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const save = () => {
    const doneKm = Number(odo) || s.lastDoneKm;
    update('schedules', s.id, {
      lastDoneAt: date,
      lastDoneKm: doneKm,
      nextDueKm: s.intervalKm ? doneKm + s.intervalKm : undefined,
      nextDueAt: s.intervalDays ? addDaysISOAt(date, s.intervalDays) : undefined,
    });
    auditLog('update', 'schedules', s.id, `${s.name} marked done at ${fmtNum(doneKm)} km${cost ? ` (${fmtKES(Number(cost))})` : ''}`);
    toast({ title: 'Schedule updated', body: `${s.name} — next due recomputed`, status: 'ok' });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={`Mark done — ${s.name}`}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" onClick={save}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">Save & recompute</button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Done date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(input, 'font-mono')} /></label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Odometer (km)</span>
          <input value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
        <label className="col-span-2 flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Cost (optional, KES)</span>
          <input value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} placeholder="0" className={cn(input, 'font-mono')} /></label>
        <p className="col-span-2 rounded-lg bg-accent-soft/50 px-3 py-2 text-[12px] text-ink-600">
          Next due recomputes instantly from the trigger interval and the remaining bar resets.
        </p>
      </div>
    </Modal>
  );
}

function addDaysISOAt(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ---------------- new schedule modal ---------------- */

function NewScheduleModal({ open, vehicles, onClose, onSave }: {
  open: boolean; vehicles: Vehicle[];
  onClose: () => void;
  onSave: (rec: Omit<MaintenanceSchedule, 'id'>) => void;
}) {
  const [vehicleId, setVehicleId] = useState('');
  const [name, setName] = useState('Oil & filter service');
  const [useKm, setUseKm] = useState(true);
  const [everyKm, setEveryKm] = useState('5000');
  const [useHours, setUseHours] = useState(false);
  const [everyHours, setEveryHours] = useState('250');
  const [useCal, setUseCal] = useState(false);
  const [everyMonths, setEveryMonths] = useState('6');
  const [remindKm, setRemindKm] = useState('500');
  const [remindDays, setRemindDays] = useState('7');

  const v = vehicles.find((x) => x.id === vehicleId);
  const preview = (() => {
    if (!v) return null;
    const parts: string[] = [];
    if (useKm && Number(everyKm) > 0) parts.push(`${fmtNum(v.odometerKm + Number(everyKm))} km`);
    if (useCal && Number(everyMonths) > 0) {
      const d = new Date(`${TODAY}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + Number(everyMonths));
      parts.push(fmtDateEAT(d.toISOString()));
    }
    if (parts.length === 0 && useHours) parts.push(`${fmtNum((v.engineHours ?? 0) + Number(everyHours))} eng-h`);
    return parts.length ? `Next due ≈ ${parts.join(' or ')} — whichever first` : 'Enable at least one trigger';
  })();

  const input = 'h-9 rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const triggerRow = (on: boolean, set: (b: boolean) => void, val: string, setVal: (s: string) => void, label: string, unit: string) => (
    <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2', on ? 'border-accent bg-accent-soft/40' : 'border-border')}>
      <button type="button" onClick={() => set(!on)}
        className={cn('flex h-5 w-9 items-center rounded-full px-0.5 transition-colors', on ? 'bg-accent justify-end' : 'bg-inactive-soft justify-start')}>
        <span className="h-4 w-4 rounded-full bg-white shadow-card" />
      </button>
      <span className="text-[13px] text-ink-600">{label}</span>
      <input value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))} disabled={!on}
        className={cn(input, 'h-8 w-24 text-center font-mono disabled:opacity-40')} />
      <span className="text-[13px] text-ink-600">{unit}</span>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} wide title="New preventive schedule"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!v || (!useKm && !useHours && !useCal)}
            onClick={() => {
              if (!v) return;
              onSave({
                vehicleId: v.id, name: name.trim() || 'Service',
                type: useKm ? 'odometer' : useCal ? 'calendar' : 'engine-hours',
                intervalKm: useKm ? Number(everyKm) : undefined,
                intervalHours: useHours ? Number(everyHours) : undefined,
                intervalDays: useCal ? Number(everyMonths) * 30 : undefined,
                lastDoneAt: TODAY, lastDoneKm: v.odometerKm,
                nextDueKm: useKm ? v.odometerKm + Number(everyKm) : undefined,
                nextDueAt: useCal ? addDaysISOAt(TODAY, Number(everyMonths) * 30) : undefined,
              });
            }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Create schedule</button>
        </>
      }>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Vehicle</span>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={input}>
              <option value="">— select —</option>
              {vehicles.map((x) => <option key={x.id} value={x.id}>{x.plate} · {x.model}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Service type</span>
            <select value={name} onChange={(e) => setName(e.target.value)} className={input}>
              {['Oil & filter service', 'Full 10,000 km service', 'Brake inspection', 'Tyre rotation', 'Annual safety inspection'].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Trigger builder</span>
          {triggerRow(useKm, setUseKm, everyKm, setEveryKm, 'every', 'km')}
          {triggerRow(useHours, setUseHours, everyHours, setEveryHours, 'every', 'engine hours')}
          {triggerRow(useCal, setUseCal, everyMonths, setEveryMonths, 'every', 'months')}
        </div>
        <div className="flex items-center gap-2 text-[13px] text-ink-600">
          <span>remind</span>
          <input value={remindKm} onChange={(e) => setRemindKm(e.target.value.replace(/\D/g, ''))} className={cn(input, 'h-8 w-20 text-center font-mono')} />
          <span>km /</span>
          <input value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/\D/g, ''))} className={cn(input, 'h-8 w-16 text-center font-mono')} />
          <span>days before</span>
        </div>
        {preview && (
          <p className="rounded-lg bg-navy-900 px-3 py-2 font-mono text-[12px] font-semibold text-accent-on-navy">{preview}</p>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- DTC drawer ---------------- */

function DtcDrawer({ dtc, vehicles, workOrders, onClose, onSetStatus }: {
  dtc: DtcRow | null; vehicles: Vehicle[]; workOrders: WorkOrder[];
  onClose: () => void;
  onSetStatus: (id: string, s: DtcRow['status'], note?: string) => void;
}) {
  const navigate = useNavigate();
  const [clearOpen, setClearOpen] = useState(false);
  const [clearNote, setClearNote] = useState('');
  if (!dtc) return <Drawer open={!!dtc} onClose={onClose} title="Fault code"><div /></Drawer>;
  const v = vehicles.find((x) => x.id === dtc.vehicleId);
  const ff = freezeFrame(dtc);
  const linkedWos = workOrders.filter((w) => w.vehicleId === dtc.vehicleId && w.title.includes(dtc.code));
  // deterministic 14-day occurrence dot plot
  const dots = Array.from({ length: 14 }, (_, i) => (hashStr(`${dtc.id}-${i}`) % 10) < (dtc.status === 'cleared' ? 2 : 5));

  return (
    <Drawer open={!!dtc} onClose={onClose} width={500}
      title={
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-navy-900 px-2 py-1 font-mono text-[13px] font-semibold text-white">{dtc.code}</span>
          <span>{dtc.description}</span>
        </div>
      }>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={SEVERITY_TO_KEY[dtc.severity]} label={`${dtc.severity} severity`} />
          {v && <PlateTag plate={v.plate} />}
          <span className="font-mono text-micro text-ink-400">first seen {fmtDateTimeEAT(dtc.firstSeen)} · ×{dtc.occurrences}</span>
        </div>

        <p className="rounded-lg bg-surface-muted px-3 py-2 text-[13px] leading-5 text-ink-600">{dtc.action}</p>

        {/* occurrence timeline */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Occurrences — last 14 days</div>
          <div className="flex items-end gap-1.5">
            {dots.map((on, i) => (
              <motion.span key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.03, duration: 0.2 }}
                title={`${addDaysISO(i - 13)}`}
                className={cn('h-3 w-3 rounded-full', on ? 'bg-alert' : 'bg-surface-muted')} />
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-micro text-ink-400">
            <span>{fmtDateEAT(addDaysISO(-13))}</span><span>today</span>
          </div>
        </div>

        {/* freeze frame */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Freeze frame — first occurrence</div>
          <div className="grid grid-cols-3 gap-2">
            {([
              ['RPM', fmtNum(ff.rpm)],
              ['Speed', `${ff.speedKmh} km/h`],
              ['Coolant', `${ff.coolantC} °C`],
              ['Engine load', `${ff.loadPct}%`],
              ['Fuel trim', `${ff.fuelTrimPct}%`],
              ['Battery', `${ff.batteryV} V`],
            ] as const).map(([k, val], i) => (
              <motion.div key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                className="rounded-lg border border-border px-3 py-2">
                <div className="text-micro uppercase tracking-[0.06em] text-ink-400">{k}</div>
                <div className="font-mono text-[13px] font-semibold text-ink-900">{val}</div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* linked WOs */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Linked work orders</div>
          {linkedWos.length === 0 && <p className="text-[12px] text-ink-400">None yet.</p>}
          {linkedWos.map((w) => (
            <button key={w.id} type="button" onClick={() => navigate('/maintenance')}
              className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-muted">
              <span className="font-mono text-[12px] font-semibold text-accent-strong">{w.number}</span>
              <span className="flex-1 truncate px-2 text-[12px] text-ink-600">{w.title}</span>
              <StatusPill status={w.status === 'done' ? 'ok' : 'info'} label={w.status} />
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          {dtc.status === 'active' && (
            <button type="button" onClick={() => onSetStatus(dtc.id, 'acknowledged')}
              className="h-9 flex-1 rounded-lg border border-border text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
              Acknowledge
            </button>
          )}
          {dtc.status !== 'wo-open' && dtc.status !== 'cleared' && (
            <button type="button"
              onClick={() => navigate('/maintenance', { state: { newWo: { vehicleId: dtc.vehicleId, source: 'dtc' as const, title: `DTC ${dtc.code} — ${dtc.description}` } } })}
              className="h-9 flex-1 rounded-lg bg-accent text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
              Create WO
            </button>
          )}
          {dtc.status !== 'cleared' && (
            <button type="button" onClick={() => setClearOpen(true)}
              className="h-9 flex-1 rounded-lg border border-alert text-[13px] font-semibold text-alert hover:bg-alert-soft">
              Clear code
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog open={clearOpen} onClose={() => setClearOpen(false)} confirmLabel="Clear code"
        title={`Clear ${dtc.code}?`}
        body={
          <div className="flex flex-col gap-2">
            <p>Verify with a technician that the fault is resolved before clearing. This is audit-logged.</p>
            <textarea value={clearNote} onChange={(e) => setClearNote(e.target.value)} rows={2}
              placeholder="Technician note (required)…"
              className="rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-accent" />
          </div>
        }
        onConfirm={() => {
          if (!clearNote.trim()) {
            toast({ title: 'Note required', body: 'Add a technician note to clear a code.', status: 'warn' });
            return;
          }
          onSetStatus(dtc.id, 'cleared', clearNote.trim());
          setClearNote('');
          onClose();
        }} />
    </Drawer>
  );
}

/* ---------------- main page ---------------- */

export default function Schedules() {
  const navigate = useNavigate();
  const vehicles = useCollection('vehicles');
  const schedules = useCollection('schedules');
  const workOrders = useCollection('workOrders');
  const alerts = useCollection('alerts');
  const [dtcState, setDtcState] = useLocalKV<Record<string, DtcRow['status']>>('dtcState', {});
  const [paused, setPaused] = useLocalKV<Record<string, boolean>>('schedPaused', {});

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'due-soon' | 'on-track'>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [markDone, setMarkDone] = useState<MaintenanceSchedule | null>(null);
  const [dtcSel, setDtcSel] = useState<DtcRow | null>(null);
  const [dtcStatusF, setDtcStatusF] = useState<'all' | DtcRow['status']>('all');
  const [dtcQ, setDtcQ] = useState('');

  const dtcs = useMemo(
    () => deriveDtcLog(vehicles, alerts, workOrders).map((d) => ({ ...d, status: dtcState[d.id] ?? d.status })),
    [vehicles, alerts, workOrders, dtcState],
  );

  const vById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);

  const rows = useMemo(() => {
    return schedules.filter((s) => !paused[s.id]).filter((s) => {
      const v = vById.get(s.vehicleId);
      const st = scheduleStatus(scheduleDue(s, v)).label;
      if (statusFilter === 'overdue' && st !== 'overdue' && st !== 'due-now') return false;
      if (statusFilter === 'due-soon' && st !== 'due-soon') return false;
      if (statusFilter === 'on-track' && st !== 'on-track') return false;
      if (q.trim()) {
        const hay = `${v?.plate ?? ''} ${v?.model ?? ''} ${s.name}`.toLowerCase();
        if (!hay.includes(q.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [schedules, paused, vById, statusFilter, q]);

  const kpis = useMemo(() => {
    const active = schedules.filter((s) => !paused[s.id]);
    let dueNow = 0, dueSoon = 0, onTrack = 0;
    for (const s of active) {
      const st = scheduleStatus(scheduleDue(s, vById.get(s.vehicleId))).label;
      if (st === 'overdue' || st === 'due-now') dueNow++;
      else if (st === 'due-soon') dueSoon++;
      else onTrack++;
    }
    const compliance = active.length ? Math.round((onTrack / active.length) * 100) : 100;
    return { dueNow, dueSoon, onTrack, compliance };
  }, [schedules, paused, vById]);

  const setDtcStatus = (id: string, s: DtcRow['status'], note?: string) => {
    setDtcState({ ...dtcState, [id]: s });
    const d = dtcs.find((x) => x.id === id);
    auditLog('update', 'alerts', id, `DTC ${d?.code ?? id} → ${s}${note ? ` (${note})` : ''}`);
    toast({ title: `DTC ${s === 'cleared' ? 'cleared' : 'acknowledged'}`, body: d ? `${d.code} — ${d.description}` : id, status: s === 'cleared' ? 'ok' : 'info' });
    setDtcSel((cur) => (cur && cur.id === id ? { ...cur, status: s } : cur));
  };

  const columns: Column<MaintenanceSchedule>[] = [
    {
      key: 'veh', header: 'Vehicle', render: (s) => {
        const v = vById.get(s.vehicleId);
        return v ? (
          <span className="flex items-center gap-2">
            <PlateTag plate={v.plate} />
            <span className="text-ink-600">{v.make} {v.model.split(' ').slice(1).join(' ')}</span>
          </span>
        ) : '—';
      },
    },
    {
      key: 'svc', header: 'Service type', render: (s) => {
        const I = SERVICE_ICON[s.type] ?? Wrench;
        return <span className="flex items-center gap-2 font-medium"><I size={14} className="text-ink-400" />{s.name}</span>;
      },
    },
    {
      key: 'trig', header: 'Triggers', render: (s) => (
        <span className="flex flex-col gap-0.5">
          {s.intervalKm && <span className="font-mono text-[11px] text-ink-600">every {fmtNum(s.intervalKm)} km</span>}
          {s.intervalKm && <span className="font-mono text-[11px] text-ink-400">≈ every {fmtNum(Math.round(s.intervalKm / 40 / 10) * 10)} eng-h</span>}
          {s.intervalDays && <span className="font-mono text-[11px] text-ink-600">every {Math.round(s.intervalDays / 30)} mo</span>}
        </span>
      ),
    },
    {
      key: 'last', header: 'Last done', render: (s) => (
        <span className="font-mono text-[12px] text-ink-600">{fmtDateEAT(s.lastDoneAt)} · {fmtKm(s.lastDoneKm)}</span>
      ),
    },
    {
      key: 'next', header: 'Next due', mono: true, render: (s) => {
        const due = scheduleDue(s, vById.get(s.vehicleId));
        if (!due) return '—';
        return due.kind === 'km' ? fmtKm(due.dueKm) : fmtDateEAT(due.dueAt);
      },
    },
    { key: 'rem', header: 'Remaining', render: (s) => <RemainingCell s={s} v={vById.get(s.vehicleId)} /> },
    {
      key: 'remind', header: 'Auto-reminder', align: 'center', render: (s) => {
        const due = scheduleDue(s, vById.get(s.vehicleId));
        const firedKm = due?.kind === 'km' && due.remainingKm <= 500;
        const firedD = due?.kind === 'days' && due.remainingDays <= 7;
        const fired = firedKm || firedD;
        return (
          <span className="inline-flex items-center gap-1.5" title="Fires at 500 km / 7 d before due">
            {fired
              ? <BellRing size={14} className="text-warn" />
              : <Bell size={14} className="text-ink-400" />}
            {fired && (
              <span className="font-mono text-[10px] font-semibold text-ok-on-soft">
                {firedKm ? '500km ✓' : '7d ✓'}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  const dtcRows = dtcs.filter((d) => {
    if (dtcStatusF !== 'all' && d.status !== dtcStatusF) return false;
    if (dtcQ.trim()) {
      const v = vById.get(d.vehicleId);
      const hay = `${d.code} ${d.description} ${v?.plate ?? ''}`.toLowerCase();
      if (!hay.includes(dtcQ.trim().toLowerCase())) return false;
    }
    return true;
  });

  const dtcColumns: Column<DtcRow>[] = [
    {
      key: 'sev', header: '', width: '24px', render: (d) => (
        <span className={cn('inline-block h-2.5 w-2.5 rounded-full',
          d.severity === 'critical' ? 'bg-alert' : d.severity === 'major' ? 'bg-warn' : 'bg-info')} title={d.severity} />
      ),
    },
    { key: 'code', header: 'DTC', render: (d) => <span className="rounded-md bg-navy-900 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-white">{d.code}</span> },
    { key: 'desc', header: 'Description', render: (d) => d.description },
    { key: 'veh', header: 'Vehicle', render: (d) => { const v = vById.get(d.vehicleId); return v ? <PlateTag plate={v.plate} /> : '—'; } },
    { key: 'first', header: 'First seen', mono: true, render: (d) => fmtDateTimeEAT(d.firstSeen).replace(', ', ' ') },
    { key: 'occ', header: 'Occurrences', mono: true, align: 'center', render: (d) => `×${d.occurrences}` },
    {
      key: 'status', header: 'Status', render: (d) => {
        const meta: Record<DtcRow['status'], { k: StatusKey; l: string }> = {
          active: { k: 'alert', l: 'ACTIVE' }, acknowledged: { k: 'warn', l: 'ACKNOWLEDGED' },
          cleared: { k: 'ok', l: 'CLEARED' }, 'wo-open': { k: 'info', l: 'WO OPEN' },
        };
        return (
          <span className="flex items-center gap-1.5">
            <StatusPill status={meta[d.status].k} label={meta[d.status].l} />
            {d.status === 'wo-open' && d.woNumber && <span className="font-mono text-micro text-accent-strong">{d.woNumber}</span>}
          </span>
        );
      },
    },
    { key: 'action', header: 'Recommended action', render: (d) => <span className="text-ink-600">{d.action}</span> },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="mx-auto flex max-w-[1520px] flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Preventive Schedules & DTC</h1>
          <div className="mt-1"><MaintSubNav active="schedules" /></div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => exportXlsx('pm-schedules.xlsx', rows.map((s) => ({
              Vehicle: vById.get(s.vehicleId)?.plate ?? '', Service: s.name,
              'Interval (km)': s.intervalKm ?? '', 'Interval (days)': s.intervalDays ?? '',
              'Last done': fmtDateEAT(s.lastDoneAt), 'Last done (km)': s.lastDoneKm,
              'Next due (km)': s.nextDueKm ?? '', 'Next due (date)': s.nextDueAt ?? '',
            })), 'PM schedules')}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={15} /> Export Excel
          </button>
          <button type="button" onClick={() => setNewOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
            <Plus size={15} /> New schedule
          </button>
        </div>
      </div>

      {/* SECTION 1 — PM schedules */}
      <section className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KPIStatCard label="Due now" value={kpis.dueNow} icon={BellRing} delta={kpis.dueNow > 0 ? 'action needed' : undefined} deltaGood={false} sparkColor="#DC2626" spark={[0, 1, 1, 2, 1, 2, kpis.dueNow]} />
          <KPIStatCard label="Due ≤ 7 days" value={kpis.dueSoon} icon={Bell} sparkColor="#F59E0B" spark={[1, 2, 2, 3, 3, 2, kpis.dueSoon]} />
          <KPIStatCard label="On track" value={kpis.onTrack} icon={CheckCheck} spark={[6, 7, 8, 8, 9, 9, kpis.onTrack]} />
          <div className="flex items-center gap-3 rounded-card border border-border bg-white p-4 shadow-card">
            <ScoreRing score={kpis.compliance} size={56} stroke={6} />
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Compliance 90d</div>
              <div className="text-[13px] text-ink-600">services done on time</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vehicle or service…"
              className="h-9 w-60 rounded-lg border border-border bg-white pl-8 pr-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          </div>
          {([['all', 'All'], ['overdue', 'Due now / overdue'], ['due-soon', 'Due ≤ 7 d'], ['on-track', 'On track']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatusFilter(k)}
              className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', statusFilter === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
              {l}
            </button>
          ))}
        </div>

        <DataTable<MaintenanceSchedule> columns={columns} rows={rows} pageSize={14}
          rowActions={(s) => [
            {
              label: 'Create WO now', icon: Wrench, onClick: () => navigate('/maintenance', {
                state: { newWo: { vehicleId: s.vehicleId, source: 'schedule' as const, title: `${s.name} — preventive service` } },
              }),
            },
            { label: 'Mark done', icon: Check, onClick: () => setMarkDone(s) },
            {
              label: 'Pause schedule', icon: Pause, onClick: () => {
                setPaused({ ...paused, [s.id]: true });
                toast({ title: 'Schedule paused', body: s.name, status: 'inactive' });
              },
            },
          ]} />
      </section>

      {/* SECTION 2 — DTC */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-[18px] font-bold leading-[26px] tracking-[-0.01em] text-ink-900">Fault codes (DTC)</h2>
            <span className="flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-micro font-semibold text-accent-strong">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute h-full w-full rounded-full bg-accent animate-pulse-live-ring" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <Radio size={11} /> Streaming from telematics SIM
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input value={dtcQ} onChange={(e) => setDtcQ(e.target.value)} placeholder="Search code or plate…"
                className="h-8 w-52 rounded-lg border border-border bg-white pl-8 pr-3 text-[12px] outline-none focus:border-accent" />
            </div>
            {(['all', 'active', 'acknowledged', 'wo-open', 'cleared'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setDtcStatusF(s)}
                className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', dtcStatusF === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
                {s === 'all' ? 'Any status' : s === 'wo-open' ? 'WO open' : s}
              </button>
            ))}
            <button type="button"
              onClick={() => exportXlsx('dtc-log.xlsx', dtcRows.map((d) => ({
                Code: d.code, Description: d.description, Vehicle: vById.get(d.vehicleId)?.plate ?? '',
                Severity: d.severity, 'First seen': fmtDateTimeEAT(d.firstSeen), Occurrences: d.occurrences,
                Status: d.status, WO: d.woNumber ?? '',
              })), 'DTC log')}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[12px] font-semibold text-ink-600 hover:bg-surface-muted">
              <Download size={13} /> dtc-log.xlsx
            </button>
          </div>
        </div>

        <DataTable<DtcRow> columns={dtcColumns} rows={dtcRows} pageSize={10}
          onRowClick={(d) => setDtcSel(d)}
          rowActions={(d) => [
            ...(d.status === 'active' ? [{ label: 'Acknowledge', icon: Check, onClick: () => setDtcStatus(d.id, 'acknowledged') }] : []),
            ...(d.status !== 'wo-open' && d.status !== 'cleared' ? [{
              label: 'Create WO', icon: Wrench, onClick: () => navigate('/maintenance', {
                state: { newWo: { vehicleId: d.vehicleId, source: 'dtc' as const, title: `DTC ${d.code} — ${d.description}` } },
              }),
            }] : []),
            { label: 'Open detail', icon: Info, onClick: () => setDtcSel(d) },
          ]} />
      </section>

      <NewScheduleModal open={newOpen} vehicles={vehicles} onClose={() => setNewOpen(false)}
        onSave={(rec) => {
          add('schedules', { ...rec, id: `sch-${Date.now().toString(36)}` });
          auditLog('create', 'schedules', rec.vehicleId, `Created schedule "${rec.name}"`);
          toast({ title: 'Schedule created', body: rec.name, status: 'ok' });
          setNewOpen(false);
        }} />
      <MarkDoneModal s={markDone} v={vById.get(markDone?.vehicleId ?? '')} onClose={() => setMarkDone(null)} />
      <DtcDrawer dtc={dtcSel} vehicles={vehicles} workOrders={workOrders} onClose={() => setDtcSel(null)} onSetStatus={setDtcStatus} />
    </motion.div>
  );
}
