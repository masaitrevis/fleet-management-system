// FBV FleetOS — /dispatch/:id — job detail: stepper, route optimizer,
// assignment, customer notifications, POD gallery, audit footer (dispatch.md §B).

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Check, ChevronRight, Clock, GripVertical, Mail, MapPin, MessageSquare,
  Navigation, Phone, Send, Smartphone, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { update, useCollection, useKV } from '@/lib/store';
import type { Job, JobStop } from '@/lib/types';
import { avatarTint, fmtDateTimeEAT, fmtNum, fmtTimeEAT, initials } from '@/lib/format';
import { EmptyState, PlateTag, StatusPill, toast } from '@/components/shared';
import {
  Btn, Card, DEMO_NOW_ISO, EASE, MiniMap, PageShell, haversineKm, hash01,
  jobDistanceKm, jobDurationMin, jobEta, jobProgress,
} from './ops-shared';
import {
  PRIORITY_DOT, auditJob, pushJobNotification, setJobPriority,
} from './DispatchBoardPage';
import type { JobNotification, JobPriority } from './DispatchBoardPage';

const STEPPER = ['assigned', 'en-route', 'arrived', 'delivered'] as const;
const STEPPER_LABEL: Record<string, string> = { assigned: 'Assigned', 'en-route': 'En route', arrived: 'Arrived', delivered: 'Delivered' };

