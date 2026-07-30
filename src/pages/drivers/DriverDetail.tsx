// FBV FleetOS — /drivers/:id Driver 360° (driver-detail.md).
// Header band + 5 tabs: Scorecard · Events & Coaching · Trips · Documents · Rewards.

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award, BadgeCheck, Car, Check, ChevronRight, FileDown,
  Flag, Gauge, LifeBuoy, Lock, MessageSquare, MoreHorizontal, OctagonAlert,
  Phone, PlayCircle, Trophy, Upload, Wind, Zap,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip,
  XAxis, YAxis,
} from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ConfirmDialog, DataTable, EmptyState, Modal, PlateTag, ScoreRing,
  StatusPill, Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { useCollection, useKV, add, update } from '@/lib/store';
import {
  SEVERITY_TO_KEY, daysUntil, expiryKey, fmtDateEAT, fmtDateTimeEAT, fmtKm,
  fmtNum,
} from '@/lib/format';
import type { CoachingStatus, Driver, SafetyEvent, SafetyEventType } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  Avatar, EASE, PageEnter, PageSection, daysLeftLabel, driverDisplayId,
  fmtMin, hash01, medalFor, nowIso, uid, vehicleOf,
} from './helpers';

const EVENT_META: Record<SafetyEventType, { label: string; icon: typeof Gauge }> = {
  harsh_braking: { label: 'Harsh braking', icon: OctagonAlert },
  harsh_acceleration: { label: 'Harsh acceleration', icon: Zap },
  harsh_cornering: { label: 'Sharp cornering', icon: Wind },
  speeding: { label: 'Speeding', icon: Gauge },
  seatbelt: { label: 'Seatbelt', icon: LifeBuoy },
  distraction: { label: 'Phone / distraction', icon: Phone },
};

const COACHING_LABEL: Record<CoachingStatus, string> = {
  new: 'NEW', reviewed: 'REVIEWED', coached: 'COACHED', acknowledged: 'ACKNOWLEDGED',
};
const COACHING_KEY: Record<CoachingStatus, 'inactive' | 'info' | 'warn' | 'ok'> = {
  new: 'inactive', reviewed: 'info', coached: 'warn', acknowledged: 'ok',
};

