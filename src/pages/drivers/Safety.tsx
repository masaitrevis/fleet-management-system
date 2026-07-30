// FBV FleetOS — /safety Safety Events, AI Dashcam & Coaching (safety.md).
// KPI strip + 3 tabs: Events Inbox · AI Dashcam · Coaching Board.

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck, Check, FileSpreadsheet, Gauge, LifeBuoy, MapPin,
  OctagonAlert, Phone, PlayCircle, ScanFace, Siren, Trophy, Wind, X, Zap,
} from 'lucide-react';
import {
  Drawer, EmptyState, KPIStatCard, Modal, PlateTag, StatusPill, Tabs, toast,
} from '@/components/shared';
import { useCollection, add, update } from '@/lib/store';
import { SEVERITY_TO_KEY, fmtDateTimeEAT } from '@/lib/format';
import type { CoachingStatus, SafetyEvent, SafetyEventType, Severity } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import { Avatar, EASE, PageEnter, PageSection, exportXlsx, hash01, nowIso, uid } from './helpers';

const SAFETY_EVENT_META: Record<SafetyEventType, { label: string; icon: typeof Gauge }> = {
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

const SEV_BAR: Record<Severity, string> = {
  critical: 'bg-alert', major: 'bg-warn', minor: 'bg-info', info: 'bg-inactive',
};

function eventTitle(e: SafetyEvent): string {
  const h = hash01(e.id);
  const speed = e.speedKmh ?? Math.round(40 + h * 50);
  switch (e.type) {
    case 'harsh_braking': {
      const after = Math.max(18, Math.round(speed * (0.35 + h * 0.25)));
      return `Harsh braking — ${speed}→${after} km/h in ${(1.4 + h * 1.4).toFixed(1)} s`;
    }
    case 'harsh_acceleration':
      return `Harsh acceleration — 0→${speed} km/h in ${(4 + h * 4).toFixed(1)} s`;
    case 'harsh_cornering':
      return `Sharp cornering at ${speed} km/h`;
    case 'speeding':
      return `Speeding ${speed} in 80 zone`;
    case 'seatbelt':
      return `Seatbelt unbuckled > ${Math.round(60 + h * 120)} s`;
    case 'distraction':
      return `Phone use detected — AI confidence ${Math.round(84 + h * 13)}%`;
  }
}

function gForce(e: SafetyEvent): number {
  return Number((0.28 + hash01(`${e.id}-g`) * 0.44).toFixed(2));
}

function reviewer(e: SafetyEvent): { name: string; at: string } {
  const names = ['F. Njoroge', 'W. Maina', 'B. Kibe'];
  const name = names[Math.floor(hash01(`${e.id}-rev`) * names.length)];
  const at = new Date(new Date(e.at).getTime() + (2 + hash01(`${e.id}-revh`) * 30) * 3600000).toISOString();
  return { name, at };
}

function auditCoaching(e: SafetyEvent, from: CoachingStatus, to: CoachingStatus, extra?: string) {
  add('audit', {
    id: uid('aud'),
    at: nowIso(),
    userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
    collection: 'safetyEvents', recordId: e.id,
    summary: `Safety event ${e.id} → ${COACHING_LABEL[to].toLowerCase()}${extra ? ` · ${extra}` : ''}`,
    diff: [{ field: 'coachingStatus', before: from, after: to }],
  });
}

/* ================================================================== */

export default function Safety() {
  const events = useCollection('safetyEvents');
  const drivers = useCollection('drivers');
  const vehicles = useCollection('vehicles');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'inbox';

  const weekAgo = useMemo(() => new Date(`${TODAY}T00:00:00Z`).getTime() - 7 * 86400000, []);
  const open = events.filter((e) => e.coachingStatus === 'new' || e.coachingStatus === 'reviewed');
  const criticalWeek = events.filter((e) => e.severity === 'critical' && new Date(e.at).getTime() >= weekAgo);
  const completion = events.length > 0
    ? Math.round((events.filter((e) => e.coachingStatus === 'coached' || e.coachingStatus === 'acknowledged').length / events.length) * 100)
    : 0;
  const avgCoachDays = (1.4 + hash01('avg-coach') * 0.8).toFixed(1);

  return (
    <PageEnter>
      <PageSection className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Safety</h1>
          <p className="text-[13px] text-ink-400">Telematics harsh events + AI dashcam detections · review → coach → acknowledge</p>
        </div>
      </PageSection>

      {/* KPI mini-strip */}
      <PageSection className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KPIStatCard label="Open events" value={open.length} icon={OctagonAlert}
          delta={`${events.filter((e) => new Date(e.at).getTime() >= weekAgo).length} this week`} />
        <KPIStatCard label="Critical this week" value={criticalWeek.length} icon={Siren}
          delta={criticalWeek.length > 0 ? 'needs review' : 'clear'} deltaGood={criticalWeek.length === 0} />
        <KPIStatCard label="Avg time-to-coach" value={Number(avgCoachDays)} format={(v) => `${v.toFixed(1)} d`} icon={Gauge}
          delta="▼ 0.3 d vs Jun" deltaGood />
        <KPIStatCard label="Coaching completion" value={completion} format={(v) => `${Math.round(v)}%`} icon={BadgeCheck}
          delta="target 90%" deltaGood={completion >= 80} />
      </PageSection>

      <PageSection>
        <Tabs
          tabs={[
            { key: 'inbox', label: 'Events Inbox', count: open.length },
            { key: 'dashcam', label: 'AI Dashcam', count: events.filter((e) => e.dashcamImage).length },
            { key: 'coaching', label: 'Coaching Board' },
          ]}
          active={tab}
          onChange={(k) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n; }, { replace: true })}
        />
      </PageSection>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}>
          {tab === 'inbox' && <InboxTab events={events} drivers={drivers} vehicles={vehicles} />}
          {tab === 'dashcam' && <DashcamTab events={events.filter((e) => e.dashcamImage)} drivers={drivers} vehicles={vehicles} />}
          {tab === 'coaching' && <CoachingBoard events={events} drivers={drivers} vehicles={vehicles} />}
        </motion.div>
      </AnimatePresence>
    </PageEnter>
  );
}

