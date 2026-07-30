// FBV FleetOS — /dispatch — job board, list & map views (dispatch.md §A).

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle2, Clock, Download, GripVertical, LayoutGrid, List, Map as MapIcon,
  Package, Plus, Trash2, Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { add, kvGet, kvSet, nextSequence, update, useCollection, useKV, useLivePositions } from '@/lib/store';
import type { Driver, Job, JobStop, Vehicle } from '@/lib/types';
import { avatarTint, fmtDateTimeEAT, fmtNum, fmtTimeEAT, initials } from '@/lib/format';
import { DataTable, KPIStatCard, Modal, PlateTag, StatusPill, toast } from '@/components/shared';
import type { Column } from '@/components/shared';
import {
  Btn, Card, DEMO_NOW_ISO, EASE, MiniMap, PageHeader, PageShell, downloadSheet,
  hash01, isoDaysAgo, jobDistanceKm, jobDurationMin, jobEta, jobProgress, jobStopsSummary,
} from './ops-shared';

/* ------------------------------------------------------------------ */
/* Job extras in kv (priority) + notifications                         */
/* ------------------------------------------------------------------ */

export type JobPriority = 'low' | 'normal' | 'high';
export interface JobNotification { id: string; jobId: string; channel: 'SMS' | 'EMAIL'; text: string; at: string; status: 'sent' | 'delivered' }

export function getJobPriorities(): Record<string, JobPriority> {
  return (kvGet('job-priorities' as never) as unknown as Record<string, JobPriority>) ?? {};
}
export function setJobPriority(jobId: string, p: JobPriority) {
  kvSet('job-priorities' as never, { ...getJobPriorities(), [jobId]: p } as never);
}
export function getJobNotifications(): JobNotification[] {
  return (kvGet('job-notifications' as never) as unknown as JobNotification[]) ?? [];
}
export function pushJobNotification(n: Omit<JobNotification, 'id'>) {
  const arr = getJobNotifications();
  kvSet('job-notifications' as never, [...arr, { ...n, id: `ntf-${Date.now().toString(36)}-${arr.length}` }] as never);
}

export const PRIORITY_DOT: Record<JobPriority, string> = {
  high: 'bg-alert', normal: 'bg-warn', low: 'bg-inactive',
};

function defaultPriority(job: Job): JobPriority {
  const stored = getJobPriorities()[job.id];
  if (stored) return stored;
  const h = hash01(job.id + 'pri');
  return h > 0.72 ? 'high' : h > 0.3 ? 'normal' : 'low';
}

export function auditJob(jobId: string, summary: string) {
  add('audit', {
    id: '', at: DEMO_NOW_ISO, userId: 'usr-03', userName: 'Brian Kibe', action: 'update',
    collection: 'jobs', recordId: jobId, summary,
  });
}

/* ------------------------------------------------------------------ */
/* Board page                                                          */
/* ------------------------------------------------------------------ */

const COLUMNS: { key: Job['status']; label: string }[] = [
  { key: 'draft', label: 'New' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'en-route', label: 'En route' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'delivered', label: 'Delivered' },
];

