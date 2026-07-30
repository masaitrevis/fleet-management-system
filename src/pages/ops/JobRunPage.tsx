// FBV FleetOS — /dispatch/:id/run — mobile driver job view with POD capture
// (dispatch.md §C). Rendered inside DriverShell.

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera, Check, ChevronLeft, FileSignature, MapPin, Navigation, NotebookPen, Package, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { update, useCollection } from '@/lib/store';
import type { Job } from '@/lib/types';
import { fmtDateTimeEAT, fmtTimeEAT } from '@/lib/format';
import { EmptyState, SignaturePad, StatusPill, toast } from '@/components/shared';
import { DEMO_NOW_ISO, EASE, MiniMap } from './ops-shared';
import { auditJob, pushJobNotification } from './DispatchBoardPage';

type Phase = 'run' | 'pod' | 'done';

const POD_PHOTOS = ['/pod-photo-01.jpg', '/pod-photo-02.jpg'];

export default function JobRunPage() {
  const { id } = useParams();
  const jobs = useCollection('jobs');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('run');
  const [deliveredAt, setDeliveredAt] = useState<string>('');

  const job = jobs.find((j) => j.id === id);
  const vehicle = job?.vehicleId ? vehicles.find((v) => v.id === job.vehicleId) : undefined;
  const driver = job?.driverId ? drivers.find((d) => d.id === job.driverId) : undefined;

  const nextStopIdx = useMemo(() => (job ? job.stops.findIndex((s) => !s.completedAt) : -1), [job]);
  const nextStop = job && nextStopIdx >= 0 ? job.stops[nextStopIdx] : undefined;
  const isLastStop = job ? nextStopIdx === job.stops.length - 1 : false;

  if (!job) {
    return (
      <div className="p-4">
        <EmptyState title="Job not found" ctaLabel="Back to jobs" onCta={() => navigate('/dispatch')} />
      </div>
    );
  }

  const patchStop = (idx: number, patch: Partial<Job['stops'][number]>) => {
    const stops = job.stops.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    update('jobs', job.id, { stops });
  };

  /* status action button behaviour */
  const startRoute = () => {
    update('jobs', job.id, { status: 'en-route' });
    auditJob(job.id, `Job ${job.number} → en-route (driver mobile)`);
    toast({ title: 'Route started', body: 'Drive safe — speed limit 100 km/h.', status: 'ok' });
  };

  const arriveAtStop = () => {
    patchStop(nextStopIdx, { arrivedAt: DEMO_NOW_ISO });
    if (isLastStop) {
      update('jobs', job.id, { status: 'arrived' });
      auditJob(job.id, `Job ${job.number} → arrived (driver mobile)`);
      setPhase('pod');
    } else {
      toast({ title: `Arrived at stop ${nextStopIdx + 1}`, body: 'Complete the stop when unloaded.', status: 'ok' });
    }
  };

  const completeStop = () => {
    patchStop(nextStopIdx, { completedAt: DEMO_NOW_ISO });
    auditJob(job.id, `Job ${job.number} stop ${nextStopIdx + 1} completed`);
  };

  /* what does the big button say? */
  const buttonState = (): { label: string; color: 'ok' | 'accent'; action: () => void } | null => {
    if (job.status === 'draft' || job.status === 'assigned') return { label: 'Start route →', color: 'ok', action: startRoute };
    if (job.status === 'en-route' && nextStop) {
      if (!nextStop.arrivedAt) {
        return { label: `Arrived at stop ${nextStopIdx + 1}${isLastStop ? ' (final)' : ''}`, color: 'accent', action: arriveAtStop };
      }
      return { label: `Complete stop ${nextStopIdx + 1} →`, color: 'ok', action: completeStop };
    }
    if (job.status === 'arrived') return { label: 'Open POD capture', color: 'accent', action: () => setPhase('pod') };
    return null;
  };

  const btn = buttonState();
  const statusPill = job.status === 'delivered'
    ? { status: 'ok' as const, label: 'Delivered' }
    : job.status === 'arrived'
      ? { status: 'warn' as const, label: 'Arrived' }
      : job.status === 'en-route'
        ? { status: 'ok' as const, label: 'En route', pulse: true }
        : { status: 'info' as const, label: job.status === 'assigned' ? 'Assigned' : 'New' };

  return (
    <div className="flex min-h-full flex-col">
      <AnimatePresence mode="wait">
        {phase === 'done' ? (
          <SuccessScreen key="done" job={job} deliveredAt={deliveredAt} onBack={() => navigate('/dispatch')} />
        ) : phase === 'pod' ? (
          <PodCapture key="pod" job={job} onCancel={() => setPhase('run')}
            onSubmitted={(at) => { setDeliveredAt(at); setPhase('done'); }} />
        ) : (
          <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-1 flex-col gap-3 p-4 pb-24">
            {/* header */}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => navigate('/dispatch')}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-ink-600 shadow-card">
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px] font-bold text-ink-900">{job.number}</div>
                <div className="truncate text-[14px] font-semibold text-ink-600">{job.customer}</div>
              </div>
              <StatusPill {...statusPill} className="px-3 py-1 text-[12px]" />
            </div>

            {/* map strip */}
            <MiniMap height={120}
              pins={job.stops.map((s, i) => ({
                lat: s.lat, lng: s.lng, label: String(i + 1), kind: 'stop' as const,
                color: s.completedAt ? '#16A34A' : i === nextStopIdx ? '#06B6D4' : '#0F2540',
                ring: i === nextStopIdx,
              }))}
              lines={job.stops.length > 1 ? [{ pts: job.stops.map((s) => ({ lat: s.lat, lng: s.lng })), color: '#06B6D4', width: 2.5, dashed: true }] : []} />

            {/* next-stop card */}
            {nextStop ? (
              <div className="rounded-card border border-border bg-white p-4 shadow-card">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-accent-soft px-2.5 py-1 font-mono text-[11px] font-bold text-accent-strong">
                    STOP {nextStopIdx + 1} of {job.stops.length}
                  </span>
                  {nextStop.arrivedAt && <StatusPill status="warn" label="At stop" />}
                </div>
                <div className="mt-2 text-[17px] font-bold leading-6 text-ink-900">{nextStop.label}</div>
                <div className="text-[13px] text-ink-600">{nextStop.address}</div>
                <div className="mt-2 flex items-center gap-2 font-mono text-[12px] text-ink-600">
                  <MapPin size={12} className="text-accent-strong" /> {nextStop.lat.toFixed(4)}, {nextStop.lng.toFixed(4)}
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${nextStop.lat},${nextStop.lng}`}
                  target="_blank" rel="noreferrer"
                  className="mt-3 flex h-11 items-center justify-center gap-2 rounded-lg border border-accent bg-accent-soft/50 text-[14px] font-semibold text-accent-strong transition-all active:scale-[0.98]">
                  <Navigation size={16} /> Navigate
                </a>
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2 text-[12px] leading-4 text-ink-600">
                  <NotebookPen size={13} className="mt-0.5 shrink-0 text-ink-400" />
                  Dispatcher notes: {isLastStop ? 'Ask for the store manager — count cartons before signing.' : 'Quick turnaround, no waiting.'}
                </div>
              </div>
            ) : (
              <div className="rounded-card border border-border bg-white p-4 text-center text-[13px] text-ink-600 shadow-card">
                All stops completed — submit POD to finish the job.
              </div>
            )}

            {/* vehicle/driver chip */}
            <div className="flex items-center gap-2 text-[12px] text-ink-400">
              <Package size={13} />
              {vehicle ? `${vehicle.plate} · ${vehicle.model}` : 'No vehicle'} · {driver?.name ?? 'No driver'}
              <span className="ml-auto font-mono">sched {fmtTimeEAT(job.scheduledAt)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* sticky bottom status action (56px) */}
      {phase === 'run' && btn && (
        <div className="sticky bottom-0 z-10 bg-gradient-to-t from-surface-muted via-surface-muted to-transparent px-4 pb-3 pt-6">
          <motion.button key={btn.label} type="button"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}
            onClick={btn.action}
            className={cn('flex h-14 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-bold text-white shadow-pop transition-transform active:scale-[0.98]',
              btn.color === 'ok' ? 'bg-ok' : 'bg-accent text-navy-950')}>
            {btn.label}
          </motion.button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* POD capture screen                                                  */
/* ------------------------------------------------------------------ */

function PodCapture({ job, onCancel, onSubmitted }: {
  job: Job; onCancel: () => void; onSubmitted: (at: string) => void;
}) {
  const [receiver, setReceiver] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const checks = [
    { label: 'Receiver name', ok: receiver.trim().length > 1, icon: User },
    { label: 'At least 1 photo', ok: photos.length > 0, icon: Camera },
    { label: 'Receiver signature', ok: !!signature, icon: FileSignature },
  ];
  const allOk = checks.every((c) => c.ok);

  const snap = () => {
    if (photos.length >= 2) return;
    setPhotos((p) => [...p, POD_PHOTOS[p.length]]);
    toast({ title: 'Photo captured', status: 'ok' });
  };

  const submit = () => {
    if (!allOk) return;
    const stops = job.stops.map((s) => ({ ...s, arrivedAt: s.arrivedAt ?? DEMO_NOW_ISO, completedAt: s.completedAt ?? DEMO_NOW_ISO }));
    update('jobs', job.id, {
      status: 'delivered', stops,
      pod: { signedBy: receiver.trim(), at: DEMO_NOW_ISO, photo: photos[0], notes: notes.trim() || undefined, signature: signature ?? undefined },
    });
    auditJob(job.id, `Job ${job.number} → delivered — POD by ${receiver.trim()} (driver mobile)`);
    pushJobNotification({ jobId: job.id, channel: 'SMS', text: `Delivered — ${job.customer} · signed by ${receiver.trim()}`, at: DEMO_NOW_ISO, status: 'delivered' });
    onSubmitted(DEMO_NOW_ISO);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="flex flex-col gap-3 p-4 pb-24">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-ink-600 shadow-card">
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="text-[16px] font-bold text-ink-900">Proof of delivery</div>
          <div className="font-mono text-[11px] text-ink-400">{job.number} · {job.customer}</div>
        </div>
      </div>

      {/* receiver */}
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
        Receiver name
        <input value={receiver} onChange={(e) => setReceiver(e.target.value)}
          placeholder="e.g. R. Achieng — store manager"
          className="h-12 rounded-lg border border-border bg-white px-3 text-[15px] text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
      </label>

      {/* photo slots */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-400">Delivery photos ({photos.length}/2)</span>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1].map((i) => (
            photos[i] ? (
              <motion.img key={i} src={photos[i]} alt={`POD ${i + 1}`}
                initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}
                className="h-28 w-full rounded-lg border border-border object-cover" />
            ) : (
              <button key={i} type="button" onClick={snap}
                className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border bg-white text-ink-400 transition-colors hover:border-accent hover:text-accent-strong">
                <Camera size={20} />
                <span className="text-[11px] font-medium">Tap to capture</span>
              </button>
            )
          ))}
        </div>
      </div>

      {/* notes */}
      <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
        Notes (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="e.g. 42 cartons received, 1 damaged"
          className="rounded-lg border border-border bg-white px-3 py-2 text-[14px] text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
      </label>

      {/* signature */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-400">Receiver signature {signature && <span className="font-mono text-ok-on-soft">✓ captured</span>}</span>
        {signature ? (
          <div className="relative rounded-card border border-border bg-white">
            <img src={signature} alt="signature" className="h-[120px] w-full rounded-card object-contain" />
            <button type="button" onClick={() => setSignature(null)}
              className="absolute right-2 top-2 rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-medium text-ink-600 shadow-card">
              Redo
            </button>
          </div>
        ) : (
          <SignaturePad height={150} onDone={(d) => setSignature(d)} />
        )}
      </div>

      {/* mandatory checklist */}
      <div className="flex flex-col gap-1.5 rounded-card border border-border bg-white p-3 shadow-card">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-2 text-[13px]">
            <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', c.ok ? 'bg-ok text-white' : 'bg-surface-muted text-ink-400')}>
              {c.ok && <Check size={12} strokeWidth={3} />}
            </span>
            <span className={c.ok ? 'text-ink-900' : 'text-ink-400'}>{c.label}{c.ok ? '' : ' — required'}</span>
            <c.icon size={13} className="ml-auto text-ink-400/60" />
          </div>
        ))}
      </div>

      {/* submit (56px) */}
      <div className="sticky bottom-0 z-10 -mx-4 bg-gradient-to-t from-surface-muted via-surface-muted to-transparent px-4 pb-3 pt-6">
        <button type="button" disabled={!allOk} onClick={submit}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-ok text-[16px] font-bold text-white shadow-pop transition-all active:scale-[0.98] disabled:opacity-40">
          <Check size={18} strokeWidth={3} /> Submit POD
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Success screen                                                      */
/* ------------------------------------------------------------------ */

function SuccessScreen({ job, deliveredAt, onBack }: { job: Job; deliveredAt: string; onBack: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <motion.svg viewBox="0 0 72 72" className="h-20 w-20"
        initial={{ scale: 0.7 }} animate={{ scale: [0.7, 1.08, 1] }} transition={{ duration: 0.5, ease: EASE }}>
        <circle cx="36" cy="36" r="33" fill="#DCFCE7" />
        <motion.path d="M22 37.5 L32 47 L51 27" fill="none" stroke="#16A34A" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }} />
      </motion.svg>
      <div className="text-[22px] font-bold text-ink-900">Delivered</div>
      <div className="font-mono text-[13px] text-ink-600">
        {fmtDateTimeEAT(deliveredAt || DEMO_NOW_ISO)} · Customer notified
      </div>
      <div className="text-[13px] text-ink-400">{job.number} · {job.customer}</div>
      <motion.button type="button" onClick={onBack}
        animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 0.4, delay: 0.5 }}
        className="mt-2 h-12 rounded-xl bg-navy-900 px-6 text-[14px] font-semibold text-white shadow-pop active:scale-[0.98]">
        Back to jobs
      </motion.button>
    </motion.div>
  );
}
