// FBV FleetOS — /driver Driver Home (design.md §5.3 mobile driver shell).
// Phone-first home for the signed-in driver: greeting, critical vehicle flags,
// DVIR prompt, today's jobs, shift status and safety score.
// Data via the synced fleet store (useCollection/useKV) — demo "today" = 2026-07-28.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BadgeCheck, CalendarDays, ChevronRight, ClipboardCheck, Coffee, Gauge,
  MapPin, MoonStar, Navigation, Package, ShieldAlert, TrendingDown,
  TrendingUp, TriangleAlert, Trophy,
} from 'lucide-react';
import {
  EmptyState, PlateTag, ScoreRing, StatusPill,
} from '@/components/shared';
import { useCollection, useKV } from '@/lib/store';
import { fmtDateEAT, fmtTimeEAT, scoreColor, VEHICLE_STATUS_TO_KEY } from '@/lib/format';
import type { Job, Severity } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  Avatar, EASE, fmtMin, PageEnter, PageSection, useReducedMotion, useTick,
} from '@/pages/drivers/helpers';
import { jobEta, jobProgress } from '@/pages/ops/ops-shared';

/* Demo-universe "now": 14:35 EAT on TODAY (matches ops-shared DEMO_NOW). */
const DEMO_NOW_EAT_HOUR = 14;

interface MyShift { on: boolean; since: string | null; drivingMin: number; breakMin: number; onBreak: boolean }
const DEFAULT_SHIFT: MyShift = { on: false, since: null, drivingMin: 0, breakMin: 0, onBreak: false };

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DRIVE_LIMIT_MIN = 480; // 8 h Kenyan standard shift (shifts.md)
const BREAK_TARGET_MIN = 45;