export default function DispatchBoardPage() {
  const jobs = useCollection('jobs');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const priorities = (useKV('job-priorities' as never) as unknown as Record<string, JobPriority>) ?? {};
  const notifications = (useKV('job-notifications' as never) as unknown as JobNotification[]) ?? [];
  const [view, setView] = useState<'board' | 'list' | 'map'>('board');
  const [newOpen, setNewOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [fDriver, setFDriver] = useState('');
  const [fVehicle, setFVehicle] = useState('');
  const navigate = useNavigate();

  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const drvById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const visible = useMemo(() => jobs
    .filter((j) => !fDriver || j.driverId === fDriver)
    .filter((j) => !fVehicle || j.vehicleId === fVehicle),
    [jobs, fDriver, fVehicle]);

  const active = jobs.filter((j) => !['delivered', 'cancelled'].includes(j.status));
  const deliveredToday = jobs.filter((j) => j.status === 'delivered' && (j.pod ? j.pod.at.slice(0, 10) === '2026-07-28' : j.scheduledAt.slice(0, 10) === '2026-07-28'));
  const awaitingPod = jobs.filter((j) => j.status === 'arrived' && !j.pod);
  const delivered = jobs.filter((j) => j.status === 'delivered');
  const onTimePct = delivered.length
    ? Math.round((delivered.filter((j) => !j.pod || Date.parse(j.pod.at) <= Date.parse(j.scheduledAt) + 12 * 3600e3).length / delivered.length) * 100)
    : 100;

  /** dispatcher-side status transition with rules */
  const moveJob = (job: Job, to: Job['status']) => {
    if (job.status === to) return;
    if (to === 'assigned' && (!job.vehicleId || !job.driverId)) {
      setAssignFor(job.id);
      return;
    }
    if (to === 'delivered' && !job.pod) {
      toast({ title: 'POD required', body: 'Waiting for driver capture on mobile — /dispatch/:id/run', status: 'warn' });
      return;
    }
    const idx = COLUMNS.findIndex((c) => c.key === job.status);
    const targetIdx = COLUMNS.findIndex((c) => c.key === to);
    if (to !== 'cancelled' && Math.abs(targetIdx - idx) > 1) {
      toast({ title: 'Step through statuses in order', body: 'Jobs move one column at a time.', status: 'inactive' });
      return;
    }
    applyStatus(job, to);
  };

  const applyStatus = (job: Job, to: Job['status']) => {
    const patch: Partial<Job> = { status: to };
    if (to === 'arrived') {
      const stops = [...job.stops];
      const nextStop = stops.find((s) => !s.arrivedAt);
      if (nextStop) {
        nextStop.arrivedAt = DEMO_NOW_ISO;
        patch.stops = stops;
      }
    }
    if (to === 'delivered') {
      patch.stops = job.stops.map((s) => ({ ...s, arrivedAt: s.arrivedAt ?? DEMO_NOW_ISO, completedAt: s.completedAt ?? DEMO_NOW_ISO }));
    }
    update('jobs', job.id, patch);
    auditJob(job.id, `Job ${job.number} → ${to}`);
    if (to === 'delivered') {
      pushJobNotification({ jobId: job.id, channel: 'SMS', text: `Delivered — ${job.customer} · POD captured`, at: DEMO_NOW_ISO, status: 'delivered' });
    }
    toast({ title: `${job.number} → ${COLUMNS.find((c) => c.key === to)?.label ?? to}`, status: 'ok' });
  };

  const exportJobs = () => {
    downloadSheet(visible.map((j) => ({
      Job: j.number, Status: j.status, Priority: priorities[j.id] ?? defaultPriority(j), Customer: j.customer,
      Stops: j.stops.length, Vehicle: j.vehicleId ? vehById.get(j.vehicleId)?.plate ?? '' : '',
      Driver: j.driverId ? drvById.get(j.driverId)?.name ?? '' : '',
      Scheduled: fmtDateTimeEAT(j.scheduledAt), ETA: jobEta(j),
      POD: j.pod ? 'captured' : 'pending',
      Notifications: notifications.filter((n) => n.jobId === j.id).length,
    })), 'dispatch-jul-2026.xlsx', 'Dispatch');
    toast({ title: 'Export started', body: 'dispatch-jul-2026.xlsx', status: 'ok' });
  };

  return (
    <PageShell>
      <PageHeader title="Dispatch" sub="Jobs, route optimization & proof of delivery"
        actions={<>
          {/* view toggle */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-white p-0.5 shadow-card">
            {([['board', LayoutGrid, 'Board'], ['list', List, 'List'], ['map', MapIcon, 'Map']] as const).map(([k, Icon, label]) => (
              <button key={k} type="button" onClick={() => setView(k)}
                className={cn('flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors',
                  view === k ? 'bg-navy-900 text-white' : 'text-ink-600 hover:bg-surface-muted')}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <Btn icon={Plus} onClick={() => setNewOpen(true)}>New job</Btn>
          <Btn icon={Download} variant="ghost" onClick={exportJobs}>Export</Btn>
        </>} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KPIStatCard label="Active" value={active.length} icon={Truck} onClick={() => setView('board')} />
        <KPIStatCard label="Delivered today" value={deliveredToday.length} icon={CheckCircle2} delta="on plan" deltaGood />
        <KPIStatCard label="On-time" value={onTimePct} format={(v) => `${Math.round(v)}%`} icon={Clock} deltaGood={onTimePct >= 90} delta="last 12 h window" />
        <KPIStatCard label="Awaiting POD" value={awaitingPod.length} icon={Package} deltaGood={awaitingPod.length === 0}
          delta={awaitingPod.length ? 'driver capture pending' : 'clear'} sparkColor="#F59E0B" />
      </div>

      {/* shared filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={fVehicle} onChange={(e) => setFVehicle(e.target.value)}
          className="h-8 rounded-lg border border-border bg-white px-2 text-[13px] outline-none focus:border-accent">
          <option value="">All vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
        </select>
        <select value={fDriver} onChange={(e) => setFDriver(e.target.value)}
          className="h-8 rounded-lg border border-border bg-white px-2 text-[13px] outline-none focus:border-accent">
          <option value="">All drivers</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {view === 'board' && (
        <BoardView jobs={visible} vehById={vehById} drvById={drvById} priorities={priorities}
          onMove={moveJob} onOpen={(id) => navigate(`/dispatch/${id}`)} />
      )}
      {view === 'list' && (
        <ListView jobs={visible} vehById={vehById} drvById={drvById} priorities={priorities}
          notifications={notifications} onOpen={(id) => navigate(`/dispatch/${id}`)} onMove={moveJob} />
      )}
      {view === 'map' && (
        <MapView jobs={visible.filter((j) => !['delivered', 'cancelled'].includes(j.status))}
          vehById={vehById} drvById={drvById} priorities={priorities} onOpen={(id) => navigate(`/dispatch/${id}`)} />
      )}

      <NewJobModal open={newOpen} vehicles={vehicles} drivers={drivers} onClose={() => setNewOpen(false)}
        onCreated={(id) => { setNewOpen(false); navigate(`/dispatch/${id}`); }} />

      {assignFor && (
        <AssignModal job={jobs.find((j) => j.id === assignFor)!} vehicles={vehicles} drivers={drivers}
          onClose={() => setAssignFor(null)}
          onAssign={(vehId, drvId) => {
            const job = jobs.find((j) => j.id === assignFor)!;
            update('jobs', job.id, { vehicleId: vehId, driverId: drvId, status: 'assigned' });
            auditJob(job.id, `Job ${job.number} assigned → ${vehById.get(vehId)?.plate} / ${drvById.get(drvId)?.name}`);
            pushJobNotification({ jobId: job.id, channel: 'SMS', text: `Delivery scheduled — ${job.customer}`, at: DEMO_NOW_ISO, status: 'sent' });
            setAssignFor(null);
            toast({ title: `${job.number} assigned`, status: 'ok' });
          }} />
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Board view                                                          */
/* ------------------------------------------------------------------ */

function BoardView({ jobs, vehById, drvById, priorities, onMove, onOpen }: {
  jobs: Job[]; vehById: Map<string, Vehicle>; drvById: Map<string, Driver>;
  priorities: Record<string, JobPriority>;
  onMove: (job: Job, to: Job['status']) => void; onOpen: (id: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [deliveredOpen, setDeliveredOpen] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {COLUMNS.map((col, ci) => {
        const colJobs = jobs.filter((j) => j.status === col.key);
        const collapsed = col.key === 'delivered' && !deliveredOpen;
        return (
          <motion.div key={col.key}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ci * 0.08, duration: 0.3, ease: EASE }}
            onDragOver={(e) => { e.preventDefault(); setOverCol(col.key); }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              const job = jobs.find((j) => j.id === dragId);
              if (job) onMove(job, col.key);
              setDragId(null); setOverCol(null);
            }}
            className={cn('flex min-h-[220px] flex-col gap-2 rounded-card border p-2 transition-colors',
              overCol === col.key && dragId ? 'border-accent bg-accent-soft/30' : 'border-border bg-surface-muted/60')}>
            <button type="button"
              onClick={() => col.key === 'delivered' && setDeliveredOpen(!deliveredOpen)}
              className="flex items-center justify-between px-1.5 py-1 text-left">
              <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-600">{col.label}</span>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-ink-600 shadow-card">
                {col.key === 'delivered' ? `today, ${colJobs.length}` : colJobs.length}
              </span>
            </button>
            {collapsed ? (
              <div className="rounded-lg border border-dashed border-border bg-white/60 px-3 py-4 text-center text-[12px] text-ink-400">
                {colJobs.length} delivered — click count to expand
              </div>
            ) : (
              <>
                {colJobs.map((job, ji) => (
                  <JobCard key={job.id} job={job} idx={ji}
                    vehicle={job.vehicleId ? vehById.get(job.vehicleId) : undefined}
                    driver={job.driverId ? drvById.get(job.driverId) : undefined}
                    priority={priorities[job.id] ?? defaultPriority(job)}
                    dragging={dragId === job.id}
                    onDragStart={() => setDragId(job.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onOpen={() => onOpen(job.id)} />
                ))}
                {colJobs.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-[12px] text-ink-400">
                    Drop jobs here
                  </div>
                )}
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export function JobCard({ job, vehicle, driver, priority, dragging, onDragStart, onDragEnd, onOpen, idx = 0 }: {
  job: Job; vehicle?: Vehicle; driver?: Driver; priority: JobPriority;
  dragging?: boolean; idx?: number;
  onDragStart?: () => void; onDragEnd?: () => void; onOpen?: () => void;
}) {
  const sum = jobStopsSummary(job);
  const km = jobDistanceKm(job);
  const dur = jobDurationMin(job);
  const progress = jobProgress(job);
  const unassigned = !job.vehicleId || !job.driverId;
  const atRisk = job.status === 'en-route' && hash01(job.id + 'risk') > 0.6;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: dragging ? 0.55 : 1, y: 0 }}
      transition={{ delay: idx * 0.04, duration: 0.25, ease: EASE }}
      draggable={!!onDragStart}
      onDragStart={(e) => { (e as unknown as React.DragEvent).dataTransfer?.setData('text/plain', job.id); onDragStart?.(); }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-card border bg-white p-3.5 shadow-card transition-all duration-150',
        'hover:-translate-y-0.5 hover:shadow-pop',
        unassigned ? 'border-dashed border-ink-400/50' : 'border-border',
        dragging && 'shadow-pop',
      )}>
      <div className="flex items-center gap-2">
        <GripVertical size={13} className="shrink-0 text-ink-400/0 transition-colors group-hover:text-ink-400" />
        <span className="font-mono text-[12px] font-semibold tracking-[0.02em] text-ink-900">{job.number}</span>
        <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[priority])} title={`${priority} priority`} />
        {job.status === 'arrived' && !job.pod && (
          <span className="ml-auto rounded-full bg-warn-soft px-1.5 py-0.5 text-micro font-semibold text-warn-on-soft">POD pending</span>
        )}
      </div>
      <div className="mt-1 text-[14px] font-semibold leading-5 text-ink-900">{job.customer}</div>
      <div className="mt-1.5 flex items-center gap-1 text-[12px] text-ink-600">
        <span className="rounded bg-surface-muted px-1.5 py-0.5">{sum.origin}</span>
        <span className="text-ink-400">→ {sum.middle > 0 ? `${sum.middle} stop${sum.middle > 1 ? 's' : ''} →` : '→'}</span>
        <span className="rounded bg-surface-muted px-1.5 py-0.5">{sum.dest}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-ink-400">{fmtNum(km)} km · ~{Math.floor(dur / 60)} h {String(dur % 60).padStart(2, '0')} m</div>
      <div className="mt-2 flex items-center gap-2">
        {vehicle ? <PlateTag plate={vehicle.plate} /> : <span className="text-[12px] italic text-ink-400">unassigned</span>}
        {driver && (
          <span className="flex items-center gap-1.5 text-[12px] text-ink-600">
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold', avatarTint(driver.name))}>{initials(driver.name)}</span>
            {driver.name.split(' ')[0]}
          </span>
        )}
        <span className={cn('ml-auto font-mono text-[11px]', atRisk ? 'font-semibold text-alert' : 'text-ink-400')}>
          {job.status === 'delivered' ? `Delivered ${job.pod ? fmtTimeEAT(job.pod.at) : ''}` : `Deliver by ${fmtTimeEAT(job.scheduledAt)}`}
        </span>
      </div>
      {job.status === 'en-route' && (
        <div className="mt-2">
          <div className="flex items-center justify-between font-mono text-[10px] text-ink-400">
            <span>{Math.round(progress * 100)}% of route</span>
            <span className={cn(atRisk && 'text-warn-on-soft')}>ETA {jobEta(job)}</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-muted">
            <motion.div initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.6, ease: 'easeOut' }}
              className={cn('h-full rounded-full', atRisk ? 'bg-warn' : 'bg-accent')} />
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */

const JOB_PILL: Record<Job['status'], { status: 'ok' | 'warn' | 'alert' | 'inactive' | 'info'; label: string }> = {
  draft: { status: 'inactive', label: 'New' },
  assigned: { status: 'info', label: 'Assigned' },
  'en-route': { status: 'ok', label: 'En route' },
  arrived: { status: 'warn', label: 'Arrived' },
  delivered: { status: 'ok', label: 'Delivered' },
  cancelled: { status: 'inactive', label: 'Cancelled' },
};

function ListView({ jobs, vehById, drvById, priorities, notifications, onOpen, onMove }: {
  jobs: Job[]; vehById: Map<string, Vehicle>; drvById: Map<string, Driver>;
  priorities: Record<string, JobPriority>; notifications: JobNotification[];
  onOpen: (id: string) => void; onMove: (job: Job, to: Job['status']) => void;
}) {
  const columns: Column<Job>[] = [
    { key: 'number', header: 'Job #', mono: true, render: (j) => j.number },
    { key: 'status', header: 'Status', render: (j) => <StatusPill status={JOB_PILL[j.status].status} label={JOB_PILL[j.status].label} pulse={j.status === 'en-route'} /> },
    { key: 'priority', header: 'Priority', render: (j) => {
      const p = priorities[j.id] ?? defaultPriority(j);
      return <span className="flex items-center gap-1.5 text-[12px] capitalize"><span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[p])} />{p}</span>;
    } },
    { key: 'customer', header: 'Customer', render: (j) => <span className="font-medium">{j.customer}</span> },
    { key: 'stops', header: 'Stops', mono: true, align: 'center', render: (j) => j.stops.length },
    { key: 'vehicle', header: 'Vehicle', render: (j) => j.vehicleId && vehById.get(j.vehicleId) ? <PlateTag plate={vehById.get(j.vehicleId)!.plate} /> : <span className="italic text-ink-400">—</span> },
    { key: 'driver', header: 'Driver', render: (j) => j.driverId ? drvById.get(j.driverId)?.name ?? '—' : '—' },
    { key: 'window', header: 'Scheduled', mono: true, render: (j) => fmtDateTimeEAT(j.scheduledAt) },
    { key: 'eta', header: 'ETA / Actual', mono: true, render: (j) => j.status === 'delivered' && j.pod ? fmtTimeEAT(j.pod.at) : jobEta(j) },
    { key: 'pod', header: 'POD', align: 'center', render: (j) => j.pod
      ? <CheckCircle2 size={15} className="inline text-ok" />
      : j.status === 'arrived' ? <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-micro font-semibold text-warn-on-soft">—</span> : <span className="text-ink-400">—</span> },
    { key: 'ntf', header: 'Notifs', mono: true, align: 'center', render: (j) => notifications.filter((n) => n.jobId === j.id).length },
  ];
  return (
    <DataTable columns={columns} rows={[...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
      onRowClick={(j) => onOpen(j.id)} pageSize={14}
      rowActions={(j) => {
        const idx = COLUMNS.findIndex((c) => c.key === j.status);
        const next = COLUMNS[idx + 1];
        return [
          { label: 'Open detail', onClick: () => onOpen(j.id) },
          ...(next ? [{ label: `Advance → ${next.label}`, onClick: () => onMove(j, next.key) }] : []),
        ];
      }} />
  );
}

/* ------------------------------------------------------------------ */
/* Map view                                                            */
/* ------------------------------------------------------------------ */

function MapView({ jobs, vehById, drvById, priorities, onOpen }: {
  jobs: Job[]; vehById: Map<string, Vehicle>; drvById: Map<string, Driver>;
  priorities: Record<string, JobPriority>; onOpen: (id: string) => void;
}) {
  const positions = useLivePositions();
  const [hoverId, setHoverId] = useState<string | null>(null);

  const pins = useMemo(() => {
    const out: { lat: number; lng: number; color: string; label?: string; kind?: 'stop' | 'truck' | 'dot'; ring?: boolean }[] = [];
    for (const j of jobs) {
      j.stops.forEach((s, i) => out.push({
        lat: s.lat, lng: s.lng, label: String(i + 1), kind: 'stop',
        color: s.completedAt ? '#16A34A' : hoverId === j.id ? '#06B6D4' : '#0F2540',
        ring: hoverId === j.id,
      }));
      if (j.vehicleId) {
        const pos = positions.find((p) => p.vehicleId === j.vehicleId);
        if (pos) out.push({ lat: pos.lat, lng: pos.lng, color: '#06B6D4', kind: 'truck', label: vehById.get(j.vehicleId)?.plate, ring: hoverId === j.id });
      }
    }
    return out;
  }, [jobs, positions, hoverId, vehById]);

  const lines = useMemo(() => jobs.filter((j) => j.stops.length > 1).map((j) => ({
    pts: j.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    color: hoverId === j.id ? '#06B6D4' : '#0891B2',
    width: hoverId === j.id ? 4 : 2.5,
  })), [jobs, hoverId]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[320px,1fr]">
      <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1">
        {jobs.map((j, i) => (
          <div key={j.id} onMouseEnter={() => setHoverId(j.id)} onMouseLeave={() => setHoverId(null)}>
            <JobCard job={j} idx={i}
              vehicle={j.vehicleId ? vehById.get(j.vehicleId) : undefined}
              driver={j.driverId ? drvById.get(j.driverId) : undefined}
              priority={priorities[j.id] ?? defaultPriority(j)}
              onOpen={() => onOpen(j.id)} />
          </div>
        ))}
        {jobs.length === 0 && <div className="rounded-card border border-border bg-white p-6 text-center text-[13px] text-ink-400">No active jobs.</div>}
      </div>
      <Card pad={false} className="p-2">
        <MiniMap pins={pins} lines={lines} height={540} />
        <div className="flex items-center gap-4 px-3 py-2 text-[12px] text-ink-400">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-navy-800" /> numbered stops</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ok" /> completed stop</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> live vehicle</span>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New job modal — async nextSequence('job')                           */
/* ------------------------------------------------------------------ */

interface DraftStop { address: string; lat: number; lng: number }

function NewJobModal({ open, vehicles, drivers, onClose, onCreated }: {
  open: boolean; vehicles: Vehicle[]; drivers: Driver[];
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const geofences = useCollection('geofences');
  const [customer, setCustomer] = useState('');
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [priority, setPriority] = useState<JobPriority>('normal');
  const [saving, setSaving] = useState(false);

  const reset = () => { setCustomer(''); setStops([]); setVehicleId(''); setDriverId(''); setPriority('normal'); setSaving(false); };

  const addStop = (address: string, lat: number, lng: number) => setStops((s) => [...s, { address, lat, lng }]);

  const valid = customer.trim().length > 1 && stops.length >= 1;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const number = await nextSequence('job');
    const assigned = vehicleId && driverId;
    const jobStops: JobStop[] = stops.map((s, i) => ({
      id: `s${i + 1}`, label: `${i === 0 ? 'Pickup' : 'Drop'} — ${s.address}`, address: s.address, lat: s.lat, lng: s.lng,
    }));
    const rec = add('jobs', {
      id: '', number, customer: customer.trim(),
      vehicleId: vehicleId || null, driverId: driverId || null,
      status: assigned ? 'assigned' : 'draft',
      stops: jobStops, createdAt: DEMO_NOW_ISO, scheduledAt: isoDaysAgo(0, 17, 0),
    });
    setJobPriority(rec.id, priority);
    auditJob(rec.id, `Created job ${number} (${customer.trim()})`);
    if (assigned) {
      pushJobNotification({ jobId: rec.id, channel: 'SMS', text: `Delivery scheduled — ETA window 14:00–17:00 sent to customer`, at: DEMO_NOW_ISO, status: 'sent' });
    }
    toast({ title: `Job ${number} created`, body: assigned ? 'Assigned and customer notified.' : 'Saved as NEW — assign vehicle + driver to dispatch.', status: 'ok' });
    reset();
    onCreated(rec.id);
  };

  const inputCls = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <Modal open={open} onClose={onClose} title="New job" wide
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn icon={Plus} disabled={!valid || saving} onClick={save}>{saving ? 'Creating…' : 'Create job'}</Btn>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Customer
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Naivas Supermarkets — MSA branch" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)} className={inputCls}>
              <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Vehicle (optional — assigns immediately)
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {vehicles.filter((v) => v.tripStatus === 'active').map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Driver
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
              <option value="">Unassigned</option>
              {drivers.filter((d) => d.status !== 'on-leave').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        </div>

        {/* stops builder */}
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Stops ({stops.length})</div>
          {stops.map((s, i) => (
            <motion.div key={`${s.address}-${i}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted/50 px-3 py-2 text-[13px]">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-navy-900 font-mono text-[10px] font-bold text-white">{i + 1}</span>
              <span className="flex-1">{i === 0 ? 'Pickup' : 'Drop'} — {s.address}</span>
              <button type="button" onClick={() => setStops(stops.filter((_, k) => k !== i))} className="text-ink-400 hover:text-alert"><Trash2 size={14} /></button>
            </motion.div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            {geofences.map((gf) => (
              <button key={gf.id} type="button"
                onClick={() => addStop(gf.name, gf.center?.lat ?? gf.polygon?.[0]?.lat ?? -1.3031, gf.center?.lng ?? gf.polygon?.[0]?.lng ?? 36.8526)}
                className="rounded-full border border-border bg-white px-2.5 py-1 text-[12px] text-ink-600 hover:border-accent hover:text-accent-strong">
                + {gf.name}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-ink-400">Address autocomplete stub — stops are pinned to known hubs; first stop is the pickup.</div>
        </div>

        <div className="rounded-lg bg-surface-muted px-3 py-2 font-mono text-[11px] text-ink-600">
          Job number auto-assigned: FBV-JOB-###### (server sequence) · window defaults to Deliver by 17:00 EAT
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Assign modal (NEW → ASSIGNED rule)                                  */
/* ------------------------------------------------------------------ */

function AssignModal({ job, vehicles, drivers, onClose, onAssign }: {
  job: Job; vehicles: Vehicle[]; drivers: Driver[];
  onClose: () => void; onAssign: (vehicleId: string, driverId: string) => void;
}) {
  const [vehicleId, setVehicleId] = useState(job.vehicleId ?? '');
  const [driverId, setDriverId] = useState(job.driverId ?? '');
  const inputCls = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent';
  return (
    <Modal open onClose={onClose} title={`Assign ${job.number}`}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!vehicleId || !driverId} onClick={() => onAssign(vehicleId, driverId)}>Assign & dispatch</Btn>
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-600">Moving to ASSIGNED requires a vehicle and driver.</p>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          Vehicle
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {vehicles.filter((v) => v.tripStatus === 'active').map((v) => (
              <option key={v.id} value={v.id}>{v.plate} — {v.model}{v.status === 'moving' ? ' (busy)' : ' — available'}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          Driver
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {drivers.filter((d) => d.status !== 'on-leave').map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.status === 'off-duty' ? ' — off-duty' : ''}</option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
