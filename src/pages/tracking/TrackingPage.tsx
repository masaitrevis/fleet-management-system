// FBV FleetOS — /tracking (design/tracking.md)
// Tab 1: Replay Studio — vehicle + date → TimelineSlider playback of the
// day's route, smart-logging curve explainer, event-synced details drawer.
// Tab 2: Fleet Status — dense live ops table for all 14 vehicles.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Calendar, ChevronLeft, ChevronRight, CircleDot, Clock,
  Download, FileSpreadsheet, Flag, Gauge, Info, KeyRound, MapPin,
  Navigation, PanelRight, Route, Search, SkipBack, SkipForward, Timer,
  Wrench,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { FleetMap, ReplayMarker, RouteOverlay } from '@/components/FleetMap';
import type { FleetMapHandle } from '@/components/FleetMap';
import {
  DataTable, Drawer, EmptyState, PlateTag, StatusPill, Tabs, TimelineSlider,
  toast,
} from '@/components/shared';
import type { Column, TimelineEvent } from '@/components/shared';
import { useCollection, useLivePositions } from '@/lib/store';
import { corridorById } from '@/lib/telematics';
import { TODAY } from '@/lib/seed';
import {
  VEHICLE_STATUS_TO_KEY, fmtNum,
} from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type { Vehicle, VehicleStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  buildDayReplay, humanizeMin, parkedAt, sampleTripAt,
  secToHHMM, secToHHMMSS,
} from './replay';
import type { DayReplay, ReplayEvent, TripReplay } from './replay';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const normPlate = (p: string) => p.replace(/\s/g, '').toUpperCase();

/* ================================================================== */
/* Vehicle autocomplete                                                */
/* ================================================================== */