function greeting(): string {
  const h = DEMO_NOW_EAT_HOUR;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function jobPill(job: Job): { status: 'ok' | 'warn' | 'info' | 'inactive'; label: string; pulse?: boolean } {
  switch (job.status) {
    case 'delivered': return { status: 'ok', label: 'Delivered' };
    case 'arrived': return { status: 'warn', label: 'Arrived — POD pending' };
    case 'en-route': return { status: 'ok', label: 'En route', pulse: true };
    case 'cancelled': return { status: 'inactive', label: 'Cancelled' };
    default: return { status: 'info', label: job.status === 'assigned' ? 'Assigned' : 'New' };
  }
}

function jobCta(job: Job): string {
  if (job.status === 'assigned' || job.status === 'draft') return 'Start route';
  if (job.status === 'en-route') return 'Continue run';
  if (job.status === 'arrived') return 'Capture POD';
  return 'View job';
}

function scoreBand(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Fair';
  return 'Needs coaching';
}

export default function DriverHome() {
  const { user } = useAuth();
  const drivers = useCollection('drivers');
  const vehicles = useCollection('vehicles');
  const jobs = useCollection('jobs');
  const inspections = useCollection('inspections');
  const alerts = useCollection('alerts');
  const rewards = useCollection('rewards');
  const doNotDrive = (useKV('doNotDrive') as string[] | undefined) ?? [];
  const myShift = (useKV('myShift') as MyShift | undefined) ?? DEFAULT_SHIFT;
  const reduced = useReducedMotion();
  const tick = useTick(30000);

  const me = drivers.find((d) => d.name === user?.name) ?? drivers[0];
  const vehicle = vehicles.find((v) => v.assignedDriverId === me?.id);
  const firstName = me?.name.split(' ')[0] ?? 'Driver';
  const dateLabel = `${WEEKDAYS[new Date(`${TODAY}T00:00:00Z`).getUTCDay()]}, ${fmtDateEAT(TODAY)}`;

  /* critical vehicle flags */
  const flagged = vehicle ? doNotDrive.includes(vehicle.id) : false;
  const vehicleAlerts = useMemo(
    () => alerts.filter((a) =>
      !a.acknowledged &&
      (a.severity === ('critical' as Severity) || a.severity === ('major' as Severity)) &&
      (a.entityRef.id === vehicle?.id || a.entityRef.id === me?.id)),
    [alerts, vehicle?.id, me?.id],
  );

  /* DVIR state for today */
  const todayDvir = useMemo(
    () => inspections
      .filter((i) => i.vehicleId === vehicle?.id && i.at.slice(0, 10) === TODAY)
      .sort((a, b) => b.at.localeCompare(a.at))[0],
    [inspections, vehicle?.id],
  );

  /* today's jobs for this driver */
  const myJobs = useMemo(() => {
    const mine = jobs.filter((j) => j.driverId === me?.id);
    const active = mine
      .filter((j) => j.status === 'assigned' || j.status === 'en-route' || j.status === 'arrived')
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const doneToday = mine.filter((j) => j.status === 'delivered' && (j.pod?.at ?? '').slice(0, 10) === TODAY);
    return { active, doneToday };
  }, [jobs, me?.id]);

  /* shift status (shared kv with /shifts mobile view) */
  const liveDrive = myShift.drivingMin + (myShift.on && !myShift.onBreak ? tick * 0.5 : 0);
  const liveBreak = myShift.breakMin + (myShift.on && myShift.onBreak ? tick * 0.5 : 0);
  const driveFrac = liveDrive / DRIVE_LIMIT_MIN;
  const drivePct = Math.min(1, driveFrac);
  const driveBar = driveFrac > 1 ? 'bg-alert' : driveFrac > 0.75 ? 'bg-warn' : 'bg-ok';

  /* safety standing */
  const standing = rewards.find((r) => r.driverId === me?.id && r.month === '2026-07');

  return (
    <PageEnter className="max-w-md p-4 pb-8">
      {/* ------- DO-NOT-DRIVE critical banner ------- */}
      {flagged && vehicle && (
        <PageSection>
          <motion.div
            animate={reduced ? undefined : {
              boxShadow: [
                '0 0 0 0 rgba(220,38,38,0)',
                '0 0 24px 4px rgba(220,38,38,0.35)',
                '0 0 0 0 rgba(220,38,38,0)',
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="flex items-start gap-3 rounded-card bg-alert px-4 py-3.5 text-white shadow-card"
          >
            <ShieldAlert size={20} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-[14px] font-bold uppercase tracking-[0.04em]">Do not drive</div>
              <div className="text-[12px] leading-4 opacity-90">
                {vehicle.plate} is blocked pending mechanic review. Contact your mechanic before starting any trip.
              </div>
            </div>
            <PlateTag plate={vehicle.plate} />
          </motion.div>
        </PageSection>
      )}

      {/* ------- greeting header ------- */}
      <PageSection>
        <div className="overflow-hidden rounded-card bg-navy-900 p-5 text-white shadow-card">
          <div className="flex items-center gap-3">
            {me && <Avatar name={me.name} size={48} />}
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-navy-100/80">{greeting()},</div>
              <div className="truncate text-[20px] font-bold leading-6 tracking-[-0.01em]">{firstName}</div>
            </div>
            {standing && (
              <span className="flex items-center gap-1 rounded-full bg-navy-800 px-2.5 py-1 font-mono text-[11px] font-semibold text-accent-on-navy">
                <Trophy size={12} /> #{standing.rank}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-navy-700/70 pt-3 text-[12px] text-navy-100">
            <CalendarDays size={13} className="text-accent-on-navy" />
            <span className="font-medium">{dateLabel}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-navy-100/60">EAT</span>
          </div>
          {vehicle && (
            <div className="mt-2.5 flex items-center gap-2">
              <PlateTag plate={vehicle.plate} />
              <span className="truncate text-[12px] text-navy-100/90">{vehicle.model}</span>
              <span className="ml-auto">
                <StatusPill status={VEHICLE_STATUS_TO_KEY[vehicle.status]} label={vehicle.status} pulse={vehicle.status === 'moving'} />
              </span>
            </div>
          )}
        </div>
      </PageSection>

      {/* ------- alert strip (critical/major flags for my vehicle or me) ------- */}
      {vehicleAlerts.map((a) => (
        <PageSection key={a.id}>
          <Link to="/alerts"
            className={cn('flex items-center gap-2.5 rounded-card border px-4 py-2.5 text-[12px] font-semibold shadow-card transition-transform active:scale-[0.99]',
              a.severity === 'critical'
                ? 'border-alert/30 bg-alert-soft text-alert-on-soft'
                : 'border-warn/30 bg-warn-soft text-warn-on-soft')}>
            <TriangleAlert size={15} className="shrink-0" />
            <span className="flex-1 leading-4">{a.message}</span>
            <span className="shrink-0 font-mono text-[10px] opacity-70">{fmtTimeEAT(a.at)}</span>
          </Link>
        </PageSection>
      ))}

      {/* ------- DVIR prompt ------- */}
      <PageSection>
        {todayDvir ? (
          <div className="flex items-center gap-3 rounded-card border border-ok/30 bg-ok-soft p-4 shadow-card">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ok text-white">
              <BadgeCheck size={20} />
            </span>
            <div className="flex-1">
              <div className="text-[14px] font-bold text-ok-on-soft">
                {todayDvir.kind === 'pre-trip' ? 'Pre-trip' : 'Post-trip'} DVIR done
              </div>
              <div className="font-mono text-[11px] text-ok-on-soft/80">
                {fmtTimeEAT(todayDvir.at)} EAT · {todayDvir.result === 'pass' ? 'Pass' : `${todayDvir.defectsCount} defect${todayDvir.defectsCount === 1 ? '' : 's'} reported`}
              </div>
            </div>
            <Link to="/dvir" className="flex h-9 items-center gap-1 rounded-lg bg-white/80 px-3 text-[12px] font-bold text-ink-900 shadow-card hover:bg-white">
              Log book <ChevronRight size={14} />
            </Link>
          </div>
        ) : (
          <Link to="/dvir"
            className="flex items-center gap-3 rounded-card border border-warn/40 bg-warn-soft p-4 shadow-card transition-transform active:scale-[0.99]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn text-white">
              <ClipboardCheck size={20} />
            </span>
            <div className="flex-1">
              <div className="text-[14px] font-bold text-warn-on-soft">Pre-trip inspection due</div>
              <div className="text-[12px] leading-4 text-warn-on-soft/80">
                No DVIR logged for {vehicle?.plate ?? 'your vehicle'} today — takes under 3 minutes.
              </div>
            </div>
            <span className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-warn px-3 text-[12px] font-bold text-white">
              Start <ChevronRight size={14} />
            </span>
          </Link>
        )}
      </PageSection>

      {/* ------- today's jobs ------- */}
      <PageSection>
        <div className="flex items-center justify-between px-1">
          <h2 className="text-[15px] font-semibold text-ink-900">Today's jobs</h2>
          <span className="font-mono text-[11px] text-ink-400">
            {myJobs.active.length} active{myJobs.doneToday.length > 0 ? ` · ${myJobs.doneToday.length} delivered` : ''}
          </span>
        </div>
        <div className="mt-2 flex flex-col gap-3">
          {myJobs.active.length === 0 && myJobs.doneToday.length === 0 && (
            <div className="rounded-card border border-border bg-white shadow-card">
              <EmptyState icon={Package} title="No jobs assigned"
                hint="New dispatch jobs assigned to you will appear here." />
            </div>
          )}
          {myJobs.active.map((job) => {
            const pill = jobPill(job);
            const progress = jobProgress(job);
            const origin = job.stops[0]?.label ?? '—';
            const dest = job.stops[job.stops.length - 1]?.label ?? '—';
            return (
              <div key={job.id} className="rounded-card border border-border bg-white p-4 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold tracking-[0.02em] text-ink-900">{job.number}</span>
                  <StatusPill {...pill} />
                </div>
                <div className="mt-1 text-[14px] font-semibold text-ink-900">{job.customer}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-600">
                  <MapPin size={12} className="shrink-0 text-ink-400" />
                  <span className="truncate">{origin}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-400">{job.stops.length} stop{job.stops.length === 1 ? '' : 's'}</span>
                  <span className="shrink-0 text-ink-400">→</span>
                  <span className="truncate">{dest}</span>
                </div>

                {job.status === 'en-route' && (
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between font-mono text-[11px] text-ink-600">
                      <span>{Math.round(progress * 100)}% of route</span>
                      <span className="flex items-center gap-1 text-ink-900">
                        <Navigation size={11} className="text-accent-strong" /> ETA {jobEta(job)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <motion.span
                        initial={reduced ? false : { width: 0 }}
                        animate={{ width: `${progress * 100}%` }}
                        transition={{ duration: 0.6, ease: EASE }}
                        className="block h-full rounded-full bg-accent" />
                    </div>
                  </div>
                )}
                {job.status === 'assigned' && (
                  <div className="mt-2 font-mono text-[11px] text-ink-600">
                    Scheduled {fmtTimeEAT(job.scheduledAt)} EAT · departs from {origin.replace(/^Pickup — /, '')}
                  </div>
                )}

                <Link to={`/dispatch/${job.id}/run`}
                  className="mt-3 flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-bold text-navy-950 transition-colors hover:bg-accent-strong active:scale-[0.99]">
                  {jobCta(job)} <ChevronRight size={15} />
                </Link>
              </div>
            );
          })}
          {myJobs.doneToday.map((job) => (
            <div key={job.id} className="flex items-center gap-2.5 rounded-card border border-border bg-white px-4 py-2.5 shadow-card">
              <BadgeCheck size={16} className="shrink-0 text-ok" />
              <span className="font-mono text-[11px] text-ink-400">{job.number}</span>
              <span className="flex-1 truncate text-[13px] font-medium text-ink-900">{job.customer}</span>
              <span className="font-mono text-[11px] text-ok-on-soft">
                {job.pod ? `${fmtTimeEAT(job.pod.at)} EAT` : 'delivered'}
              </span>
            </div>
          ))}
        </div>
      </PageSection>

      {/* ------- shift status ------- */}
      <PageSection>
        <Link to="/shifts" className="block rounded-card border border-border bg-white p-4 shadow-card transition-transform active:scale-[0.99]">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink-900">Shift status</h2>
            {myShift.on
              ? myShift.onBreak
                ? <StatusPill status="warn" label="On break" />
                : <StatusPill status="ok" label="Driving" pulse />
              : <StatusPill status="inactive" label="Off duty" />}
          </div>

          {myShift.on ? (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between font-mono text-[12px] text-ink-900">
                <span>Driving {fmtMin(liveDrive)} / {fmtMin(DRIVE_LIMIT_MIN)}</span>
                <span className="text-ink-400">{Math.round(driveFrac * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <motion.span
                  animate={{ width: `${drivePct * 100}%` }}
                  transition={{ duration: 0.4 }}
                  className={cn('block h-full rounded-full', driveBar)} />
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-ink-600">
                <span className="flex items-center gap-1">
                  <Coffee size={11} /> Break {Math.round(liveBreak)} / {BREAK_TARGET_MIN} min
                </span>
                {myShift.since && <span>Clocked in {fmtTimeEAT(myShift.since)}</span>}
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-600">
              <MoonStar size={13} className="text-ink-400" />
              Not clocked in — tap to open Shifts and start your day.
            </div>
          )}
        </Link>
      </PageSection>

      {/* ------- safety score ------- */}
      {me && (
        <PageSection>
          <Link to={`/drivers/${me.id}`}
            className="flex items-center gap-4 rounded-card border border-border bg-white p-4 shadow-card transition-transform active:scale-[0.99]">
            <ScoreRing score={me.safetyScore} size={76} stroke={7} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
                <Gauge size={13} /> Safety score
              </div>
              <div className="mt-0.5 text-[15px] font-bold" style={{ color: scoreColor(me.safetyScore) }}>
                {scoreBand(me.safetyScore)}
              </div>
              {standing && (
                <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-600">
                  {standing.trend === 'up'
                    ? <TrendingUp size={12} className="text-ok" />
                    : standing.trend === 'down'
                      ? <TrendingDown size={12} className="text-alert" />
                      : null}
                  Rank #{standing.rank} · {standing.points.toLocaleString('en-KE')} pts · July
                </div>
              )}
              <div className="mt-1 text-[12px] font-medium text-accent-strong">View full scorecard →</div>
            </div>
          </Link>
        </PageSection>
      )}
    </PageEnter>
  );
}