/* ================================================================== */
/* TAB 1 — Events Inbox                                                */
/* ================================================================== */

type InboxProps = {
  events: SafetyEvent[];
  drivers: ReturnType<typeof useCollection<'drivers'>>;
  vehicles: ReturnType<typeof useCollection<'vehicles'>>;
};

function InboxTab({ events, drivers, vehicles }: InboxProps) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<SafetyEvent | null>(null);
  const [noteFor, setNoteFor] = useState<SafetyEvent | null>(null);
  const [note, setNote] = useState('');

  const get = (k: string) => params.get(k) ?? '';
  const setParam = (k: string, v: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true });
  const toggleIn = (k: string, v: string) => {
    const cur = new Set(get(k).split(',').filter(Boolean));
    if (cur.has(v)) cur.delete(v); else cur.add(v);
    setParam(k, Array.from(cur).join(','));
  };
  const sevSel = new Set(get('sev').split(',').filter(Boolean));
  const typeSel = new Set(get('type').split(',').filter(Boolean));
  const statusSel = new Set(get('status').split(',').filter(Boolean));
  const driverSel = get('driver');
  const vehicleSel = get('vehicle');
  const days = Number(get('days') || '7');
  const hasFilters = sevSel.size > 0 || typeSel.size > 0 || statusSel.size > 0 || driverSel || vehicleSel || get('days');

  const statusOf = (e: SafetyEvent): 'unreviewed' | 'coaching' | 'closed' =>
    e.coachingStatus === 'new' ? 'unreviewed' : e.coachingStatus === 'acknowledged' ? 'closed' : 'coaching';

  const filtered = useMemo(() => {
    const cutoff = new Date(`${TODAY}T00:00:00Z`).getTime() - days * 86400000;
    return events.filter((e) => {
      if (sevSel.size > 0 && !sevSel.has(e.severity)) return false;
      if (typeSel.size > 0 && !typeSel.has(e.type)) return false;
      if (statusSel.size > 0 && !statusSel.has(statusOf(e))) return false;
      if (driverSel && e.driverId !== driverSel) return false;
      if (vehicleSel && e.vehicleId !== vehicleSel) return false;
      if (new Date(e.at).getTime() < cutoff) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, params]);

  const countBy = (fn: (e: SafetyEvent) => boolean) => events.filter(fn).length;

  const markReviewed = (list: SafetyEvent[]) => {
    list.forEach((e) => {
      if (e.coachingStatus === 'new') {
        update('safetyEvents', e.id, { coachingStatus: 'reviewed' });
        auditCoaching(e, 'new', 'reviewed');
      }
    });
    toast({ title: `${list.length} event${list.length === 1 ? '' : 's'} marked reviewed`, body: 'Logged to audit trail.', status: 'ok' });
    setSelected(new Set());
  };

  const exportRows = (list: SafetyEvent[]) => exportXlsx(`safety-events-${TODAY}.xlsx`, list.map((e) => ({
    ID: e.id,
    Date: fmtDateTimeEAT(e.at),
    Type: SAFETY_EVENT_META[e.type].label,
    Severity: e.severity,
    Driver: drivers.find((d) => d.id === e.driverId)?.name ?? '',
    Vehicle: vehicles.find((v) => v.id === e.vehicleId)?.plate ?? '',
    Location: e.location,
    'Speed km/h': e.speedKmh ?? '',
    Coaching: COACHING_LABEL[e.coachingStatus],
    Source: e.dashcamImage ? 'AI CAM' : 'TELEMATICS',
  })), 'Safety events');

  const filterGroup = (title: string, children: React.ReactNode) => (
    <div className="border-b border-border/60 px-4 py-3 last:border-0">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
  const check = (group: string, value: string, label: string, count?: number) => (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
      <input type="checkbox"
        checked={(group === 'sev' ? sevSel : group === 'type' ? typeSel : statusSel).has(value)}
        onChange={() => toggleIn(group, value)}
        className="h-3.5 w-3.5 accent-[#06B6D4]" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="font-mono text-[11px] text-ink-400">{count}</span>}
    </label>
  );

  const detailDriver = detail ? drivers.find((d) => d.id === detail.driverId) : null;
  const detailVehicle = detail ? vehicles.find((v) => v.id === detail.vehicleId) : null;

  return (
    <div className="flex gap-4 max-lg:flex-col">
      {/* filter column */}
      <motion.aside
        initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: EASE }}
        className="w-60 shrink-0 self-start rounded-card border border-border bg-white shadow-card max-lg:w-full"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-[13px] font-semibold text-ink-900">Filters</span>
          {hasFilters && (
            <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })}
              className="flex items-center gap-1 rounded-full bg-inactive-soft px-2 py-0.5 text-micro font-medium text-inactive-on-soft hover:bg-border">
              Clear all <X size={10} />
            </button>
          )}
        </div>
        {filterGroup('Severity', (<>
          {(['critical', 'major', 'minor'] as Severity[]).map((s) =>
            check('sev', s, s[0].toUpperCase() + s.slice(1), countBy((e) => e.severity === s)))}
        </>))}
        {filterGroup('Event type', (<>
          {(Object.keys(SAFETY_EVENT_META) as SafetyEventType[]).map((t) =>
            check('type', t, SAFETY_EVENT_META[t].label, countBy((e) => e.type === t)))}
        </>))}
        {filterGroup('Coaching status', (<>
          {check('status', 'unreviewed', 'Unreviewed', countBy((e) => statusOf(e) === 'unreviewed'))}
          {check('status', 'coaching', 'In coaching', countBy((e) => statusOf(e) === 'coaching'))}
          {check('status', 'closed', 'Closed', countBy((e) => statusOf(e) === 'closed'))}
        </>))}
        {filterGroup('Driver', (
          <select value={driverSel} onChange={(e) => setParam('driver', e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-white px-2 text-[13px] outline-none focus:border-accent">
            <option value="">All drivers</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        ))}
        {filterGroup('Vehicle', (
          <select value={vehicleSel} onChange={(e) => setParam('vehicle', e.target.value)}
            className="h-8 w-full rounded-lg border border-border bg-white px-2 font-mono text-[12px] uppercase outline-none focus:border-accent">
            <option value="">All vehicles</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
          </select>
        ))}
        {filterGroup('Date range', (
          <div className="flex gap-1">
            {[7, 30, 60].map((d) => (
              <button key={d} type="button" onClick={() => setParam('days', d === 7 ? '' : String(d))}
                className={cn('flex-1 rounded-full px-2 py-1 font-mono text-micro font-semibold transition-colors',
                  days === d ? 'bg-accent-soft text-accent-strong' : 'text-ink-400 hover:bg-surface-muted')}>
                {d} d
              </button>
            ))}
          </div>
        ))}
      </motion.aside>

      {/* event list */}
      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-card border border-border bg-white shadow-card">
          {filtered.length === 0 && (
            <EmptyState icon={BadgeCheck} title="Inbox zero" hint="No events match these filters." />
          )}
          {filtered.map((e, i) => {
            const M = SAFETY_EVENT_META[e.type];
            const driver = drivers.find((d) => d.id === e.driverId);
            const vehicle = vehicles.find((v) => v.id === e.vehicleId);
            const liveRow = e.id.startsWith('sev-live');
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, delay: Math.min(i, 12) * 0.025, ease: EASE }}
                className={cn(
                  'flex min-h-[72px] cursor-pointer items-stretch border-b border-border/60 transition-colors last:border-0 hover:bg-surface-muted',
                  liveRow && 'animate-alert-flash',
                )}
                onClick={() => setDetail(e)}
              >
                <span className={cn('w-1 shrink-0', SEV_BAR[e.severity])} />
                <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => {
                      const n = new Set(selected);
                      if (ev.target.checked) n.add(e.id); else n.delete(e.id);
                      setSelected(n);
                    }}
                    className="h-4 w-4 shrink-0 accent-[#06B6D4]"
                  />
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                    <M.icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-ink-900">{eventTitle(e)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-600">
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); if (driver) navigate(`/drivers/${driver.id}`); }}
                        className="font-medium hover:text-accent-strong hover:underline">
                        {driver?.name ?? '—'}
                      </button>
                      {vehicle && <PlateTag plate={vehicle.plate} />}
                      <span className="inline-flex items-center gap-1 text-ink-400"><MapPin size={11} />{e.location}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-[11px] tracking-[0.02em] text-ink-400">{fmtDateTimeEAT(e.at)}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.04em]',
                        e.dashcamImage ? 'bg-accent-soft text-accent-strong' : 'bg-navy-900 text-white')}>
                        {e.dashcamImage ? 'AI CAM' : 'TELEMATICS'}
                      </span>
                      <StatusPill status={COACHING_KEY[e.coachingStatus]} label={COACHING_LABEL[e.coachingStatus]} />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="mt-2 font-mono text-micro text-ink-400">{filtered.length} events · last {days} days</div>
      </div>

      {/* bulk bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-5 left-1/2 z-[800] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-white px-4 py-2 shadow-pop">
            <span className="font-mono text-[12px] font-semibold text-ink-900">{selected.size} selected</span>
            <button type="button" onClick={() => markReviewed(filtered.filter((e) => selected.has(e.id)))}
              className="h-8 rounded-full bg-navy-900 px-3 text-[12px] font-semibold text-white hover:bg-navy-800">
              Mark reviewed
            </button>
            <button type="button" onClick={() => toast({ title: 'Coach assigned', body: `W. Maina assigned to ${selected.size} events.`, status: 'info' })}
              className="h-8 rounded-full border border-border px-3 text-[12px] font-medium text-ink-600 hover:bg-surface-muted">
              Assign coach
            </button>
            <button type="button" onClick={() => exportRows(filtered.filter((e) => selected.has(e.id)))}
              className="flex h-8 items-center gap-1 rounded-full border border-border px-3 text-[12px] font-medium text-ink-600 hover:bg-surface-muted">
              <FileSpreadsheet size={13} /> Export
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* detail drawer */}
      <Drawer open={!!detail} onClose={() => setDetail(null)}
        title={detail ? SAFETY_EVENT_META[detail.type].label : ''}>
        {detail && (
          <div className="flex flex-col gap-4">
            {/* snapshot / g-dial */}
            {detail.dashcamImage ? (
              <div className="relative overflow-hidden rounded-card">
                <img src={detail.dashcamImage} alt="Dashcam still" className="w-full" />
                <span className="absolute left-2 top-2"><StatusPill status={SEVERITY_TO_KEY[detail.severity]} label={detail.severity} /></span>
                <div className="absolute inset-x-0 bottom-0 bg-navy-950/70 px-3 py-1.5 font-mono text-[11px] text-white">
                  AI detection: {detail.type === 'distraction' ? 'Phone use' : SAFETY_EVENT_META[detail.type].label} · confidence {Math.round(84 + hash01(detail.id) * 13)}%
                </div>
              </div>
            ) : (
              <GDial value={gForce(detail)} type={detail.type} />
            )}

            {/* facts grid */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { k: 'Speed before', v: `${detail.speedKmh ?? Math.round(40 + hash01(detail.id) * 50)} km/h` },
                { k: 'Speed after', v: detail.type === 'harsh_braking' ? `${Math.max(18, Math.round((detail.speedKmh ?? 60) * 0.45))} km/h` : '—' },
                { k: 'Duration', v: `${(1.2 + hash01(`${detail.id}-d`) * 3).toFixed(1)} s` },
                { k: 'g-force', v: `−${gForce(detail)} g` },
                { k: 'Weather', v: hash01(`${detail.id}-w`) > 0.7 ? 'Light rain' : 'Clear' },
                { k: 'Source', v: detail.dashcamImage ? 'AI dashcam' : 'Telematics' },
              ].map((f) => (
                <div key={f.k} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-micro uppercase tracking-[0.06em] text-ink-400">{f.k}</div>
                  <div className="font-mono text-[13px] font-semibold text-ink-900">{f.v}</div>
                </div>
              ))}
            </div>

            {/* location stub */}
            <div className="rounded-card border border-border p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
                <MapPin size={13} className="text-accent-strong" /> {detail.location}
              </div>
              <div className="relative h-40 overflow-hidden rounded-lg bg-surface-muted">
                <img src="/map-fallback.svg" alt="" className="h-full w-full object-cover opacity-90" />
                <span className="absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${30 + hash01(detail.id) * 40}%`, top: `${30 + hash01(`${detail.id}-y`) * 40}%` }}>
                  <span className="absolute h-full w-full rounded-full bg-alert/40 animate-pulse-live-ring" />
                  <span className="relative block h-4 w-4 rounded-full border-2 border-white bg-alert shadow-card" />
                </span>
              </div>
              <div className="mt-1.5 text-micro text-ink-400">Nearest geofence: FBV Depot · corridor per trip log</div>
            </div>

            {/* people */}
            <div className="flex items-center gap-3 rounded-card border border-border p-3">
              {detailDriver && <Avatar name={detailDriver.name} size={36} />}
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-ink-900">{detailDriver?.name ?? 'Unassigned'}</div>
                <div className="font-mono text-[11px] text-ink-400">{detailVehicle?.plate ?? ''}</div>
              </div>
              {detailDriver && (
                <Link to={`/drivers/${detailDriver.id}`} className="text-[12px] font-semibold text-accent-strong hover:underline">
                  Driver 360° →
                </Link>
              )}
            </div>

            {/* coaching stepper */}
            <div className="rounded-card border border-border p-3">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-400">Coaching workflow</div>
              <div className="flex items-center gap-1">
                {(['new', 'reviewed', 'coached', 'acknowledged'] as CoachingStatus[]).map((s, i, arr) => {
                  const cur = arr.indexOf(detail.coachingStatus);
                  const done = i < cur;
                  const active = i === cur;
                  return (
                    <div key={s} className="flex flex-1 items-center gap-1 last:flex-none">
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        done ? 'bg-ok text-white' : active ? 'bg-accent text-navy-950' : 'bg-inactive-soft text-inactive-on-soft')}>
                        {done ? <Check size={11} /> : i + 1}
                      </span>
                      <span className={cn('text-[10px] font-semibold uppercase', active ? 'text-ink-900' : 'text-ink-400')}>
                        {COACHING_LABEL[s]}
                      </span>
                      {i < arr.length - 1 && <span className={cn('h-px flex-1', done ? 'bg-ok' : 'bg-border')} />}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {detail.coachingStatus === 'new' && (
                  <button type="button"
                    onClick={() => { update('safetyEvents', detail.id, { coachingStatus: 'reviewed' }); auditCoaching(detail, 'new', 'reviewed'); setDetail({ ...detail, coachingStatus: 'reviewed' }); toast({ title: 'Marked reviewed', body: 'Logged to audit trail.', status: 'ok' }); }}
                    className="h-9 rounded-lg bg-navy-900 px-4 text-[13px] font-semibold text-white hover:bg-navy-800">
                    Mark reviewed
                  </button>
                )}
                {detail.coachingStatus === 'reviewed' && (
                  <button type="button" onClick={() => { setNoteFor(detail); setNote(''); }}
                    className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
                    Start coaching
                  </button>
                )}
                {detail.coachingStatus === 'coached' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-micro font-semibold text-warn-on-soft">
                    Awaiting driver ack
                  </span>
                )}
                {detail.coachingStatus === 'acknowledged' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-1 text-micro font-semibold text-ok-on-soft">
                    <BadgeCheck size={12} /> Acknowledged by driver
                  </span>
                )}
                <Link to="/tracking" className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-accent-strong hover:underline">
                  <PlayCircle size={13} /> View on replay →
                </Link>
              </div>
              {detail.coachingStatus !== 'new' && (
                <div className="mt-3 border-t border-border/60 pt-2 font-mono text-[11px] text-ink-400">
                  Reviewed by {reviewer(detail).name} · {fmtDateTimeEAT(reviewer(detail).at)}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* coaching note modal */}
      <Modal open={!!noteFor} onClose={() => setNoteFor(null)} title="Coaching note"
        footer={
          <>
            <button type="button" onClick={() => setNoteFor(null)} className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
            <button type="button" disabled={note.trim().length < 8}
              onClick={() => {
                if (!noteFor) return;
                update('safetyEvents', noteFor.id, { coachingStatus: 'coached' });
                auditCoaching(noteFor, noteFor.coachingStatus, 'coached', note.slice(0, 60));
                if (detail?.id === noteFor.id) setDetail({ ...noteFor, coachingStatus: 'coached' });
                toast({ title: 'Coaching started', body: 'Logged to audit trail. Awaiting driver ack.', status: 'ok' });
                setNoteFor(null);
              }}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
              Mark coached
            </button>
          </>
        }>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4}
          placeholder="Coaching summary (min 8 characters)…"
          className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
      </Modal>
    </div>
  );
}