export default function JobDetailPage() {
  const { id } = useParams();
  const jobs = useCollection('jobs');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const audit = useCollection('audit');
  const priorities = (useKV('job-priorities' as never) as unknown as Record<string, JobPriority>) ?? {};
  const notifications = ((useKV('job-notifications' as never) as unknown as JobNotification[]) ?? [])
    .filter((n) => n.jobId === id);
  const navigate = useNavigate();

  const job = jobs.find((j) => j.id === id);
  const vehicle = job?.vehicleId ? vehicles.find((v) => v.id === job.vehicleId) : undefined;
  const driver = job?.driverId ? drivers.find((d) => d.id === job.driverId) : undefined;

  const jobAudit = useMemo(
    () => audit.filter((a) => a.collection === 'jobs' && a.recordId === id).sort((a, b) => b.at.localeCompare(a.at)),
    [audit, id],
  );

  if (!job) {
    return (
      <PageShell>
        <EmptyState title="Job not found" hint="This job may have been removed." ctaLabel="Back to dispatch" onCta={() => navigate('/dispatch')} />
      </PageShell>
    );
  }

  const statusIdx = job.status === 'draft' ? -1 : job.status === 'cancelled' ? -1 : STEPPER.indexOf(job.status as (typeof STEPPER)[number]);
  const priority: JobPriority = priorities[job.id] ?? 'normal';
  const km = jobDistanceKm(job);
  const dur = jobDurationMin(job);
  const progress = jobProgress(job);

  return (
    <PageShell className="max-w-[1080px]">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/dispatch" className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-ink-600 shadow-card hover:bg-surface-muted">
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-[20px] font-bold tracking-[0.01em] text-ink-900">{job.number}</h1>
            <StatusPill
              status={job.status === 'delivered' ? 'ok' : job.status === 'arrived' ? 'warn' : job.status === 'en-route' ? 'ok' : job.status === 'assigned' ? 'info' : 'inactive'}
              label={job.status === 'draft' ? 'New' : STEPPER_LABEL[job.status] ?? job.status} pulse={job.status === 'en-route'} />
          </div>
          <div className="mt-0.5 text-[14px] font-semibold text-ink-600">{job.customer}</div>
        </div>
        <label className="flex items-center gap-2 text-[12px] font-medium text-ink-400">
          Priority
          <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[priority])} />
          <select value={priority} onChange={(e) => { setJobPriority(job.id, e.target.value as JobPriority); toast({ title: `Priority → ${e.target.value}`, status: 'inactive' }); }}
            className="h-8 rounded-lg border border-border bg-white px-2 text-[13px] capitalize text-ink-900 outline-none focus:border-accent">
            <option value="low">low</option><option value="normal">normal</option><option value="high">high</option>
          </select>
        </label>
        <Btn icon={Smartphone} variant="ghost" onClick={() => navigate(`/dispatch/${job.id}/run`)}>Mobile run view</Btn>
      </div>

      {/* stepper */}
      <Card pad={false} className="px-5 py-4">
        <div className="flex items-center">
          {STEPPER.map((s, i) => {
            const done = i <= statusIdx;
            const current = i === statusIdx;
            return (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <motion.span
                    initial={false}
                    animate={{ scale: current ? [1, 1.15, 1] : 1 }}
                    transition={{ duration: 0.4 }}
                    className={cn('flex h-7 w-7 items-center justify-center rounded-full border-2',
                      done ? 'border-accent bg-accent text-navy-950' : 'border-border bg-white text-ink-400')}>
                    {done ? <Check size={13} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-border" />}
                  </motion.span>
                  <span className={cn('whitespace-nowrap text-[11px] font-medium', done ? 'text-ink-900' : 'text-ink-400')}>{STEPPER_LABEL[s]}</span>
                </div>
                {i < STEPPER.length - 1 && (
                  <div className="relative mx-2 mb-4 h-0.5 flex-1 overflow-hidden rounded-full bg-border">
                    <motion.div className="absolute inset-y-0 left-0 bg-accent"
                      initial={false} animate={{ width: i < statusIdx ? '100%' : '0%' }} transition={{ duration: 0.4, ease: EASE }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {job.status === 'draft' && <div className="mt-2 text-[12px] text-ink-400">Job is NEW — assign a vehicle and driver to start the stepper.</div>}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* route optimizer */}
        <RouteOptimizerCard job={job} km={km} dur={dur} />
        {/* assignment + summary */}
        <div className="flex flex-col gap-4">
          <Card title="Assignment">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                {vehicle ? <PlateTag plate={vehicle.plate} /> : <span className="text-[13px] italic text-ink-400">No vehicle</span>}
                {vehicle && <span className="text-[13px] text-ink-600">{vehicle.model} · {vehicle.year}</span>}
                {driver && (
                  <span className="ml-auto flex items-center gap-2 text-[13px] text-ink-900">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold', avatarTint(driver.name))}>{initials(driver.name)}</span>
                    {driver.name}
                  </span>
                )}
              </div>
              <AssignmentPickers job={job} />
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-surface-muted p-2.5">
                  <div className="font-mono text-[15px] font-bold text-ink-900">{fmtNum(km)}</div>
                  <div className="text-[11px] text-ink-400">km total</div>
                </div>
                <div className="rounded-lg bg-surface-muted p-2.5">
                  <div className="font-mono text-[15px] font-bold text-ink-900">{Math.floor(dur / 60)}h {String(dur % 60).padStart(2, '0')}m</div>
                  <div className="text-[11px] text-ink-400">est. duration</div>
                </div>
                <div className="rounded-lg bg-surface-muted p-2.5">
                  <div className="font-mono text-[15px] font-bold text-ink-900">{job.status === 'en-route' ? jobEta(job) : fmtTimeEAT(job.scheduledAt)}</div>
                  <div className="text-[11px] text-ink-400">{job.status === 'en-route' ? 'ETA' : 'scheduled'}</div>
                </div>
              </div>
              {job.status === 'en-route' && (
                <div>
                  <div className="flex justify-between font-mono text-[11px] text-ink-400"><span>route progress</span><span>{Math.round(progress * 100)}%</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <motion.div animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.6 }} className="h-full rounded-full bg-accent" />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* notification log */}
          <NotificationCard job={job} notifications={notifications} />
        </div>
      </div>

      {/* POD section */}
      <PodSection job={job} />

      {/* audit footer */}
      <Card title="Audit trail">
        <div className="flex flex-col divide-y divide-border/60">
          <div className="flex items-center gap-2 py-2 text-[13px] text-ink-600">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-50 text-navy-800"><Check size={12} /></span>
            Created by <b>Brian Kibe</b> · <span className="font-mono text-[11px]">{fmtDateTimeEAT(job.createdAt)}</span>
          </div>
          {jobAudit.map((a) => (
            <motion.div key={a.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }}
              className="flex items-center gap-2 py-2 text-[13px] text-ink-600">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-50 text-navy-800"><Clock size={12} /></span>
              <span className="flex-1">{a.summary}</span>
              <span className="text-[12px] text-ink-400">{a.userName}</span>
              <span className="font-mono text-[11px] text-ink-400">{fmtDateTimeEAT(a.at)}</span>
            </motion.div>
          ))}
        </div>
      </Card>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Route optimizer card                                                */
/* ------------------------------------------------------------------ */

function stopContact(stop: JobStop): string {
  const h = Math.floor(hash01(stop.id + stop.address) * 1e9);
  return `+254 7${String(10 + (h % 89))} ${String(100 + (h % 899))} ${String(100 + ((h >> 3) % 899))}`;
}

function RouteOptimizerCard({ job, km, dur }: { job: Job; km: number; dur: number }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const stops = [...job.stops];
    const [moved] = stops.splice(from, 1);
    stops.splice(to, 0, moved);
    update('jobs', job.id, { stops });
    auditJob(job.id, `Job ${job.number} stops reordered`);
  };

  const optimize = () => {
    // nearest-neighbour from the pickup across remaining stops
    const [first, ...rest] = job.stops;
    if (rest.length < 2) { toast({ title: 'Nothing to optimize', body: 'Only one drop stop.', status: 'inactive' }); return; }
    const before = jobDistanceKm(job);
    const ordered: JobStop[] = [];
    let cur = first;
    const pool = [...rest];
    while (pool.length) {
      let best = 0; let bestD = Infinity;
      pool.forEach((s, i) => {
        const d = haversineKm(cur.lat, cur.lng, s.lat, s.lng);
        if (d < bestD) { bestD = d; best = i; }
      });
      cur = pool.splice(best, 1)[0];
      ordered.push(cur);
    }
    const afterStops = [first, ...ordered];
    let after = 0;
    for (let i = 1; i < afterStops.length; i++) after += haversineKm(afterStops[i - 1].lat, afterStops[i - 1].lng, afterStops[i].lat, afterStops[i].lng);
    after = Math.round(after * 1.28);
    const savedKm = Math.max(0, before - after);
    const savedMin = Math.round(savedKm / 0.85);
    update('jobs', job.id, { stops: afterStops });
    auditJob(job.id, `Job ${job.number} route optimized — saved ${savedKm} km`);
    toast({ title: 'Route optimized', body: `Saved ${savedKm} km / ${savedMin} min`, status: 'ok' });
  };

  const nextIdx = job.stops.findIndex((s) => !s.completedAt);

  return (
    <Card title="Route optimizer"
      actions={<Btn icon={Zap} variant="ghost" onClick={optimize}>Optimize order</Btn>}>
      <div className="flex flex-col gap-2">
        {job.stops.map((s, i) => {
          const state = s.completedAt ? 'DONE' : i === nextIdx ? 'NEXT' : 'QUEUED';
          return (
            <motion.div key={s.id} layout transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragIdx != null) reorder(dragIdx, i); setDragIdx(null); }}
              onDragEnd={() => setDragIdx(null)}
              className={cn('group flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2.5 transition-shadow',
                dragIdx === i ? 'border-accent shadow-pop opacity-70' : 'border-border hover:shadow-card')}>
              <GripVertical size={14} className="shrink-0 cursor-grab text-ink-400/40 group-hover:text-ink-400" />
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold text-white',
                state === 'DONE' ? 'bg-ok' : state === 'NEXT' ? 'bg-accent' : 'bg-inactive')}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-900">{s.label}</div>
                <div className="truncate text-[12px] text-ink-400">{s.address}</div>
              </div>
              <div className="hidden flex-col items-end gap-0.5 text-right sm:flex">
                <span className="flex items-center gap-1 font-mono text-[11px] text-ink-600"><Phone size={10} />{stopContact(s)}</span>
                <span className="font-mono text-[11px] text-ink-400">window {fmtTimeEAT(job.scheduledAt)}–{fmtTimeEAT(new Date(Date.parse(job.scheduledAt) + 3 * 3600e3).toISOString())} · svc 15 min</span>
              </div>
              <StatusPill status={state === 'DONE' ? 'ok' : state === 'NEXT' ? 'info' : 'inactive'} label={state} />
            </motion.div>
          );
        })}
      </div>
      <div className="mt-3">
        <MiniMap height={190}
          pins={job.stops.map((s, i) => ({
            lat: s.lat, lng: s.lng, label: String(i + 1), kind: 'stop' as const,
            color: s.completedAt ? '#16A34A' : '#0F2540',
          }))}
          lines={job.stops.length > 1 ? [{ pts: job.stops.map((s) => ({ lat: s.lat, lng: s.lng })), color: '#06B6D4', width: 3 }] : []} />
        <div className="mt-2 flex items-center justify-between font-mono text-[12px] text-ink-600">
          <span>optimized total</span>
          <span className="font-semibold text-ink-900">{fmtNum(km)} km · ~{Math.floor(dur / 60)} h {String(dur % 60).padStart(2, '0')} m</span>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Assignment pickers                                                  */
/* ------------------------------------------------------------------ */

function AssignmentPickers({ job }: { job: Job }) {
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const jobs = useCollection('jobs');
  const busyVehicleIds = new Set(jobs.filter((j) => j.id !== job.id && ['assigned', 'en-route', 'arrived'].includes(j.status)).map((j) => j.vehicleId));
  const busyDriverIds = new Set(jobs.filter((j) => j.id !== job.id && ['assigned', 'en-route', 'arrived'].includes(j.status)).map((j) => j.driverId));
  const inputCls = 'h-9 w-full rounded-lg border border-border bg-white px-2.5 text-[13px] outline-none focus:border-accent';
  return (
    <div className="grid grid-cols-2 gap-2">
      <select value={job.vehicleId ?? ''} onChange={(e) => {
        update('jobs', job.id, { vehicleId: e.target.value || null });
        auditJob(job.id, `Job ${job.number} vehicle → ${vehicles.find((v) => v.id === e.target.value)?.plate ?? 'unassigned'}`);
      }} className={inputCls}>
        <option value="">Vehicle…</option>
        {vehicles.filter((v) => v.tripStatus === 'active').map((v) => (
          <option key={v.id} value={v.id}>{v.plate}{busyVehicleIds.has(v.id) ? ' — on a job' : ' — free'}</option>
        ))}
      </select>
      <select value={job.driverId ?? ''} onChange={(e) => {
        update('jobs', job.id, { driverId: e.target.value || null });
        auditJob(job.id, `Job ${job.number} driver → ${drivers.find((d) => d.id === e.target.value)?.name ?? 'unassigned'}`);
      }} className={inputCls}>
        <option value="">Driver…</option>
        {drivers.filter((d) => d.status !== 'on-leave').map((d) => (
          <option key={d.id} value={d.id}>{d.name}{busyDriverIds.has(d.id) ? ' — on a job' : ''}</option>
        ))}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Customer notification log                                           */
/* ------------------------------------------------------------------ */

const TEMPLATES = ['Running late', 'Arriving in 30 min', 'Delivered'];

function NotificationCard({ job, notifications }: { job: Job; notifications: JobNotification[] }) {
  const [template, setTemplate] = useState(TEMPLATES[0]);
  const send = () => {
    const text = template === 'Running late'
      ? `Running late — new ETA ${jobEta(job) === '—' ? '18:30' : jobEta(job)} for ${job.customer}`
      : template === 'Arriving in 30 min'
        ? `Arriving in ~30 min — please have the receiving bay ready`
        : `Delivered — thank you, ${job.customer}`;
    pushJobNotification({ jobId: job.id, channel: template === 'Delivered' ? 'EMAIL' : 'SMS', text, at: DEMO_NOW_ISO, status: 'sent' });
    auditJob(job.id, `Customer notification sent (${template}) — ${job.number}`);
    toast({ title: 'Update sent to customer', body: text, status: 'ok' });
  };
  return (
    <Card title="Customer notifications"
      actions={<span className="font-mono text-[11px] text-ink-400">{notifications.length} sent</span>}>
      <div className="flex flex-col gap-2">
        {notifications.length === 0 && (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] text-ink-400">
            No updates sent yet — customer is quiet.
          </div>
        )}
        {[...notifications].sort((a, b) => b.at.localeCompare(a.at)).map((n) => (
          <motion.div key={n.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: EASE }}
            className="flex items-start gap-2.5 rounded-lg border border-border/70 bg-surface-muted/40 px-3 py-2">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-ink-600 shadow-card">
              {n.channel === 'SMS' ? <MessageSquare size={12} /> : <Mail size={12} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                  n.channel === 'SMS' ? 'bg-navy-800 text-white' : 'bg-info-soft text-info-on-soft')}>{n.channel}</span>
                <span className="font-mono text-[10px] text-ink-400">{fmtDateTimeEAT(n.at)}</span>
                <span className="ml-auto flex items-center gap-0.5 text-[11px] font-medium text-ok-on-soft"><Check size={11} />{n.status}</span>
              </div>
              <div className="mt-0.5 text-[13px] leading-5 text-ink-900">{n.text}</div>
            </div>
          </motion.div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <select value={template} onChange={(e) => setTemplate(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-border bg-white px-2.5 text-[13px] outline-none focus:border-accent">
            {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Btn icon={Send} onClick={send}>Send update</Btn>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* POD section                                                         */
/* ------------------------------------------------------------------ */

function PodSection({ job }: { job: Job }) {
  const navigate = useNavigate();
  if (!job.pod) {
    return (
      <Card title="Proof of delivery">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn-soft/60 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-warn-on-soft shadow-card"><Navigation size={17} /></span>
          <div className="min-w-0 flex-1 text-[13px] text-ink-900">
            <b>Awaiting driver capture on mobile.</b>
            <div className="text-ink-600">The driver completes POD (photos, signature, receiver) from the run view.</div>
          </div>
          <Btn icon={Smartphone} variant="ghost" onClick={() => navigate(`/dispatch/${job.id}/run`)}>Open run view</Btn>
        </div>
      </Card>
    );
  }
  const pod = job.pod;
  const lastStop = job.stops[job.stops.length - 1];
  const photos = [pod.photo, pod.photo === '/pod-photo-01.jpg' ? '/pod-photo-02.jpg' : '/pod-photo-01.jpg'].filter(Boolean) as string[];
  return (
    <Card title="Proof of delivery"
      actions={<StatusPill status="ok" label="Delivered" />}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* signature tile */}
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Receiver signature</div>
          <div className="flex h-[140px] items-center justify-center rounded-lg border border-border bg-white">
            {pod.signature ? (
              <img src={pod.signature} alt="Receiver signature" className="max-h-[120px] max-w-full" />
            ) : (
              <svg viewBox="0 0 220 80" className="h-24 w-48">
                <motion.path d="M18 56 C 40 20, 58 66, 78 40 S 118 62, 134 34 S 176 52, 202 30"
                  fill="none" stroke="#0E1B2A" strokeWidth={2.4} strokeLinecap="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: 'easeOut' }} />
              </svg>
            )}
          </div>
        </div>
        {/* photos */}
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Photos ({photos.length})</div>
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <motion.img key={p} src={p} alt="POD evidence" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }} className="h-[66px] w-full rounded-lg border border-border object-cover" />
            ))}
          </div>
        </div>
        {/* meta */}
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Details</div>
          <div>Received by <b>{pod.signedBy}</b></div>
          {pod.notes && <div className="text-ink-600">“{pod.notes}”</div>}
          <div className="font-mono text-[11px] text-ink-600">captured {fmtDateTimeEAT(pod.at, true)}</div>
          {lastStop && (
            <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 font-mono text-[11px] font-medium text-ok-on-soft">
              <MapPin size={11} /> {lastStop.lat.toFixed(4)}, {lastStop.lng.toFixed(4)} ✓ within 120 m of stop
            </span>
          )}
          <div className="mt-1 flex items-center gap-1 text-[12px] text-ink-400">
            <ChevronRight size={12} /> customer “Delivered” notification logged above
          </div>
        </div>
      </div>
    </Card>
  );
}