const TAB_KEYS = ['scorecard', 'events', 'trips', 'documents', 'rewards'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default function DriverDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const drivers = useCollection('drivers');
  const vehicles = useCollection('vehicles');
  const safetyEvents = useCollection('safetyEvents');
  const tripsCol = useCollection('trips');
  const documents = useCollection('documents');
  const rewards = useCollection('rewards');

  const driver = drivers.find((d) => d.id === id);
  const tabParam = params.get('tab') as TabKey | null;
  const tab: TabKey = tabParam && TAB_KEYS.includes(tabParam) ? tabParam : 'scorecard';
  const setTab = (t: string) => setParams(t === 'scorecard' ? {} : { tab: t }, { replace: true });

  const ranked = useMemo(() => [...drivers].sort((a, b) => b.safetyScore - a.safetyScore), [drivers]);
  const rank = driver ? ranked.findIndex((d) => d.id === driver.id) + 1 : 0;

  const thirtyDaysAgo = useMemo(() => new Date(`${TODAY}T00:00:00Z`).getTime() - 30 * 86400000, []);
  const dEvents = useMemo(
    () => safetyEvents.filter((e) => e.driverId === id).sort((a, b) => b.at.localeCompare(a.at)),
    [safetyEvents, id],
  );
  const dTrips = useMemo(
    () => tripsCol.filter((t) => t.driverId === id).sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [tripsCol, id],
  );
  const trips30 = dTrips.filter((t) => new Date(t.startAt).getTime() >= thirtyDaysAgo);
  const events30 = dEvents.filter((e) => new Date(e.at).getTime() >= thirtyDaysAgo);
  const km30 = trips30.reduce((s, t) => s + t.distanceKm, 0);
  const standing = rewards.find((r) => r.driverId === id && r.month === '2026-07');
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  if (!driver) {
    return (
      <PageEnter>
        <PageSection>
          <EmptyState
            title="Driver not found"
            hint="This driver may have been removed from the roster."
            ctaLabel="Back to drivers"
            onCta={() => navigate('/drivers')}
          />
        </PageSection>
      </PageEnter>
    );
  }

  const veh = vehicleOf(vehicles, driver.id);
  const statusPill = driver.status === 'driving'
    ? <StatusPill status="ok" label="ON DUTY" pulse />
    : driver.status === 'off-duty'
      ? <StatusPill status="inactive" label="OFF DUTY" />
      : <StatusPill status="inactive" label="ON LEAVE" />;

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('FBV FleetOS — Driver Safety Report', 14, 18);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${driver.name} · ${driverDisplayId(driver)} · ${driver.phone}`, 14, 26);
    doc.text(`Safety score (Jul 2026): ${driver.safetyScore.toFixed(1)} · Rank #${rank} of ${drivers.length}`, 14, 32);
    doc.text(`Trips 30d: ${trips30.length} · Distance 30d: ${fmtNum(km30)} km · Harsh events 30d: ${events30.length}`, 14, 38);
    doc.text(`Generated ${fmtDateTimeEAT(nowIso())} · Future Bright Ventures Ltd, Nairobi`, 14, 44);
    autoTable(doc, {
      startY: 50,
      head: [['Date', 'Type', 'Severity', 'Vehicle', 'Speed', 'Coaching']],
      body: dEvents.slice(0, 40).map((e) => [
        fmtDateTimeEAT(e.at),
        EVENT_META[e.type].label,
        e.severity.toUpperCase(),
        vehicles.find((v) => v.id === e.vehicleId)?.plate ?? '',
        e.speedKmh ? `${e.speedKmh} km/h` : '—',
        COACHING_LABEL[e.coachingStatus],
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [10, 26, 47] },
    });
    doc.save(`driver-report-${driver.id}-${TODAY}.pdf`);
    toast({ title: 'PDF exported', body: `driver-report-${driver.id}-${TODAY}.pdf`, status: 'ok' });
  };

  return (
    <PageEnter>
      {/* header band */}
      <PageSection>
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
          className="rounded-drawer border border-border bg-white p-6 shadow-card"
        >
          <div className="flex flex-wrap items-start gap-6">
            <div className="flex items-center gap-4">
              <Avatar name={driver.name} size={80} />
              <div>
                <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">{driver.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-600">
                  <span className="font-mono tracking-[0.02em]">{driver.phone}</span>
                  <span className="font-mono tracking-[0.02em] text-ink-400">{driverDisplayId(driver)}</span>
                  {statusPill}
                  {veh && (
                    <Link to={`/vehicles/${veh.id}`} title={`${veh.model} — open vehicle 360°`} className="transition-transform hover:scale-105">
                      <PlateTag plate={veh.plate} />
                    </Link>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={driver.safetyScore} size={120} stroke={10} />
              <span className="text-micro text-ink-400">Safety score · Jul 2026</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-micro font-semibold text-accent-strong">
                #{rank} of {drivers.length}
                {standing?.trend === 'up' && <span className="text-ok-on-soft">▲</span>}
                {standing?.trend === 'down' && <span className="text-alert-on-soft">▼</span>}
              </span>
            </div>

            <div className="ml-auto grid grid-cols-2 gap-3">
              {[
                { label: 'Trips 30d', value: fmtNum(trips30.length) },
                { label: 'Distance 30d', value: fmtKm(km30) },
                { label: 'Harsh events 30d', value: fmtNum(events30.length) },
                { label: 'Rewards points', value: `${fmtNum(standing?.points ?? driver.rewardPoints)} pts`, accent: true },
              ].map((s) => (
                <div key={s.label} className="rounded-card border border-border bg-surface-muted/50 px-4 py-3">
                  <div className="flex items-center gap-1 text-micro uppercase tracking-[0.06em] text-ink-400">
                    {s.accent && <Trophy size={11} className="text-accent-strong" />}{s.label}
                  </div>
                  <div className={cn('font-mono text-[16px] font-bold text-ink-900', s.accent && 'text-accent-strong')}>{s.value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => toast({ title: 'Message queued', body: `SMS to ${driver.name} (${driver.phone})`, status: 'info' })}
                className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">
                <MessageSquare size={14} /> Message
              </button>
              <button type="button" onClick={exportPdf}
                className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">
                <FileDown size={14} /> Export report
              </button>
              <button type="button" onClick={() => setDeactivateOpen(true)}
                className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-alert hover:bg-alert-soft">
                <MoreHorizontal size={14} /> Deactivate
              </button>
            </div>
          </div>
        </motion.div>
      </PageSection>

      {/* tabs */}
      <PageSection>
        <Tabs
          tabs={[
            { key: 'scorecard', label: 'Scorecard' },
            { key: 'events', label: 'Events & Coaching', count: dEvents.filter((e) => e.coachingStatus !== 'acknowledged').length },
            { key: 'trips', label: 'Trips', count: dTrips.length },
            { key: 'documents', label: 'Documents' },
            { key: 'rewards', label: 'Rewards' },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageSection>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          {tab === 'scorecard' && <ScorecardTab driver={driver} events={dEvents} km={km30} allEvents={safetyEvents} drivers={drivers} />}
          {tab === 'events' && <EventsTab driver={driver} events={dEvents} vehicles={vehicles} />}
          {tab === 'trips' && <TripsTab trips={dTrips} vehicles={vehicles} />}
          {tab === 'documents' && <DocumentsTab driver={driver} documents={documents.filter((d) => d.entityType === 'driver' && d.entityId === driver.id)} />}
          {tab === 'rewards' && <RewardsTab driver={driver} rank={rank} total={drivers.length} points={standing?.points ?? driver.rewardPoints} />}
        </motion.div>
      </AnimatePresence>

      <ConfirmDialog
        open={deactivateOpen}
        onClose={() => setDeactivateOpen(false)}
        onConfirm={() => {
          update('drivers', driver.id, { status: 'off-duty' });
          add('audit', {
            id: uid('aud'), at: nowIso(),
            userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
            collection: 'drivers', recordId: driver.id,
            summary: `Deactivated driver ${driver.name}`,
          });
          toast({ title: 'Driver deactivated', body: 'Logged to audit trail.', status: 'warn' });
        }}
        title="Deactivate driver"
        body={`Deactivate ${driver.name}? They will lose mobile app access.`}
        confirmLabel="Deactivate"
        destructive
      />
    </PageEnter>
  );
}

/* ================= TAB 1 — Scorecard ================= */

function ScorecardTab({ driver, events, km, allEvents, drivers }: {
  driver: Driver; events: SafetyEvent[]; km: number; allEvents: SafetyEvent[]; drivers: Driver[];
}) {
  const [range, setRange] = useState<'4W' | '12W' | '6M'>('12W');

  // 12-week trend derived deterministically, ending at the seeded current score
  const trend = useMemo(() => {
    const weeks = range === '4W' ? 4 : range === '12W' ? 12 : 26;
    const out: { w: string; score: number; target: number }[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const jitter = (hash01(`${driver.id}-wk-${i}`) - 0.5) * 6;
      const drift = i * (hash01(`${driver.id}-drift`) > 0.5 ? 0.35 : -0.2);
      out.push({
        w: i === 0 ? 'Now' : `W-${i}`,
        score: Math.max(40, Math.min(100, Number((driver.safetyScore - drift + jitter).toFixed(1)))),
        target: 90,
      });
    }
    out[out.length - 1].score = driver.safetyScore;
    return out;
  }, [driver, range]);

  const rate = (type: SafetyEventType, list: SafetyEvent[], kms: number) => {
    const n = list.filter((e) => e.type === type).length;
    return kms > 0 ? (n / kms) * 1000 : n * 4.2; // fallback rate when no km logged
  };

  const metrics = (Object.keys(EVENT_META) as SafetyEventType[]).map((type) => {
    const mine = rate(type, events, Math.max(km, 1));
    const fleetList = allEvents.filter((e) => e.type === type);
    const fleetAvg = fleetList.length / Math.max(1, drivers.length) / Math.max(km, 1) * 1000 / 10;
    const spark = Array.from({ length: 8 }, (_, i) => {
      const base = events.filter((e) => e.type === type).length;
      return Math.max(0, Math.round(base * (0.4 + hash01(`${driver.id}-${type}-sp${i}`))));
    });
    return { type, mine, fleetAvg, spark, meta: EVENT_META[type] };
  });

  const radarData = metrics.map((m) => ({
    axis: m.meta.label.split(' ')[0],
    driver: Math.max(0, 100 - m.mine * 22),
    fleet: Math.max(0, 100 - m.fleetAvg * 22),
  }));

  const ninetyDaysAgo = new Date(`${TODAY}T00:00:00Z`).getTime() - 90 * 86400000;
  const distraction90 = events.filter((e) => e.type === 'distraction' && new Date(e.at).getTime() >= ninetyDaysAgo).length;
  const speedingEvents = events.filter((e) => e.type === 'speeding');
  const seatbelt90 = events.filter((e) => e.type === 'seatbelt' && new Date(e.at).getTime() >= ninetyDaysAgo).length;

  const strengths: { ok: boolean; text: string }[] = [];
  if (distraction90 === 0) strengths.push({ ok: true, text: 'Zero distracted-driving events in 90 days' });
  if (seatbelt90 === 0) strengths.push({ ok: true, text: 'Seatbelt compliant across all trips in 90 days' });
  if (driver.safetyScore >= 90) strengths.push({ ok: true, text: `Top-band safety score (${driver.safetyScore.toFixed(1)}) — league eligible` });
  if (speedingEvents.length > 0) strengths.push({ ok: false, text: `Speeding — ${speedingEvents.length} events in 60 days, review corridor speeds` });
  const braking = events.filter((e) => e.type === 'harsh_braking').length;
  if (braking >= 3) strengths.push({ ok: false, text: `Harsh braking pattern — ${braking} events; coach on following distance` });
  if (strengths.filter((s) => s.ok).length === 0) strengths.push({ ok: true, text: 'No critical events in the last 7 days' });

  return (
    <div className="flex flex-col gap-4">
      {/* trend chart */}
      <div className="rounded-card border border-border bg-white p-4 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-ink-900">Safety score trend</h3>
          <div className="flex gap-1">
            {(['4W', '12W', '6M'] as const).map((r) => (
              <button key={r} type="button" onClick={() => setRange(r)}
                className={cn('rounded-full px-2.5 py-1 font-mono text-micro font-semibold transition-colors',
                  range === r ? 'bg-accent-soft text-accent-strong' : 'text-ink-400 hover:bg-surface-muted')}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="d360trend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#EDF1F6" vertical={false} />
              <XAxis dataKey="w" tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#7C8DA2' }} tickLine={false} axisLine={{ stroke: '#EDF1F6' }} />
              <YAxis domain={[40, 100]} tick={{ fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#7C8DA2' }} tickLine={false} axisLine={false} />
              <RTooltip />
              <ReferenceLine y={90} stroke="#16A34A" strokeDasharray="6 4" label={{ value: 'Target 90', fill: '#15803D', fontSize: 10, fontFamily: 'JetBrains Mono' }} />
              <Area type="monotone" dataKey="score" name="Safety score" stroke="#06B6D4" strokeWidth={2} fill="url(#d360trend)"
                isAnimationActive animationDuration={900} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-1">
        {/* metric tiles */}
        <div className="col-span-2 grid grid-cols-3 gap-3 max-md:grid-cols-2 max-sm:grid-cols-1">
          {metrics.map((m, i) => (
            <motion.div
              key={m.type}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: i * 0.04, ease: EASE }}
              className="rounded-card border border-border bg-white p-3.5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-pop"
            >
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink-600">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                  <m.meta.icon size={14} />
                </span>
                {m.meta.label}
              </div>
              <div className="mt-2 font-mono text-[20px] font-bold leading-7 text-ink-900">{m.mine.toFixed(1)}</div>
              <div className="text-micro text-ink-400">per 1,000 km</div>
              <div className="mt-2 flex h-8 items-end gap-[3px]">
                {m.spark.map((v, k) => (
                  <motion.span key={k}
                    initial={{ height: 0 }} animate={{ height: `${Math.max(8, Math.min(100, v * 18))}%` }}
                    transition={{ duration: 0.6, delay: 0.1 + k * 0.04 }}
                    className="w-full rounded-sm bg-accent/70" />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-micro text-ink-400">
                <span className="h-1.5 w-6 rounded-full bg-navy-800" title="Fleet avg" />
                fleet {m.fleetAvg.toFixed(1)}
                <span className="h-1.5 w-6 rounded-full bg-accent" title={driver.name} />
                driver
              </div>
            </motion.div>
          ))}
        </div>

        {/* radar */}
        <div className="rounded-card border border-border bg-white p-4 shadow-card">
          <h3 className="text-[15px] font-semibold text-ink-900">Behavior radar</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="#EDF1F6" />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: '#7C8DA2' }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name={driver.name.split(' ')[0]} dataKey="driver" stroke="#06B6D4" fill="#06B6D4" fillOpacity={0.25} isAnimationActive animationDuration={700} />
                <Radar name="Fleet avg" dataKey="fleet" stroke="#0F2540" fill="#0F2540" fillOpacity={0.1} isAnimationActive animationDuration={700} />
                <RTooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* strengths & focus */}
      <div className="rounded-card border border-border bg-white p-4 shadow-card">
        <h3 className="mb-2 text-[15px] font-semibold text-ink-900">Strengths & focus areas</h3>
        <div className="flex flex-col gap-2">
          {strengths.map((s) => (
            <div key={s.text} className="flex items-start gap-2 text-[13px]">
              {s.ok
                ? <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok-on-soft"><Check size={12} /></span>
                : <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-warn-soft text-warn-on-soft"><Flag size={11} /></span>}
              <span className="text-ink-900">{s.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================= TAB 2 — Events & Coaching ================= */

const STAGES: CoachingStatus[] = ['new', 'reviewed', 'coached', 'acknowledged'];

function EventsTab({ driver, events, vehicles }: { driver: Driver; events: SafetyEvent[]; vehicles: ReturnType<typeof useCollection<'vehicles'>> }) {
  const [noteFor, setNoteFor] = useState<SafetyEvent | null>(null);
  const [note, setNote] = useState('');

  const advance = (e: SafetyEvent, to: CoachingStatus) => {
    if (to === 'coached') { setNoteFor(e); setNote(''); return; }
    update('safetyEvents', e.id, { coachingStatus: to });
    logCoaching(driver, e, to);
  };

  const saveCoached = () => {
    if (!noteFor) return;
    update('safetyEvents', noteFor.id, { coachingStatus: 'coached' });
    logCoaching(driver, noteFor, 'coached', note);
    toast({ title: 'Coaching logged', body: 'Logged to audit trail. Awaiting driver ack on mobile.', status: 'ok' });
    setNoteFor(null);
  };

  const columns: Column<SafetyEvent>[] = [
    { key: 'at', header: 'Date', mono: true, width: '150px', render: (e) => fmtDateTimeEAT(e.at) },
    {
      key: 'type', header: 'Type', render: (e) => {
        const M = EVENT_META[e.type];
        return <span className="flex items-center gap-2"><M.icon size={14} className="text-ink-400" />{M.label}</span>;
      },
    },
    { key: 'sev', header: 'Severity', width: '90px', render: (e) => <StatusPill status={SEVERITY_TO_KEY[e.severity]} label={e.severity} /> },
    {
      key: 'veh', header: 'Vehicle', width: '110px',
      render: (e) => {
        const v = vehicles.find((x) => x.id === e.vehicleId);
        return v ? <PlateTag plate={v.plate} /> : <span className="text-ink-400">—</span>;
      },
    },
    {
      key: 'speed', header: 'Speed detail', mono: true, width: '130px',
      render: (e) => (e.type === 'speeding' ? `${e.speedKmh} in 80 zone` : e.speedKmh ? `${e.speedKmh} km/h` : '—'),
    },
    { key: 'coach', header: 'Coaching', width: '130px', render: (e) => <StatusPill status={COACHING_KEY[e.coachingStatus]} label={COACHING_LABEL[e.coachingStatus]} /> },
    {
      key: 'replay', header: '', width: '110px',
      render: () => (
        <Link to="/tracking" onClick={(ev) => ev.stopPropagation()}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-strong hover:underline">
          <PlayCircle size={13} /> View replay
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* pipeline mini-board */}
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {STAGES.map((stage) => {
          const list = events.filter((e) => e.coachingStatus === stage);
          return (
            <div key={stage} className="rounded-card border border-border bg-surface-muted/60 p-2.5">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-600">{COACHING_LABEL[stage]}</span>
                <span className="rounded-full bg-inactive-soft px-1.5 py-0.5 text-micro font-medium text-inactive-on-soft">{list.length}</span>
              </div>
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                {list.map((e) => {
                  const M = EVENT_META[e.type];
                  const idx = STAGES.indexOf(stage);
                  return (
                    <motion.div key={e.id} layout layoutId={e.id}
                      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                      className="rounded-lg border border-border bg-white p-2.5 shadow-card transition-shadow hover:shadow-pop">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-900">
                          <M.icon size={13} className="text-ink-400" /> {M.label}
                        </span>
                        <StatusPill status={SEVERITY_TO_KEY[e.severity]} label={e.severity} />
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-ink-400">{fmtDateTimeEAT(e.at)}</div>
                      <div className="mt-0.5 truncate text-[11px] text-ink-600">{e.location}</div>
                      {stage === 'coached' && (
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-micro font-medium text-warn-on-soft">
                          Waiting for driver ack
                        </span>
                      )}
                      {idx < STAGES.length - 1 && (
                        <button type="button"
                          onClick={() => advance(e, STAGES[idx + 1])}
                          className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-accent-strong hover:underline">
                          Move to {COACHING_LABEL[STAGES[idx + 1]].toLowerCase()} <ChevronRight size={11} />
                        </button>
                      )}
                    </motion.div>
                  );
                })}
                {list.length === 0 && <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-ink-400">No events</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* full table */}
      <DataTable columns={columns} rows={events} pageSize={10}
        empty={<EmptyState icon={BadgeCheck} title="No safety events" hint="This driver has a clean record." />} />

      {/* coaching note modal */}
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title={`Coaching note — ${noteFor ? EVENT_META[noteFor.type].label : ''}`}
        footer={
          <>
            <button type="button" onClick={() => setNoteFor(null)} className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
            <button type="button" onClick={saveCoached} disabled={note.trim().length < 8}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
              Mark coached
            </button>
          </>
        }>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4}
          placeholder="What was discussed with the driver? (min 8 characters)"
          className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        <p className="mt-2 text-micro text-ink-400">The driver will be asked to acknowledge this coaching in the mobile app.</p>
      </Modal>
    </div>
  );
}

function logCoaching(driver: Driver, e: SafetyEvent, to: CoachingStatus, note?: string) {
  add('audit', {
    id: uid('aud'),
    at: nowIso(),
    userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
    collection: 'safetyEvents', recordId: e.id,
    summary: `Coaching ${COACHING_LABEL[to].toLowerCase()} — ${EVENT_META[e.type].label} · ${driver.name}${note ? ` · "${note.slice(0, 60)}"` : ''}`,
    diff: [{ field: 'coachingStatus', before: e.coachingStatus, after: to }],
  });
}

/* ================= TAB 3 — Trips ================= */

function TripsTab({ trips, vehicles }: { trips: ReturnType<typeof useCollection<'trips'>>; vehicles: ReturnType<typeof useCollection<'vehicles'>> }) {
  const columns: Column<(typeof trips)[number]>[] = [
    { key: 'date', header: 'Date', mono: true, width: '140px', render: (t) => fmtDateTimeEAT(t.startAt) },
    {
      key: 'route', header: 'Route', render: (t) => (
        <span className="flex items-center gap-1.5 text-[13px]">
          {t.from} <ChevronRight size={12} className="text-ink-400" /> {t.to}
        </span>
      ),
    },
    { key: 'dist', header: 'Distance', mono: true, align: 'right', width: '100px', render: (t) => fmtKm(t.distanceKm) },
    { key: 'dur', header: 'Duration', mono: true, align: 'right', width: '90px', render: (t) => fmtMin(t.durationMin) },
    {
      key: 'veh', header: 'Vehicle', width: '110px',
      render: (t) => {
        const v = vehicles.find((x) => x.id === t.vehicleId);
        return v ? <PlateTag plate={v.plate} /> : '—';
      },
    },
    {
      key: 'cls', header: 'Class', width: '90px',
      render: (t) => (
        <StatusPill
          status={t.classification === 'business' ? 'info' : t.classification === 'private' ? 'inactive' : 'warn'}
          label={t.classification === 'business' ? 'BIZ' : t.classification === 'private' ? 'PRIV' : 'REVIEW'} />
      ),
    },
    {
      key: 'replay', header: '', width: '70px',
      render: () => (
        <Link to="/tracking" onClick={(e) => e.stopPropagation()} title="Replay trip"
          className="inline-flex items-center gap-1 text-accent-strong hover:underline">
          <PlayCircle size={15} />
        </Link>
      ),
    },
  ];
  return (
    <DataTable columns={columns} rows={trips} pageSize={12}
      empty={<EmptyState icon={Car} title="No trips logged" hint="Trips appear here as the telematics SIM detects them." />} />
  );
}

/* ================= TAB 4 — Documents ================= */

function DocumentsTab({ driver, documents }: { driver: Driver; documents: ReturnType<typeof useCollection<'documents'>> }) {
  const coreDocs = [
    { label: 'Driving Licence', number: driver.licenseNo, expiry: driver.licenseExpiry },
    { label: 'PSV Badge', number: `PSV-KE-${driver.licenseNo.slice(6)}`, expiry: driver.psvExpiry },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      <div className="flex flex-col gap-3">
        {coreDocs.map((d) => {
          const days = daysUntil(d.expiry);
          const key = expiryKey(days);
          const ringScore = Math.max(2, Math.min(100, (Math.max(0, days) / 365) * 100));
          return (
            <div key={d.label} className={cn('flex items-center gap-4 rounded-card border border-border bg-white p-4 shadow-card', days <= 30 && 'bg-alert-soft/40')}>
              <ScoreRing score={ringScore} size={64} stroke={6} />
              <div className="flex-1">
                <div className="text-[14px] font-semibold text-ink-900">{d.label}</div>
                <div className="font-mono text-[12px] tracking-[0.02em] text-ink-600">{d.number}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[12px] text-ink-400">{fmtDateEAT(d.expiry)}</span>
                  <StatusPill status={key} label={daysLeftLabel(days)} />
                </div>
              </div>
              <button type="button"
                onClick={() => toast({ title: 'Upload started', body: `${d.label} — file picker opened.`, status: 'info' })}
                className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">
                <Upload size={14} /> Upload
              </button>
            </div>
          );
        })}
      </div>
      <div className="rounded-card border border-border bg-white p-4 shadow-card">
        <h3 className="mb-3 text-[15px] font-semibold text-ink-900">Uploaded files</h3>
        {documents.length === 0 && (
          <EmptyState title="No files yet" hint="Uploads of the licence and PSV badge scans appear here." />
        )}
        <div className="flex flex-col gap-2">
          {documents.map((d) => {
            const days = daysUntil(d.expiresAt);
            return (
              <div key={d.id} className={cn('flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5', days <= 30 && 'bg-alert-soft/40')}>
                <div>
                  <div className="text-[13px] font-semibold text-ink-900">{d.docType}</div>
                  <div className="font-mono text-[11px] tracking-[0.02em] text-ink-400">{d.number} · issued {fmtDateEAT(d.issuedAt)}</div>
                </div>
                <StatusPill status={expiryKey(days)} label={daysLeftLabel(days)} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================= TAB 5 — Rewards ================= */

const ALL_BADGES = [
  { name: 'Safe July', desc: 'Zero critical events in July', tone: '#16A34A' },
  { name: '500 km Clean', desc: '500 km without a harsh event', tone: '#0F2540' },
  { name: 'Highway Star', desc: 'Top-3 on a long-haul corridor', tone: '#06B6D4' },
  { name: 'Early Bird', desc: 'DVIR completed before 07:00, 5×', tone: '#F59E0B' },
  { name: 'Fuel Miser', desc: 'Best-in-fleet km/L for a month', tone: '#7C3AED' },
  { name: 'Perfect Month', desc: '30 days, zero events of any kind', tone: '#DB2777' },
];

export interface Redemption {
  id: string;
  driverId: string;
  driverName: string;
  item: string;
  pts: number;
  at: string;
  status: 'pending' | 'approved' | 'declined';
}

function RewardsTab({ driver, rank, total, points }: { driver: Driver; rank: number; total: number; points: number }) {
  const all = (useKV('redemptions') as Redemption[] | undefined) ?? [];
  const redemptions = all.filter((r) => r.driverId === driver.id);
  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <div className="rounded-card bg-navy-900 p-5 text-white shadow-card">
        <div className="flex items-center gap-2 text-micro uppercase tracking-[0.06em] text-navy-100/70">
          <Trophy size={12} className="text-accent-on-navy" /> Points balance · Jul 2026
        </div>
        <div className="mt-1 font-mono text-[34px] font-bold leading-10 tracking-[-0.02em] text-accent-on-navy">{fmtNum(points)}</div>
        <div className="text-[12px] text-navy-100">League position #{rank} of {total}</div>
        {medalFor(rank) && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-micro font-semibold"
            style={{ background: medalFor(rank)!.soft, color: medalFor(rank)!.hex }}>
            <Award size={12} /> Podium — {medalFor(rank)!.label} place
          </div>
        )}
        <Link to="/rewards" className="mt-3 flex items-center gap-1 text-[12px] font-semibold text-accent-on-navy hover:underline">
          Open rewards league <ChevronRight size={12} />
        </Link>
      </div>

      <div className="col-span-2 rounded-card border border-border bg-white p-4 shadow-card">
        <h3 className="mb-3 text-[15px] font-semibold text-ink-900">Badge shelf</h3>
        <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
          {ALL_BADGES.map((b) => {
            const earned = driver.badges.includes(b.name);
            return (
              <div key={b.name} title={earned ? b.desc : `Locked — ${b.desc}`}
                className={cn('flex flex-col items-center gap-1.5 rounded-card border p-3 text-center',
                  earned ? 'border-border bg-surface-muted/40' : 'border-dashed border-border opacity-50')}>
                <span className="flex h-11 w-11 items-center justify-center"
                  style={{ clipPath: 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)', background: earned ? b.tone : '#64748B' }}>
                  {earned ? <BadgeCheck size={18} className="text-white" /> : <Lock size={15} className="text-white" />}
                </span>
                <span className="text-[12px] font-semibold text-ink-900">{b.name}</span>
                <span className="text-micro text-ink-400">{earned ? 'Earned' : b.desc}</span>
              </div>
            );
          })}
        </div>
        <h3 className="mb-2 mt-4 text-[15px] font-semibold text-ink-900">Redeem history</h3>
        {redemptions.length === 0
          ? <p className="text-[12px] text-ink-400">No redemptions yet — drivers redeem from the rewards catalog.</p>
          : redemptions.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-border/60 py-2 text-[13px] last:border-0">
              <span className="text-ink-900">{r.item}</span>
              <span className="font-mono text-[12px] text-ink-600">{fmtNum(r.pts)} pts · {fmtDateEAT(r.at)} · {r.status}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