/* g-force dial (SVG arc + needle) */
function GDial({ value, type }: { value: number; type: SafetyEventType }) {
  const max = 0.9;
  const frac = Math.min(1, value / max);
  const angle = -90 + frac * 180;
  return (
    <div className="flex items-center gap-4 rounded-card border border-border p-4">
      <svg width="140" height="84" viewBox="0 0 140 84">
        <path d="M 10 74 A 60 60 0 0 1 130 74" fill="none" stroke="#EDF1F6" strokeWidth="10" strokeLinecap="round" />
        <path d="M 10 74 A 60 60 0 0 1 130 74" fill="none" stroke={frac > 0.66 ? '#DC2626' : frac > 0.4 ? '#F59E0B' : '#06B6D4'}
          strokeWidth="10" strokeLinecap="round" strokeDasharray={`${frac * 188.5} 188.5`} />
        <motion.line
          x1="70" y1="74" x2="70" y2="26"
          stroke="#0E1B2A" strokeWidth="2.5" strokeLinecap="round"
          initial={{ rotate: -90 }} animate={{ rotate: angle }}
          style={{ transformOrigin: '70px 74px' }}
          transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
        />
        <circle cx="70" cy="74" r="5" fill="#0E1B2A" />
      </svg>
      <div>
        <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Peak {type === 'harsh_acceleration' ? 'accel' : 'decel'}</div>
        <div className="font-mono text-[26px] font-bold leading-8 text-ink-900">−{value} g</div>
        <div className="text-micro text-ink-400">Telematics trigger · threshold 0.40 g</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* TAB 2 — AI Dashcam                                                  */
/* ================================================================== */

function DashcamTab({ events, drivers, vehicles }: InboxProps) {
  const [review, setReview] = useState<SafetyEvent | null>(null);
  const [dismissFor, setDismissFor] = useState<SafetyEvent | null>(null);
  const [reason, setReason] = useState('');
  const [verdictNote, setVerdictNote] = useState('');
  const [scrub, setScrub] = useState(2);

  const confirmToCoaching = () => {
    if (!review) return;
    update('safetyEvents', review.id, { coachingStatus: review.coachingStatus === 'new' ? 'reviewed' : review.coachingStatus });
    auditCoaching(review, review.coachingStatus, 'reviewed', `AI clip confirmed${verdictNote ? ` · ${verdictNote.slice(0, 50)}` : ''}`);
    toast({ title: 'Clip confirmed — to coaching', body: 'Logged to audit trail.', status: 'ok' });
    setReview(null);
    setVerdictNote('');
  };

  const dismiss = () => {
    if (!dismissFor || !reason) return;
    update('safetyEvents', dismissFor.id, { coachingStatus: 'acknowledged' });
    auditCoaching(dismissFor, dismissFor.coachingStatus, 'acknowledged', `False positive — ${reason}`);
    toast({ title: 'Dismissed as false positive', body: `Reason logged for AI retraining: ${reason}.`, status: 'inactive' });
    setDismissFor(null);
    setReason('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-navy-900 px-3 py-1 text-micro font-medium text-navy-100">
          <ScanFace size={12} className="text-accent-on-navy" />
          AI dashcams simulated — clips generated from telematics triggers
        </span>
      </div>

      {events.length === 0 && (
        <div className="rounded-card border border-border bg-white shadow-card">
          <EmptyState icon={ScanFace} title="No AI dashcam clips" hint="Detections appear when the AI flags risky behavior." />
        </div>
      )}

      <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {events.map((e, i) => {
          const M = SAFETY_EVENT_META[e.type];
          const driver = drivers.find((d) => d.id === e.driverId);
          const vehicle = vehicles.find((v) => v.id === e.vehicleId);
          const confidence = Math.round(84 + hash01(e.id) * 13);
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, delay: (i % 8) * 0.05, ease: EASE }}
              className="group overflow-hidden rounded-card border border-border bg-white shadow-card"
            >
              <div className="relative aspect-video overflow-hidden">
                <img src={e.dashcamImage} alt="" className="h-full w-full object-cover transition-transform duration-250 ease-ops group-hover:scale-105" />
                <span className="absolute left-2 top-2"><StatusPill status={SEVERITY_TO_KEY[e.severity]} label={e.severity} /></span>
                <span className="absolute right-2 top-2 rounded-full bg-navy-950/70 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
                  {confidence}%
                </span>
                {/* hover overlay */}
                <div className="absolute inset-0 flex translate-y-3 items-end justify-center gap-2 bg-navy-950/55 p-3 opacity-0 transition-all duration-250 ease-ops group-hover:translate-y-0 group-hover:opacity-100">
                  <button type="button" onClick={() => { setReview(e); setScrub(2); }}
                    className="h-8 rounded-full bg-accent px-3 text-[12px] font-semibold text-navy-950 hover:bg-accent-strong">
                    Review clip
                  </button>
                  <button type="button" onClick={() => setDismissFor(e)}
                    className="h-8 rounded-full bg-white/15 px-3 text-[12px] font-medium text-white hover:bg-white/25">
                    Dismiss
                  </button>
                </div>
              </div>
              <div className="p-3">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                  <M.icon size={14} className="text-accent-strong" /> {M.label}
                  <span className="ml-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-strong">AI</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-600">
                  <span className="truncate">{driver?.name ?? '—'}</span>
                  {vehicle && <PlateTag plate={vehicle.plate} />}
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-ink-400">{fmtDateTimeEAT(e.at)}</span>
                  <StatusPill status={COACHING_KEY[e.coachingStatus]} label={COACHING_LABEL[e.coachingStatus]} />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* review modal */}
      <Modal open={!!review} onClose={() => setReview(null)} wide
        title={review ? `Review clip — ${SAFETY_EVENT_META[review.type].label}` : ''}>
        {review && (
          <div className="grid grid-cols-[1fr,220px] gap-4 max-md:grid-cols-1">
            <div>
              <div className="relative overflow-hidden rounded-card">
                <img src={review.dashcamImage} alt="" className="w-full" />
                <span className="absolute left-2 top-2"><StatusPill status={SEVERITY_TO_KEY[review.severity]} label={review.severity} /></span>
              </div>
              {/* simulated scrub bar */}
              <div className="mt-2 flex gap-1.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <button key={i} type="button" onClick={() => setScrub(i)}
                    className={cn('relative flex-1 overflow-hidden rounded-md border-2 transition-colors',
                      scrub === i ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-90')}>
                    <img src={review.dashcamImage} alt="" className="aspect-video w-full object-cover"
                      style={{ objectPosition: `${i * 20}% 50%`, filter: `brightness(${0.75 + i * 0.06})` }} />
                  </button>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-ink-400">
                <PlayCircle size={12} className="text-accent-strong" />
                frame {scrub + 1}/6 · clip 12 s · simulated scrub
              </div>
              <textarea value={verdictNote} onChange={(e) => setVerdictNote(e.target.value)} rows={2}
                placeholder="Reviewer note (optional)…"
                className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
            </div>
            <div className="flex flex-col gap-2">
              {[
                { k: 'Event', v: SAFETY_EVENT_META[review.type].label },
                { k: 'Severity', v: review.severity.toUpperCase() },
                { k: 'Confidence', v: `${Math.round(84 + hash01(review.id) * 13)}%` },
                { k: 'Driver', v: drivers.find((d) => d.id === review.driverId)?.name ?? '—' },
                { k: 'Vehicle', v: vehicles.find((v) => v.id === review.vehicleId)?.plate ?? '—' },
                { k: 'Timestamp', v: fmtDateTimeEAT(review.at) },
                { k: 'Location', v: review.location },
              ].map((f) => (
                <div key={f.k} className="rounded-lg border border-border px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-[0.06em] text-ink-400">{f.k}</div>
                  <div className="font-mono text-[12px] font-semibold text-ink-900">{f.v}</div>
                </div>
              ))}
              <div className="mt-auto flex flex-col gap-2 pt-2">
                <button type="button" onClick={confirmToCoaching}
                  className="h-9 rounded-lg bg-alert px-3 text-[13px] font-semibold text-white hover:bg-alert-on-soft">
                  Confirmed — to coaching
                </button>
                <button type="button" onClick={() => { setDismissFor(review); setReview(null); }}
                  className="h-9 rounded-lg border border-border px-3 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">
                  False positive
                </button>
                <div className="font-mono text-[10px] text-ink-400">
                  Logged by W. Maina · {fmtDateTimeEAT(nowIso())}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* dismiss (false positive) modal — requires reason */}
      <Modal open={!!dismissFor} onClose={() => setDismissFor(null)} title="Dismiss as false positive"
        footer={
          <>
            <button type="button" onClick={() => setDismissFor(null)} className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
            <button type="button" disabled={!reason} onClick={dismiss}
              className="h-9 rounded-lg bg-inactive px-4 text-[13px] font-semibold text-white hover:bg-inactive-on-soft disabled:opacity-40">
              Dismiss clip
            </button>
          </>
        }>
        <p className="mb-2 text-[13px] text-ink-600">Select a reason — it feeds the AI retraining loop and is logged to the audit trail.</p>
        <div className="flex flex-col gap-1.5">
          {['Shadow / glare misread', 'Driver not using phone', 'Event too minor', 'Wrong driver tagged', 'Duplicate clip'].map((r) => (
            <label key={r} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[13px]',
              reason === r ? 'border-accent bg-accent-soft/40 text-ink-900' : 'border-border text-ink-600 hover:bg-surface-muted')}>
              <input type="radio" name="fp-reason" checked={reason === r} onChange={() => setReason(r)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
              {r}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/* ================================================================== */
/* TAB 3 — Coaching Board (kanban, framer drag)                        */
/* ================================================================== */

const STAGES: CoachingStatus[] = ['new', 'reviewed', 'coached', 'acknowledged'];

function CoachingBoard({ events, drivers, vehicles }: InboxProps) {
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  const dropStage = (clientX: number, clientY: number): CoachingStatus | null => {
    for (let i = 0; i < STAGES.length; i++) {
      const el = colRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return STAGES[i];
    }
    return null;
  };

  const effectiveness = [4.2, 3.9, 3.4, 3.1, 2.6, 2.2, 1.9, 1.6];

  return (
    <div className="flex gap-4 max-xl:flex-col">
      <div className="grid flex-1 grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        {STAGES.map((stage, ci) => {
          const list = events.filter((e) => e.coachingStatus === stage);
          return (
            <div key={stage}
              ref={(el) => { colRefs.current[ci] = el; }}
              className="min-h-[300px] rounded-card border border-border bg-surface-muted/60 p-2.5">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-600">{COACHING_LABEL[stage]}</span>
                <motion.span key={list.length} initial={{ scale: 0.7 }} animate={{ scale: 1 }}
                  className="rounded-full bg-inactive-soft px-1.5 py-0.5 text-micro font-medium text-inactive-on-soft">
                  {list.length}
                </motion.span>
              </div>
              <div className="flex flex-col gap-2">
                {list.slice(0, 12).map((e) => {
                  const M = SAFETY_EVENT_META[e.type];
                  const driver = drivers.find((d) => d.id === e.driverId);
                  const waitH = Math.round(8 + hash01(`${e.id}-wait`) * 60);
                  const acked = new Date(new Date(e.at).getTime() + (24 + hash01(`${e.id}-ack`) * 72) * 3600000).toISOString();
                  return (
                    <motion.div
                      key={e.id}
                      layout
                      drag
                      dragSnapToOrigin
                      dragMomentum={false}
                      whileDrag={{ scale: 1.03, boxShadow: '0 8px 32px rgba(6,15,29,.18)', zIndex: 40 }}
                      onDragEnd={(_, info) => {
                        const stage2 = dropStage(info.point.x, info.point.y);
                        if (stage2 && stage2 !== e.coachingStatus) {
                          const from = e.coachingStatus;
                          update('safetyEvents', e.id, { coachingStatus: stage2 });
                          auditCoaching(e, from, stage2, 'kanban move');
                          toast({ title: `Moved to ${COACHING_LABEL[stage2].toLowerCase()}`, body: 'Logged to audit trail.', status: 'ok' });
                        }
                      }}
                      className="cursor-grab rounded-lg border border-border bg-white p-2.5 shadow-card active:cursor-grabbing"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-900">
                          <M.icon size={13} className="text-ink-400" /> {M.label}
                        </span>
                        <StatusPill status={SEVERITY_TO_KEY[e.severity]} label={e.severity} />
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-600">
                        {driver && <Avatar name={driver.name} size={16} />}
                        <span className="truncate">{driver?.name ?? '—'}</span>
                        {vehicles.find((v) => v.id === e.vehicleId) && (
                          <span className="font-mono text-[10px] text-ink-400">{vehicles.find((v) => v.id === e.vehicleId)!.plate}</span>
                        )}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-ink-400">{fmtDateTimeEAT(e.at)}</div>
                      {stage === 'coached' && (
                        <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-warn-soft px-1.5 py-0.5 text-micro font-medium text-warn-on-soft">
                          {Math.floor(waitH / 24)} d {waitH % 24} h waiting
                        </span>
                      )}
                      {stage === 'acknowledged' && driver && (
                        <span className="mt-1.5 flex items-center gap-1 text-micro font-medium text-ok-on-soft">
                          <BadgeCheck size={12} /> ack {fmtDateTimeEAT(acked)} · {driver.name.split(' ').map((p) => p[0]).join('')}
                        </span>
                      )}
                    </motion.div>
                  );
                })}
                {list.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-ink-400">
                    Drop cards here
                  </div>
                )}
                {list.length > 12 && <div className="px-1 text-micro text-ink-400">+ {list.length - 12} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* effectiveness card */}
      <div className="w-72 shrink-0 self-start rounded-card border border-border bg-white p-4 shadow-card max-xl:w-full">
        <h3 className="text-[15px] font-semibold text-ink-900">Coaching effectiveness</h3>
        <p className="text-micro text-ink-400">Events per 1,000 km after coaching</p>
        <div className="mt-2 flex h-28 items-end gap-2">
          {effectiveness.map((v, i) => (
            <motion.div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-ink-400">{v.toFixed(1)}</span>
              <motion.span
                initial={{ height: 0 }} animate={{ height: `${(v / 4.5) * 72}px` }}
                transition={{ duration: 0.6, delay: i * 0.05 }}
                className={cn('w-full rounded-t', i >= effectiveness.length - 2 ? 'bg-ok' : 'bg-accent/70')} />
              <span className="font-mono text-[9px] text-ink-400">W{i + 1}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-ok-soft px-3 py-2 text-[12px] font-medium text-ok-on-soft">
          ▼ 62% event rate 8 weeks after coaching
        </div>
        <Link to="/rewards" className="mt-3 flex items-center gap-1 text-[12px] font-semibold text-accent-strong hover:underline">
          <Trophy size={13} /> See full league → /rewards
        </Link>
      </div>
    </div>
  );
}