function VehiclePicker({ vehicles, value, onChange }: {
  vehicles: Vehicle[]; value: string; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = vehicles.find((v) => v.id === value);
  const rows = vehicles.filter((v) =>
    !q || v.plate.toLowerCase().includes(q.toLowerCase()) || v.model.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 shadow-card hover:border-ink-400/50">
        {current ? <PlateTag plate={current.plate} /> : <span className="text-[13px] text-ink-400">Pick vehicle</span>}
        <span className="hidden max-w-[140px] truncate text-[12px] text-ink-400 sm:block">{current?.model}</span>
        <ChevronRight size={14} className={cn('text-ink-400 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-[800] w-72 rounded-xl border border-border bg-white p-2 shadow-pop"
          onMouseLeave={() => setOpen(false)}>
          <div className="mb-1 flex h-8 items-center gap-2 rounded-lg border border-border bg-surface-muted px-2">
            <Search size={13} className="text-ink-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plate or model…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-400" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {rows.map((v) => (
              <button key={v.id} type="button"
                onClick={() => { onChange(v.id); setOpen(false); setQ(''); }}
                className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-muted',
                  v.id === value && 'bg-accent-soft')}>
                <PlateTag plate={v.plate} />
                <span className="flex-1 truncate text-[12px] text-ink-600">{v.model}</span>
                <span className={cn('h-1.5 w-1.5 rounded-full',
                  v.status === 'moving' ? 'bg-ok' : v.status === 'idling' ? 'bg-warn' : v.status === 'offline' ? 'bg-alert' : 'bg-inactive')} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Date picker with trip-day dots                                      */
/* ================================================================== */

function DatePicker({ date, onChange, tripDates }: {
  date: string; onChange: (d: string) => void; tripDates: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(date.slice(0, 7)); // YYYY-MM
  useEffect(() => { setMonth(date.slice(0, 7)); }, [date]);

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const startDow = (first.getUTCDay() + 6) % 7; // Mon = 0
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out: (string | null)[] = Array(startDow).fill(null);
    for (let d = 1; d <= days; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
    return out;
  }, [month]);

  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  const label = (() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const [y, m, d] = date.split('-').map(Number);
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${dow} ${d} ${months[m - 1]} ${y}`;
  })();

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-900 shadow-card hover:border-ink-400/50">
        <Calendar size={14} className="text-accent-strong" />
        <span className="font-mono text-[12px]">{label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-[800] w-[264px] rounded-xl border border-border bg-white p-3 shadow-pop"
          onMouseLeave={() => setOpen(false)}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-muted"><ChevronLeft size={14} /></button>
            <span className="font-mono text-[12px] font-semibold text-ink-900">{month}</span>
            <button type="button" onClick={() => shiftMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-muted"><ChevronRight size={14} /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase text-ink-400">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="py-0.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => d === null ? <div key={i} /> : (
              <button key={i} type="button"
                onClick={() => { onChange(d); setOpen(false); }}
                className={cn('relative flex h-8 flex-col items-center justify-center rounded-md text-[12px] transition-colors',
                  d === date ? 'bg-navy-900 font-semibold text-white' : 'hover:bg-surface-muted',
                  d === TODAY && d !== date && 'ring-1 ring-accent')}>
                {Number(d.slice(8))}
                {tripDates.has(d) && (
                  <span className={cn('absolute bottom-0.5 h-1 w-1 rounded-full', d === date ? 'bg-accent-on-navy' : 'bg-accent')} />
                )}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-[10px] text-ink-400">
            <span className="h-1 w-1 rounded-full bg-accent" /> days with recorded trips
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Day band (06:00–22:00 driven/idle/stop strip above the slider)      */
/* ================================================================== */

function DayBand({ day, tSec }: { day: DayReplay; tSec: number }) {
  const span = day.windowEnd - day.windowStart;
  const frac = (t: number) => Math.max(0, Math.min(1, (t - day.windowStart) / span));
  const hours: number[] = [];
  for (let h = Math.ceil(day.windowStart / 3600); h <= Math.floor(day.windowEnd / 3600); h += 2) hours.push(h);
  return (
    <div className="px-1">
      <div className="relative h-4 overflow-hidden rounded-full bg-surface-muted">
        {day.trips.map((r) => (
          <div key={r.trip.id}>
            <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-accent/70 to-accent"
              style={{ left: `${frac(r.tStart) * 100}%`, width: `${(frac(r.tEnd) - frac(r.tStart)) * 100}%` }} />
            {r.idleSpans.map((s, i) => (
              <div key={i} className="absolute inset-y-0 bg-warn"
                style={{ left: `${frac(s.tStart) * 100}%`, width: `${Math.max(0.4, (frac(s.tEnd) - frac(s.tStart)) * 100)}%` }} />
            ))}
          </div>
        ))}
        {day.events.filter((e) => e.kind === 'harsh' || e.kind === 'geofence').map((e) => (
          <span key={e.id} title={e.label}
            className={cn('absolute top-0 h-full w-[3px] transition-transform hover:scale-x-[2.2]',
              e.kind === 'harsh' ? 'bg-alert' : 'bg-navy-900')}
            style={{ left: `${frac(e.tSec) * 100}%` }} />
        ))}
        <span className="absolute inset-y-0 w-[2px] bg-navy-950" style={{ left: `${frac(tSec) * 100}%` }} />
      </div>
      <div className="relative mt-0.5 h-3.5">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 font-mono text-[9px] text-ink-400"
            style={{ left: `${((h * 3600 - day.windowStart) / span) * 100}%` }}>
            {String(h).padStart(2, '0')}:00
          </span>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Event details drawer (synced to playhead)                           */
/* ================================================================== */

const EVENT_ICON: Record<ReplayEvent['kind'], typeof Flag> = {
  harsh: AlertTriangle, geofence: MapPin, stop: Flag, idle: Timer, trip: Navigation,
};
const EVENT_SEV: Record<ReplayEvent['kind'], StatusKey> = {
  harsh: 'alert', geofence: 'info', stop: 'inactive', idle: 'warn', trip: 'ok',
};

function EventsDrawer({ open, onClose, events, tSec, onSeek }: {
  open: boolean; onClose: () => void;
  events: ReplayEvent[]; tSec: number;
  onSeek: (e: ReplayEvent) => void;
}) {
  const passed = events.filter((e) => e.tSec <= tSec);
  const activeId = passed.length ? passed[passed.length - 1].id : null;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !activeId) return;
    listRef.current?.querySelector(`[data-ev="${activeId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId, open]);
  return (
    <Drawer open={open} onClose={onClose} title="Day events — synced to playhead" width={420}>
      <div ref={listRef} className="flex flex-col gap-1.5">
        {events.length === 0 && <EmptyState icon={Flag} title="No events" hint="This day has no logged events for the vehicle." />}
        {events.map((e) => {
          const Icon = EVENT_ICON[e.kind];
          const isActive = e.id === activeId;
          const isPassed = e.tSec <= tSec;
          return (
            <button key={e.id} type="button" data-ev={e.id} onClick={() => onSeek(e)}
              className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-muted',
                isActive ? 'border-accent bg-accent-soft/60' : 'border-border',
                !isPassed && 'opacity-55')}>
              <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
                e.kind === 'harsh' ? 'bg-alert-soft text-alert' : e.kind === 'idle' ? 'bg-warn-soft text-warn-on-soft'
                  : e.kind === 'geofence' ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
                <Icon size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-ink-900">{secToHHMMSS(e.tSec)}</span>
                  <span className="truncate text-[13px] font-medium text-ink-900">{e.label}</span>
                </span>
                {e.detail && <span className="block truncate text-[11px] text-ink-400">{e.detail}</span>}
              </span>
              <StatusPill status={EVENT_SEV[e.kind]} label={e.kind} className="shrink-0" />
            </button>
          );
        })}
      </div>
    </Drawer>
  );
}

/* ================================================================== */
/* TAB 1 — Replay Studio                                               */
/* ================================================================== */

function SmartLoggingChip({ count }: { count: number }) {
  return (
    <span
      title="Curve logging: the tracker records points adaptively — dense on turns and speed changes, sparse on straight cruise — so the curve is faithful without flooding storage."
      className="inline-flex cursor-help items-center gap-2 rounded-full border border-info/30 bg-info-soft px-3 py-1.5 text-[11px] font-medium text-info-on-soft">
      <Info size={12} />
      <svg width="54" height="16" viewBox="0 0 54 16" className="shrink-0">
        <path d="M2 12 C 12 12, 16 2, 28 4 S 46 14, 52 6" fill="none" stroke="#1D4ED8" strokeWidth="1.4" />
        {[3, 9, 14, 17, 19, 21, 24, 27, 31, 36, 42, 47, 51].map((x, i) => {
          const y = [12, 11, 9, 6, 3.4, 2.8, 3, 4, 6, 8, 11, 12, 7][i];
          return <circle key={i} cx={x} cy={y} r="1.3" fill="#1D4ED8" />;
        })}
      </svg>
      Smart logging: <b className="font-mono">{fmtNum(count)}</b> points recorded — denser on turns &amp; speed changes
    </span>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-400">{label}</span>
      <span className="font-mono text-[15px] font-semibold leading-6 text-ink-900 tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-ink-400">{sub}</span>}
    </div>
  );
}

export function ReplayStudio({ initialVehicle, initialDate, initialTrip, keySeed }: {
  initialVehicle?: string; initialDate?: string; initialTrip?: string; keySeed?: number;
}) {
  const vehicles = useCollection('vehicles');
  const trips = useCollection('trips');
  const safetyEvents = useCollection('safetyEvents');
  const geofences = useCollection('geofences');
  const mapRef = useRef<FleetMapHandle>(null);

  const defaultVehicle = vehicles[0]?.id ?? '';
  const [vehicleId, setVehicleId] = useState(initialVehicle ?? defaultVehicle);
  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? vehicles[0];

  // dates that have trips for the selected vehicle
  const tripDates = useMemo(
    () => new Set(trips.filter((t) => t.vehicleId === vehicle?.id).map((t) => t.startAt.slice(0, 10))),
    [trips, vehicle?.id],
  );
  const latestTripDate = useMemo(() => {
    const ds = [...tripDates].filter((d) => d <= TODAY).sort();
    return ds.length ? ds[ds.length - 1] : TODAY;
  }, [tripDates]);

  const [date, setDate] = useState(initialDate ?? '');
  useEffect(() => { if (!date) setDate(initialDate && tripDates.has(initialDate) ? initialDate : latestTripDate); }, [date, initialDate, latestTripDate, tripDates]);

  // switch vehicle → jump to its latest trip date
  const onVehicle = useCallback((id: string) => {
    setVehicleId(id);
    const ds = [...new Set(trips.filter((t) => t.vehicleId === id).map((t) => t.startAt.slice(0, 10)))]
      .filter((d) => d <= TODAY).sort();
    setDate(ds.length ? ds[ds.length - 1] : TODAY);
    setTripIdx(0);
  }, [trips]);

  const day = useMemo<DayReplay | null>(() => {
    if (!vehicle || !date) return null;
    return buildDayReplay(vehicle, date, trips, safetyEvents, geofences);
  }, [vehicle, date, trips, safetyEvents, geofences]);

  const [tripIdx, setTripIdx] = useState(0);
  const selTrip: TripReplay | null = day && day.trips.length ? day.trips[Math.min(tripIdx, day.trips.length - 1)] : null;

  // playback state
  const [tSec, setTSec] = useState(day?.windowStart ?? 6 * 3600);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deckH, setDeckH] = useState(250);

  // reset playhead when day changes; honor deep-linked trip
  useEffect(() => {
    if (!day) return;
    if (initialTrip) {
      const idx = day.trips.findIndex((r) => r.trip.id === initialTrip);
      if (idx >= 0) {
        setTripIdx(idx);
        setTSec(day.trips[idx].tStart);
        return;
      }
    }
    setTripIdx(0);
    setTSec(day.trips.length ? day.trips[0].tStart : day.windowStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, keySeed]);

  // fit map to selected trip
  useEffect(() => {
    if (selTrip) mapRef.current?.fitPoints(selTrip.path);
  }, [selTrip?.trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // rAF playback loop
  const tSecRef = useRef(tSec);
  tSecRef.current = tSec;
  useEffect(() => {
    if (!playing || !day) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = tSecRef.current + dt * speed;
      if (next >= day.windowEnd) {
        setTSec(day.windowEnd);
        setPlaying(false);
        return;
      }
      setTSec(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, day]);

  // keyboard: space play/pause, arrows ±30s
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying((p) => !p); }
      if (e.code === 'ArrowLeft') setTSec((t) => Math.max(day?.windowStart ?? 0, t - 30));
      if (e.code === 'ArrowRight') setTSec((t) => Math.min(day?.windowEnd ?? 86400, t + 30));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [day]);

  // marker position + ghost breadcrumbs
  const liveTrip = useMemo(() => {
    if (!day) return null;
    return day.trips.find((r) => tSec >= r.tStart && tSec <= r.tEnd) ?? null;
  }, [day, tSec]);
  const marker = useMemo(() => {
    if (!day) return null;
    if (liveTrip) return sampleTripAt(liveTrip, tSec);
    return parkedAt(day, tSec);
  }, [day, liveTrip, tSec]);

  const [ghosts, setGhosts] = useState<[number, number][]>([]);
  const ghostsRef = useRef<[number, number][]>([]);
  useEffect(() => {
    if (!marker || !liveTrip) { if (!liveTrip) { ghostsRef.current = []; setGhosts([]); } return; }
    const g = ghostsRef.current;
    const lastPt = g[0];
    const moved = !lastPt || Math.hypot(marker.lat - lastPt[0], marker.lng - lastPt[1]) > 0.0006;
    if (moved && marker.speedKmh > 4) {
      ghostsRef.current = [[marker.lat, marker.lng] as [number, number], ...g].slice(0, 8);
      setGhosts(ghostsRef.current.slice(1));
    }
  }, [marker, liveTrip]);

  const seekToEvent = useCallback((e: ReplayEvent) => {
    setTSec(e.tSec);
    mapRef.current?.flyTo(e.lat, e.lng, 14);
  }, []);

  const jumpTrip = (n: number) => {
    if (!day || day.trips.length === 0) return;
    const idx = Math.max(0, Math.min(day.trips.length - 1, n));
    setTripIdx(idx);
    setTSec(day.trips[idx].tStart);
  };

  const progress = day ? Math.max(0, Math.min(1, (tSec - day.windowStart) / (day.windowEnd - day.windowStart))) : 0;
  const sliderEvents: TimelineEvent[] = useMemo(() => {
    if (!day) return [];
    const span = day.windowEnd - day.windowStart;
    return day.events.map((e) => ({
      at: Math.max(0, Math.min(1, (e.tSec - day.windowStart) / span)),
      kind: e.kind === 'harsh' ? 'harsh' : e.kind === 'geofence' ? 'geofence' : 'stop',
      label: e.label,
    }));
  }, [day]);

  const stats = selTrip?.stats ?? day?.dayStats;
  const emptyPositions = useMemo(() => new Map(), []);

  return (
    <div className="flex h-full flex-col">
      {/* map zone */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}
        className="relative min-h-[320px] flex-1">
        <FleetMap
          ref={mapRef}
          positions={emptyPositions}
          geofences={geofences}
          showControls={false}
          center={[-1.3, 36.85]}
          zoom={11}
        >
          {day?.trips.map((r, i) => i !== tripIdx && (
            <RouteOverlay key={r.trip.id} path={r.path} chevrons={false} />
          ))}
          {selTrip && (
            <RouteOverlay
              path={selTrip.path}
              stops={selTrip.stopPoints.map((s) => ({ lat: s.lat, lng: s.lng, label: s.label }))}
              idlePaths={selTrip.idlePaths}
              events={selTrip.events
                .filter((e) => e.kind === 'harsh' || e.kind === 'geofence')
                .map((e) => ({ lat: e.lat, lng: e.lng, kind: e.kind as 'harsh' | 'geofence', label: `${e.label} · ${secToHHMMSS(e.tSec)}${e.detail ? ` — ${e.detail}` : ''}` }))}
            />
          )}
          {marker && (
            <ReplayMarker
              lat={marker.lat} lng={marker.lng} heading={marker.heading}
              ghosts={ghosts}
              plate={vehicle?.plate}
              speedKmh={marker.speedKmh}
            />
          )}
        </FleetMap>

        {/* map control stack */}
        <div className="absolute bottom-4 right-4 z-[700] flex flex-col items-end gap-2">
          <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-white shadow-card">
            <button type="button" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}
              className="flex h-9 w-9 items-center justify-center text-ink-600 hover:bg-surface-muted"><span className="text-lg leading-none">+</span></button>
            <div className="h-px bg-border" />
            <button type="button" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}
              className="flex h-9 w-9 items-center justify-center text-ink-600 hover:bg-surface-muted"><span className="text-lg leading-none">−</span></button>
          </div>
          <button type="button" onClick={() => selTrip && mapRef.current?.fitPoints(selTrip.path)}
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-micro font-semibold uppercase tracking-[0.06em] text-ink-600 shadow-card hover:bg-surface-muted">
            Fit route
          </button>
          <span className="rounded-lg border border-border bg-white px-2.5 py-1.5 font-mono text-micro font-semibold text-accent-strong shadow-card">
            {speed}× REPLAY
          </span>
        </div>

        {day && day.trips.length === 0 && (
          <div className="absolute inset-0 z-[680] flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
            <EmptyState
              icon={Route}
              title={`No trips recorded for ${vehicle?.plate ?? 'this vehicle'}`}
              hint={`${date} has no logged trips — pick a calendar day marked with a cyan dot.`}
            />
          </div>
        )}
      </motion.div>

      {/* draggable splitter */}
      <div
        className="group flex h-2 shrink-0 cursor-row-resize items-center justify-center border-t border-border bg-white"
        onPointerDown={(e) => {
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const startY = e.clientY;
          const startH = deckH;
          const move = (ev: PointerEvent) => setDeckH(Math.max(210, Math.min(430, startH + (startY - ev.clientY))));
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        <span className="h-1 w-10 rounded-full bg-border group-hover:bg-accent" />
      </div>

      {/* control deck */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
        className="shrink-0 overflow-y-auto bg-white" style={{ height: deckH }}>
        {/* Row 1 — selectors */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <VehiclePicker vehicles={vehicles} value={vehicle?.id ?? ''} onChange={onVehicle} />
          <DatePicker date={date || TODAY} onChange={(d) => { setDate(d); setTripIdx(0); }} tripDates={tripDates} />
          {day && day.trips.length > 0 && (
            <>
              <select
                value={Math.min(tripIdx, day.trips.length - 1)}
                onChange={(e) => jumpTrip(Number(e.target.value))}
                className="h-10 max-w-[340px] rounded-lg border border-border bg-white px-2 font-mono text-[12px] text-ink-900 shadow-card outline-none focus:border-accent">
                {day.trips.map((r, i) => (
                  <option key={r.trip.id} value={i}>
                    {`Trip ${i + 1} of ${day.trips.length} · ${secToHHMM(r.tStart)}–${secToHHMM(r.tEnd)} · ${r.trip.from} → ${r.trip.to} · ${fmtNum(r.trip.distanceKm)} km`}
                  </option>
                ))}
              </select>
              <div className="flex overflow-hidden rounded-lg border border-border shadow-card">
                <button type="button" title="Previous trip" disabled={tripIdx <= 0} onClick={() => jumpTrip(tripIdx - 1)}
                  className="flex h-10 w-9 items-center justify-center text-ink-600 hover:bg-surface-muted disabled:opacity-40"><SkipBack size={15} /></button>
                <div className="w-px bg-border" />
                <button type="button" title="Next trip" disabled={tripIdx >= day.trips.length - 1} onClick={() => jumpTrip(tripIdx + 1)}
                  className="flex h-10 w-9 items-center justify-center text-ink-600 hover:bg-surface-muted disabled:opacity-40"><SkipForward size={15} /></button>
              </div>
            </>
          )}
          <button type="button" onClick={() => setDetailsOpen(true)}
            className="ml-auto flex h-10 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-900 shadow-card hover:bg-surface-muted">
            <PanelRight size={15} /> Details
            {day && <span className="rounded-full bg-accent-soft px-1.5 font-mono text-[10px] font-bold text-accent-strong">{day.events.length}</span>}
          </button>
        </div>

        {/* Row 2 — timeline */}
        <div className="flex flex-col gap-1.5 px-4 pt-2.5">
          {day && <DayBand day={day} tSec={tSec} />}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <TimelineSlider
                durationLabel={`${secToHHMM(day?.windowStart ?? 21600)} – ${secToHHMM(day?.windowEnd ?? 79200)}`}
                events={sliderEvents}
                playing={playing}
                speed={speed}
                onPlayPause={() => setPlaying(!playing)}
                onSpeed={setSpeed}
                onScrub={(f) => day && setTSec(day.windowStart + f * (day.windowEnd - day.windowStart))}
                progress={progress}
              />
            </div>
            <div className="hidden shrink-0 items-center gap-2 rounded-card border border-border bg-navy-900 px-3 py-2 shadow-card md:flex">
              <Gauge size={14} className="text-accent-on-navy" />
              <span className="font-mono text-[13px] font-semibold tabular-nums text-white">
                {secToHHMMSS(tSec)} EAT · {Math.round(marker?.speedKmh ?? 0)} km/h
              </span>
            </div>
          </div>
        </div>

        {/* Row 3 — trip stats + explainer */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pb-3 pt-2.5">
          {stats && (
            <>
              <StatCell label="Distance" value={`${fmtNum(stats.distanceKm, 1)} km`} />
              <StatCell label="Drive time" value={humanizeMin(stats.driveMin)} />
              <StatCell label="Idle" value={humanizeMin(stats.idleMin)} />
              <StatCell label="Max speed" value={`${Math.round(stats.maxSpeedKmh)} km/h`} />
              <StatCell label="Avg" value={`${Math.round(stats.avgSpeedKmh)} km/h`} />
              <StatCell label="Events" value={`${stats.harshCount} harsh · ${stats.geofenceCount} geofence`} />
            </>
          )}
          <span className="ml-auto">{day && <SmartLoggingChip count={day.loggedPoints} />}</span>
        </div>
      </motion.div>

      <EventsDrawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        events={day?.events ?? []}
        tSec={tSec}
        onSeek={seekToEvent}
      />
    </div>
  );
}

/* ================================================================== */
/* TAB 2 — Fleet Status                                                */
/* ================================================================== */

type StatusFilter = 'all' | VehicleStatus;

function FleetStatusTab({ onReplay }: { onReplay: (vehicleId: string) => void }) {
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const geofences = useCollection('geofences');
  const live = useLivePositions();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [compact, setCompact] = useState(false);

  const liveMap = useMemo(() => new Map(live.map((p) => [p.vehicleId, p])), [live]);
  const driverOf = useCallback((id: string | null) => drivers.find((d) => d.id === id)?.name ?? 'Unassigned', [drivers]);

  const locationOf = useCallback((v: Vehicle): string => {
    const p = liveMap.get(v.id);
    if (p) {
      let best: string | null = null;
      let bestD = Infinity;
      for (const g of geofences) {
        const c = g.center ?? (g.polygon && g.polygon.length
          ? { lat: g.polygon.reduce((s, x) => s + x.lat, 0) / g.polygon.length, lng: g.polygon.reduce((s, x) => s + x.lng, 0) / g.polygon.length }
          : undefined);
        if (!c) continue;
        const d = Math.hypot(c.lat - p.lat, c.lng - p.lng);
        if (d < bestD) { bestD = d; best = g.name; }
      }
      if (best && bestD < 0.02) return `at ${best}`;
      if (best && bestD < 0.12) return `near ${best}`;
    }
    return corridorById(v.simRoute).name;
  }, [liveMap, geofences]);

  const ago = useCallback((at?: number): { label: string; stale: boolean } => {
    if (!at) return { label: '—', stale: true };
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    const stale = s > 600;
    if (s < 60) return { label: `${s} s ago`, stale };
    if (s < 3600) return { label: `${Math.floor(s / 60)} min ago`, stale };
    return { label: `${Math.floor(s / 3600)} h ago`, stale };
  }, []);

  const counts = useMemo(() => {
    const c: Record<VehicleStatus, number> = { moving: 0, idling: 0, stopped: 0, offline: 0 };
    vehicles.forEach((v) => { c[liveMap.get(v.id)?.status ?? v.status]++; });
    return c;
  }, [vehicles, liveMap]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vehicles.filter((v) => {
      const st = liveMap.get(v.id)?.status ?? v.status;
      if (filter !== 'all' && st !== filter) return false;
      if (!needle) return true;
      return v.plate.toLowerCase().includes(needle)
        || v.model.toLowerCase().includes(needle)
        || driverOf(v.assignedDriverId).toLowerCase().includes(needle);
    });
  }, [vehicles, liveMap, filter, q, driverOf]);

  const exportExcel = useCallback(() => {
    const data = rows.map((v) => {
      const p = liveMap.get(v.id);
      return {
        Plate: v.plate, Vehicle: `${v.make} ${v.model} (${v.year})`,
        Status: (p?.status ?? v.status).toUpperCase(),
        Driver: driverOf(v.assignedDriverId),
        'Speed (km/h)': p?.speedKmh ?? 0,
        Location: locationOf(v),
        Ignition: p?.ignition ? 'ON' : 'OFF',
        'Odometer (km)': v.odometerKm,
        'Fuel %': v.fuelLevelPct,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = Object.keys(data[0] ?? { Plate: 1 }).map((k) => ({ wch: Math.max(12, k.length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fleet status');
    XLSX.writeFile(wb, `fleet-status-${TODAY}.xlsx`);
    toast({ title: 'Export ready', body: `fleet-status-${TODAY}.xlsx — ${rows.length} vehicles.`, status: 'ok' });
  }, [rows, liveMap, driverOf, locationOf]);

  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: vehicles.length },
    { key: 'moving', label: 'Moving', count: counts.moving },
    { key: 'idling', label: 'Idling', count: counts.idling },
    { key: 'stopped', label: 'Stopped', count: counts.stopped },
    { key: 'offline', label: 'Offline', count: counts.offline },
  ];

  const columns: Column<Vehicle>[] = [
    {
      key: 'status', header: 'Status', width: '110px',
      render: (v) => {
        const st = liveMap.get(v.id)?.status ?? v.status;
        return <StatusPill status={VEHICLE_STATUS_TO_KEY[st]} label={st} pulse={st === 'moving'} />;
      },
    },
    { key: 'plate', header: 'Plate', render: (v) => <PlateTag plate={v.plate} /> },
    { key: 'vehicle', header: 'Vehicle', render: (v) => <span className="text-[13px] text-ink-900">{v.make} {v.model} <span className="text-ink-400">{v.year}</span></span> },
    { key: 'driver', header: 'Driver', render: (v) => <span className="text-[13px] text-ink-600">{driverOf(v.assignedDriverId)}</span> },
    {
      key: 'speed', header: 'Speed', mono: true, align: 'right',
      render: (v) => {
        const p = liveMap.get(v.id);
        return <span key={p?.at} className="transition-opacity duration-200">{p?.speedKmh ?? 0} km/h</span>;
      },
    },
    { key: 'location', header: 'Location', render: (v) => <span className="text-[13px] text-ink-600">{locationOf(v)}</span> },
    {
      key: 'ignition', header: 'Ign', align: 'center',
      render: (v) => {
        const on = liveMap.get(v.id)?.ignition ?? false;
        return <KeyRound size={15} className={cn('inline', on ? 'text-ok' : 'text-inactive')} />;
      },
    },
    { key: 'odo', header: 'Odometer', mono: true, align: 'right', render: (v) => `${fmtNum(v.odometerKm)} km` },
    {
      key: 'fuel', header: 'Fuel', width: '90px',
      render: (v) => (
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-border">
            <span className={cn('block h-full rounded-full', v.fuelLevelPct < 25 ? 'bg-alert' : v.fuelLevelPct < 50 ? 'bg-warn' : 'bg-ok')}
              style={{ width: `${v.fuelLevelPct}%` }} />
          </span>
          <span className="font-mono text-[11px] text-ink-600">{v.fuelLevelPct}%</span>
        </span>
      ),
    },
    {
      key: 'updated', header: 'Last update', mono: true,
      render: (v) => {
        const a = ago(liveMap.get(v.id)?.at);
        return <span className={a.stale ? 'text-alert' : 'text-ink-600'}>{a.label}</span>;
      },
    },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }}
      className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 w-64 items-center gap-2 rounded-lg border border-border bg-white px-3 shadow-card">
          <Search size={14} className="shrink-0 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plate, model, driver…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-400" />
        </div>
        <div className="flex gap-1">
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => setFilter(c.key)}
              className={cn('rounded-full px-2.5 py-1 text-micro font-semibold transition-colors',
                filter === c.key ? 'bg-navy-900 text-white' : 'bg-surface-muted text-ink-600 hover:bg-border')}>
              {c.label} <span className="font-mono">{c.count}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setCompact(!compact)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[12px] font-semibold text-ink-600 shadow-card hover:bg-surface-muted">
            <Clock size={13} /> {compact ? 'Compact' : 'Comfortable'}
          </button>
          <button type="button" onClick={exportExcel}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white shadow-card hover:bg-navy-800">
            <Download size={13} /> Export Excel
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        compact={compact}
        pageSize={compact ? 20 : 12}
        onRowClick={(v) => onReplay(v.id)}
        empty={<EmptyState icon={Search} title="No vehicles match" hint="Adjust the search or status filter." />}
        rowActions={(v) => [
          { label: 'Replay today', icon: Route, onClick: () => onReplay(v.id) },
          { label: 'Vehicle 360°', icon: CircleDot, onClick: () => navigate(`/vehicles/${v.id}`) },
          { label: 'Create WO', icon: Wrench, onClick: () => navigate('/maintenance') },
        ]}
      />
      <div className="flex items-center gap-2 text-[11px] text-ink-400">
        <FileSpreadsheet size={12} />
        Live cells refresh on the 2 s telematics tick · Last-update turns red after 10 min offline · Click a row to replay its day
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export default function TrackingPage() {
  const [params] = useSearchParams();
  const vehicles = useCollection('vehicles');
  const trips = useCollection('trips');
  const [tab, setTab] = useState<'replay' | 'fleet'>('replay');
  const [replayTarget, setReplayTarget] = useState<{ vehicleId?: string; date?: string; tripId?: string; seed: number }>({ seed: 0 });

  // deep links: ?vehicle=KDJ123A&date=2026-07-28&trip=trp-00001 (also ?replay=plate from dashboard)
  useEffect(() => {
    const plate = params.get('vehicle') ?? params.get('replay');
    const date = params.get('date') ?? undefined;
    const tripId = params.get('trip') ?? undefined;
    if (!plate && !date) return;
    const v = plate ? vehicles.find((x) => normPlate(x.plate) === normPlate(plate)) : undefined;
    if (tripId && !v) {
      const t = trips.find((x) => x.id === tripId);
      if (t) {
        setReplayTarget({ vehicleId: t.vehicleId, date: date ?? t.startAt.slice(0, 10), tripId, seed: Date.now() });
        setTab('replay');
        return;
      }
    }
    setReplayTarget({ vehicleId: v?.id, date, tripId, seed: Date.now() });
    setTab('replay');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, vehicles.length]);

  const onReplayFromTable = useCallback((vehicleId: string) => {
    // no explicit date → studio lands on the vehicle's latest day with trips
    setReplayTarget({ vehicleId, seed: Date.now() });
    setTab('replay');
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Live Tracking</h1>
          <p className="text-[13px] text-ink-400">Route replay studio — prove it for any vehicle, any day.</p>
        </div>
      </div>
      <Tabs
        className="mx-4 mt-2"
        tabs={[
          { key: 'replay', label: 'Replay Studio' },
          { key: 'fleet', label: 'Fleet Status', count: vehicles.length },
        ]}
        active={tab}
        onChange={(k) => setTab(k as 'replay' | 'fleet')}
      />
      <div className="min-h-0 flex-1">
        {tab === 'replay' ? (
          <ReplayStudio
            key={replayTarget.seed}
            initialVehicle={replayTarget.vehicleId}
            initialDate={replayTarget.date}
            initialTrip={replayTarget.tripId}
            keySeed={replayTarget.seed}
          />
        ) : (
          <FleetStatusTab onReplay={onReplayFromTable} />
        )}
      </div>
    </motion.div>
  );
}
