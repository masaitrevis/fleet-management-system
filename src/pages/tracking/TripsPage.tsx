// FBV FleetOS — /trips (design/trips.md)
// Auto-detected trip log: period pills, KPI strip, classification donut +
// unclassified queue, dense filterable/groupable table, detail drawer with
// mini-replay, Excel + PDF exports. Replay deep-links into /tracking.

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Briefcase, ChevronDown, Clock, Download,
  FileText, Gauge, Home, MapPin, Play, Pause, Route, Timer, Trash2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ConfirmDialog, DataTable, DonutChartCard, Drawer, EmptyState, KPIStatCard,
  PlateTag, Tabs, TimelineSlider, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, remove, update, useCollection, useKV } from '@/lib/store';
import { corridorById } from '@/lib/telematics';
import { TODAY } from '@/lib/seed';
import { fmtDateEAT, fmtKES, fmtNum, fmtTimeEAT } from '@/lib/format';
import type { Geofence, Trip, Vehicle } from '@/lib/types';
import { cn } from '@/lib/utils';
import { buildTripReplay, humanizeMin, secToHHMM } from './replay';
import type { TripReplay } from './replay';
import { useEffect, useRef } from 'react';

/* ---------------- helpers ---------------- */

/** origin/destination string → geofence (cyan chip when resolved) */
function resolvePlace(text: string, geofences: Geofence[]): Geofence | null {
  const t = text.toLowerCase();
  for (const gf of geofences) {
    const n = gf.name.toLowerCase();
    if (t.includes(n) || n.includes(t)) return gf;
    // seeded place aliases
    if (t === 'industrial area' && n === 'fbv depot') return gf;
    if (t === 'westlands' && n === 'westlands hub') return gf;
    if (t === 'ruiru' && n.includes('ruiru')) return gf;
    if (t === 'mombasa port' && n === 'mombasa port') return gf;
  }
  return null;
}

/** Trips outside 06:00–19:00 Mon–Sat auto-suggest PRIVATE. */
function suggestPrivate(trip: Trip): { suggest: boolean; reason: string } {
  const d = new Date(trip.startAt);
  const dow = d.getUTCDay(); // 0=Sun
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  const outside = dow === 0 || h < 6 || h >= 19;
  if (!outside) return { suggest: false, reason: '' };
  const dowName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
  return { suggest: true, reason: `suggests PRIVATE — ${dowName} ${fmtTimeEAT(trip.startAt)}` };
}

function fmtDayMon(iso: string): string {
  return fmtDateEAT(iso).replace(/ \d{4}$/, '');
}

const EFF_KML: Record<Vehicle['type'], number> = {
  truck: 3.4, bus: 3.6, van: 6.0, pickup: 7.0, car: 11.0,
};

type PeriodKey = 'today' | '7d' | '30d' | 'custom';
type GroupKey = 'none' | 'vehicle' | 'driver' | 'day';

function dateDaysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const CLASS_PILL: Record<Trip['classification'], { cls: string; label: string }> = {
  business: { cls: 'bg-accent-soft text-accent-strong', label: 'BUSINESS' },
  private: { cls: 'bg-inactive-soft text-inactive-on-soft', label: 'PRIVATE' },
  unclassified: { cls: 'border border-dashed border-warn bg-warn-soft/50 text-warn-on-soft', label: '—' },
};

/* ================================================================== */
/* Classification pill + quick toggle                                  */
/* ================================================================== */

function ClassCell({ trip, onClassify, suggestion }: {
  trip: Trip;
  onClassify: (t: Trip, cls: Trip['classification']) => void;
  suggestion: { suggest: boolean; reason: string };
}) {
  const p = CLASS_PILL[trip.classification];
  return (
    <div className="group/cls flex flex-col">
      <div className="flex items-center gap-1.5">
        <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold transition-colors duration-200', p.cls)}>
          {p.label}
        </span>
        <span className="flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover/cls:opacity-100">
          {trip.classification !== 'business' && (
            <button type="button" title="Mark business"
              onClick={(e) => { e.stopPropagation(); onClassify(trip, 'business'); }}
              className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold text-accent-strong hover:bg-accent hover:text-navy-950">BIZ</button>
          )}
          {trip.classification !== 'private' && (
            <button type="button" title="Mark private"
              onClick={(e) => { e.stopPropagation(); onClassify(trip, 'private'); }}
              className="rounded bg-inactive-soft px-1.5 py-0.5 text-[9px] font-bold text-inactive-on-soft hover:bg-inactive hover:text-white">PRIV</button>
          )}
        </span>
      </div>
      {trip.classification === 'unclassified' && suggestion.suggest && (
        <span className="mt-0.5 text-[10px] italic text-ink-400">{suggestion.reason}</span>
      )}
    </div>
  );
}

/* ================================================================== */
/* Mini map + mini-replay (SVG, dark navy — no extra Leaflet instance) */
/* ================================================================== */

function MiniMap({ replay, markerFrac }: { replay: TripReplay; markerFrac: number }) {
  const W = 440, H = 220, PAD = 18;
  const lats = replay.path.map((p) => p[0]);
  const lngs = replay.path.map((p) => p[1]);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const sx = (W - PAD * 2) / Math.max(1e-9, maxLng - minLng);
  const sy = (H - PAD * 2) / Math.max(1e-9, maxLat - minLat);
  const s = Math.min(sx, sy);
  const xy = (lat: number, lng: number): [number, number] =>
    [PAD + (lng - minLng) * s + (W - PAD * 2 - (maxLng - minLng) * s) / 2,
     H - PAD - (lat - minLat) * s - (H - PAD * 2 - (maxLat - minLat) * s) / 2];

  const dPath = replay.path.map(([lat, lng], i) => {
    const [x, y] = xy(lat, lng);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const len = replay.path.length;
  const markerIdx = Math.min(len - 1, Math.max(0, Math.round(markerFrac * (len - 1))));
  const [mx, my] = xy(replay.path[markerIdx][0], replay.path[markerIdx][1]);
  const [sx0, sy0] = xy(replay.path[0][0], replay.path[0][1]);
  const [ex0, ey0] = xy(replay.path[len - 1][0], replay.path[len - 1][1]);

  const flags = replay.events.filter((e) => e.kind === 'harsh' || e.kind === 'geofence' || e.kind === 'idle').slice(0, 8);

  return (
    <div className="relative h-[220px] overflow-hidden rounded-xl bg-navy-900">
      <img src="/login-texture.svg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <motion.path
          d={dPath} fill="none" stroke="#06B6D4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        {/* start / end pins */}
        <circle cx={sx0} cy={sy0} r="5" fill="#16A34A" stroke="#fff" strokeWidth="1.5" />
        <circle cx={ex0} cy={ey0} r="5" fill="#DC2626" stroke="#fff" strokeWidth="1.5" />
        {flags.map((e) => {
          const frac = (e.tSec - replay.tStart) / Math.max(1, replay.tEnd - replay.tStart);
          const idx = Math.min(len - 1, Math.max(0, Math.round(frac * (len - 1))));
          const [fx, fy] = xy(replay.path[idx][0], replay.path[idx][1]);
          if (e.kind === 'harsh') {
            return <path key={e.id} d={`M${fx} ${fy - 7} L${fx + 6} ${fy + 5} L${fx - 6} ${fy + 5} Z`} fill="#DC2626" stroke="#fff" strokeWidth="1" />;
          }
          if (e.kind === 'idle') {
            return <rect key={e.id} x={fx - 4} y={fy - 4} width="8" height="8" rx="2" fill="#F59E0B" stroke="#fff" strokeWidth="1" />;
          }
          return <rect key={e.id} x={fx - 2} y={fy - 7} width="4" height="14" rx="2" fill="#06B6D4" stroke="#fff" strokeWidth="1" />;
        })}
        {/* replay marker */}
        <circle cx={mx} cy={my} r="9" fill="none" stroke="#22D3EE" strokeWidth="2" opacity="0.6" />
        <circle cx={mx} cy={my} r="5" fill="#06B6D4" stroke="#fff" strokeWidth="2" />
      </svg>
      <span className="absolute left-3 top-2 font-mono text-[10px] uppercase tracking-[0.08em] text-navy-100/70">
        {corridorById(replay.trip.corridor).name}
      </span>
    </div>
  );
}

/* ================================================================== */
/* Trip detail drawer                                                  */
/* ================================================================== */

function TripDrawer({ trip, vehicles, drivers, geofences, allTrips, safetyEvents, onClassify, onClose }: {
  trip: Trip | null;
  vehicles: Vehicle[];
  drivers: { id: string; name: string }[];
  geofences: Geofence[];
  allTrips: Trip[];
  safetyEvents: import('@/lib/types').SafetyEvent[];
  onClassify: (t: Trip, cls: Trip['classification']) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const settings = useKV('settings');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const [frac, setFrac] = useState(0);
  const fracRef = useRef(frac);
  fracRef.current = frac;

  const replay = useMemo(() => {
    if (!trip) return null;
    const idxOnDay = allTrips.filter((t) =>
      t.vehicleId === trip.vehicleId && t.startAt.slice(0, 10) === trip.startAt.slice(0, 10)
      && t.startAt < trip.startAt).length;
    return buildTripReplay(trip, idxOnDay, safetyEvents, geofences, `${trip.vehicleId}:${trip.startAt.slice(0, 10)}`);
  }, [trip, allTrips, safetyEvents, geofences]);

  useEffect(() => { setFrac(0); setPlaying(false); }, [trip?.id]);

  useEffect(() => {
    if (!playing || !replay) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const durMin = replay.tEnd - replay.tStart;
      const next = fracRef.current + (dt * speed) / Math.max(30, durMin);
      if (next >= 1) { setFrac(1); setPlaying(false); return; }
      setFrac(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, replay]);

  if (!trip || !replay) return <Drawer open={false} onClose={onClose}>{null}</Drawer>;

  const vehicle = vehicles.find((v) => v.id === trip.vehicleId);
  const driver = drivers.find((d) => d.id === trip.driverId);
  const priceL = vehicle?.fuelType === 'petrol' ? settings.fuelPricePetrolKes : settings.fuelPriceDieselKes;
  const litres = trip.distanceKm / EFF_KML[vehicle?.type ?? 'truck'];
  const fuelCost = litres * priceL;
  const driveMin = Math.max(1, trip.durationMin - trip.idleMin);
  const avgSpeed = trip.distanceKm / (driveMin / 60);
  const events = replay.events
    .filter((e) => e.kind === 'harsh' || e.kind === 'geofence' || e.kind === 'idle')
    .slice(0, 6);
  const passedT = replay.tStart + frac * (replay.tEnd - replay.tStart);

  const exportPdf = () => {
    const doc = new jsPDF();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FBV FleetOS — Trip report', 14, 16);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`${vehicle?.plate ?? trip.vehicleId} · ${driver?.name ?? ''} · ${fmtDateEAT(trip.startAt)}`, 14, 23);
    doc.text(`${trip.from} → ${trip.to} (${corridorById(trip.corridor).name})`, 14, 29);
    // map snapshot drawn on canvas (navy + cyan polyline)
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 220;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0A1A2F';
    ctx.fillRect(0, 0, 480, 220);
    const lats = replay.path.map((p) => p[0]);
    const lngs = replay.path.map((p) => p[1]);
    const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
    const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
    const sc = Math.min(440 / Math.max(1e-9, maxLng - minLng), 180 / Math.max(1e-9, maxLat - minLat));
    const px = (lat: number, lng: number): [number, number] =>
      [20 + (lng - minLng) * sc + (440 - (maxLng - minLng) * sc) / 2,
       200 - (lat - minLat) * sc - (180 - (maxLat - minLat) * sc) / 2];
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    replay.path.forEach(([lat, lng], i) => {
      const [x, y] = px(lat, lng);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const [ax, ay] = px(replay.path[0][0], replay.path[0][1]);
    const [bx, by] = px(replay.path[replay.path.length - 1][0], replay.path[replay.path.length - 1][1]);
    ctx.fillStyle = '#16A34A'; ctx.beginPath(); ctx.arc(ax, ay, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#DC2626'; ctx.beginPath(); ctx.arc(bx, by, 5, 0, 7); ctx.fill();
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 14, 34, 180, 82);
    autoTable(doc, {
      startY: 122,
      head: [['Distance', 'Drive time', 'Idle', 'Avg speed', 'Max speed', 'Fuel est.']],
      body: [[
        `${fmtNum(trip.distanceKm, 1)} km`, humanizeMin(driveMin), humanizeMin(trip.idleMin),
        `${Math.round(avgSpeed)} km/h`, `${trip.maxSpeedKmh} km/h`, `${Math.round(litres)} L · ${fmtKES(fuelCost)}`,
      ]],
      styles: { font: 'courier', fontSize: 8.5 },
      headStyles: { fillColor: [10, 26, 47] },
    });
    if (events.length) {
      autoTable(doc, {
        startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6,
        head: [['Time', 'Event']],
        body: events.map((e) => [secToHHMM(e.tSec), `${e.label}${e.detail ? ` — ${e.detail}` : ''}`]),
        styles: { fontSize: 8.5 },
        headStyles: { fillColor: [10, 26, 47] },
      });
    }
    doc.save(`trip-${trip.id}.pdf`);
    toast({ title: 'PDF exported', body: `trip-${trip.id}.pdf — map snapshot + stats.`, status: 'ok' });
  };

  return (
    <Drawer open={!!trip} onClose={onClose} width={480}
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px]">{trip.from} → {trip.to}</span>
          <span className="font-mono text-[11px] text-ink-400">{fmtDateEAT(trip.startAt)}</span>
          <select
            value={trip.classification}
            onChange={(e) => onClassify(trip, e.target.value as Trip['classification'])}
            className={cn('h-6 rounded-full px-2 text-micro font-semibold outline-none', CLASS_PILL[trip.classification].cls)}>
            <option value="business">BUSINESS</option>
            <option value="private">PRIVATE</option>
            <option value="unclassified">UNCLASSIFIED</option>
          </select>
        </div>
      }
      footer={
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => navigate(`/tracking?vehicle=${(vehicle?.plate ?? '').replace(/\s/g, '')}&date=${trip.startAt.slice(0, 10)}&trip=${trip.id}`)}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-navy-900 text-[12px] font-semibold text-white hover:bg-navy-800">
            <Route size={14} /> Open full replay →
          </button>
          <button type="button" onClick={() => onClassify(trip, trip.classification === 'business' ? 'private' : 'business')}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-semibold text-ink-900 hover:bg-surface-muted">
            <Briefcase size={13} /> Reclassify
          </button>
          <button type="button" onClick={exportPdf}
            className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-[12px] font-semibold text-ink-900 hover:bg-surface-muted">
            <FileText size={13} /> PDF
          </button>
        </div>
      }>
      <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}
        className="flex flex-col gap-4">
        <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}>
          <MiniMap replay={replay} markerFrac={frac} />
        </motion.div>

        {/* stat grid 3×2 */}
        <motion.div variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
          className="grid grid-cols-3 gap-2">
          {[
            { label: 'Distance', value: `${fmtNum(trip.distanceKm, 1)} km` },
            { label: 'Drive time', value: humanizeMin(driveMin) },
            { label: 'Idle', value: humanizeMin(trip.idleMin) },
            { label: 'Avg speed', value: `${Math.round(avgSpeed)} km/h` },
            { label: 'Max speed', value: `${trip.maxSpeedKmh} km/h` },
            { label: 'Fuel est.', value: `${Math.round(litres)} L`, sub: fmtKES(fuelCost) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-surface-muted/50 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-400">{s.label}</div>
              <div className="font-mono text-[13px] font-semibold text-ink-900">{s.value}</div>
              {s.sub && <div className="font-mono text-[10px] text-ink-400">{s.sub}</div>}
            </div>
          ))}
        </motion.div>

        {/* event timeline */}
        <motion.div variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}>
          <div className="pb-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-400">Event timeline</div>
          <div className="relative ml-2 flex flex-col gap-0 border-l-2 border-border pl-4">
            {events.length === 0 && <span className="py-1 text-[12px] text-ink-400">Clean trip — no harsh, idle or zone events.</span>}
            {events.map((e, i) => {
              const passed = e.tSec <= passedT;
              return (
                <motion.button key={e.id} type="button"
                  initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, duration: 0.2 }}
                  onClick={() => setFrac(Math.max(0, Math.min(1, (e.tSec - replay.tStart) / (replay.tEnd - replay.tStart))))}
                  className={cn('relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-muted',
                    passed && 'bg-accent-soft/50')}>
                  <span className={cn('absolute -left-[23px] h-2.5 w-2.5 rounded-full border-2 border-white',
                    e.kind === 'harsh' ? 'bg-alert' : e.kind === 'idle' ? 'bg-warn' : 'bg-accent')} />
                  <span className="font-mono text-[11px] font-semibold text-ink-900">{secToHHMM(e.tSec)}</span>
                  <span className="flex-1 truncate text-[12px] text-ink-600">
                    {e.label}{e.kind === 'harsh' && e.detail ? ` — ${e.detail.split('—')[1]?.trim() ?? ''}` : ''}
                  </span>
                  {e.kind === 'harsh' && <AlertTriangle size={12} className="shrink-0 text-alert" />}
                  {e.kind === 'idle' && <Timer size={12} className="shrink-0 text-warn" />}
                  {e.kind === 'geofence' && <MapPin size={12} className="shrink-0 text-accent-strong" />}
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        {/* mini-replay player */}
        <motion.div variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
          className="flex items-center gap-2">
          <button type="button" onClick={() => { if (frac >= 1) setFrac(0); setPlaying(!playing); }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-navy-950 transition-all hover:bg-accent-strong active:scale-95">
            {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <TimelineSlider
              durationLabel={`${secToHHMM(replay.tStart)}–${secToHHMM(replay.tEnd)}`}
              events={events.map((e) => ({
                at: (e.tSec - replay.tStart) / Math.max(1, replay.tEnd - replay.tStart),
                kind: e.kind === 'harsh' ? 'harsh' : e.kind === 'geofence' ? 'geofence' : 'stop',
                label: e.label,
              }))}
              playing={playing}
              speed={speed}
              onPlayPause={() => setPlaying(!playing)}
              onSpeed={setSpeed}
              onScrub={setFrac}
              progress={frac}
            />
          </div>
        </motion.div>
      </motion.div>
    </Drawer>
  );
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export default function TripsPage() {
  const trips = useCollection('trips');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const geofences = useCollection('geofences');
  const safetyEvents = useCollection('safetyEvents');
  const geofenceEvents = useCollection('geofenceEvents');

  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [from, setFrom] = useState(dateDaysAgo(7));
  const [to, setTo] = useState(TODAY);
  const [vehF, setVehF] = useState('all');
  const [drvF, setDrvF] = useState('all');
  const [clsF, setClsF] = useState<'all' | Trip['classification']>('all');
  const [geoF, setGeoF] = useState('all');
  const [distMin, setDistMin] = useState(0);
  const [distMax, setDistMax] = useState(500);
  const [groupBy, setGroupBy] = useState<GroupKey>('none');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const setPeriodQuick = (p: PeriodKey) => {
    setPeriod(p);
    if (p === 'today') { setFrom(TODAY); setTo(TODAY); }
    if (p === '7d') { setFrom(dateDaysAgo(7)); setTo(TODAY); }
    if (p === '30d') { setFrom(dateDaysAgo(30)); setTo(TODAY); }
  };

  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const drvById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const filtered = useMemo(() => trips.filter((t) => {
    const day = t.startAt.slice(0, 10);
    if (day < from || day > to) return false;
    if (vehF !== 'all' && t.vehicleId !== vehF) return false;
    if (drvF !== 'all' && t.driverId !== drvF) return false;
    if (clsF !== 'all' && t.classification !== clsF) return false;
    if (t.distanceKm < distMin || t.distanceKm > distMax) return false;
    if (geoF !== 'all') {
      const gf = geofences.find((g) => g.id === geoF);
      if (!gf) return true;
      const o = resolvePlace(t.from, [gf]);
      const d = resolvePlace(t.to, [gf]);
      if (!o && !d) return false;
    }
    return true;
  }).sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [trips, from, to, vehF, drvF, clsF, distMin, distMax, geoF, geofences]);

  /* KPIs */
  const kpi = useMemo(() => {
    const n = filtered.length;
    const km = filtered.reduce((s, t) => s + t.distanceKm, 0);
    const driveH = filtered.reduce((s, t) => s + Math.max(0, t.durationMin - t.idleMin), 0) / 60;
    const biz = filtered.filter((t) => t.classification === 'business').length;
    const bizPct = n ? (biz / n) * 100 : 0;
    return { n, km, driveH, bizPct, otherPct: 100 - bizPct };
  }, [filtered]);

  const clsCounts = useMemo(() => ({
    business: filtered.filter((t) => t.classification === 'business').length,
    private: filtered.filter((t) => t.classification === 'private').length,
    unclassified: filtered.filter((t) => t.classification === 'unclassified').length,
  }), [filtered]);

  const unclassifiedQueue = useMemo(
    () => trips.filter((t) => t.classification === 'unclassified')
      .sort((a, b) => b.startAt.localeCompare(a.startAt)).slice(0, 3),
    [trips],
  );
  const unclassifiedTotal = useMemo(() => trips.filter((t) => t.classification === 'unclassified').length, [trips]);

  /* event counts per trip window (cheap — no geometry) */
  const eventCounts = useCallback((t: Trip): { harsh: number; geo: number } => {
    const harsh = safetyEvents.filter((e) => e.vehicleId === t.vehicleId && e.at >= t.startAt && e.at <= t.endAt).length;
    const geo = geofenceEvents.filter((e) => e.vehicleId === t.vehicleId && e.at >= t.startAt && e.at <= t.endAt && e.type !== 'dwell').length;
    return { harsh, geo };
  }, [safetyEvents, geofenceEvents]);

  /* classification write */
  const classify = useCallback((t: Trip, cls: Trip['classification']) => {
    update('trips', t.id, { classification: cls });
    add('audit', {
      id: '', at: new Date().toISOString(), userId: 'usr-02', userName: 'Wanjiru Maina',
      action: 'update', collection: 'trips', recordId: t.id,
      summary: `Trip ${t.id} classified ${cls.toUpperCase()} (${vehById.get(t.vehicleId)?.plate ?? t.vehicleId})`,
      diff: [{ field: 'classification', before: t.classification, after: cls }],
    });
    toast({
      title: `Trip marked ${cls.toUpperCase()}`,
      body: cls === 'business' ? 'Client delivery — link a job from Dispatch if needed.' : `${fmtDayMon(t.startAt)} · ${t.from} → ${t.to}`,
      status: 'ok',
    });
  }, [vehById]);

  const bulkAcceptSuggestions = () => {
    const targets = trips.filter((t) => t.classification === 'unclassified' && suggestPrivate(t).suggest);
    targets.forEach((t) => update('trips', t.id, { classification: 'private' }));
    add('audit', {
      id: '', at: new Date().toISOString(), userId: 'usr-02', userName: 'Wanjiru Maina',
      action: 'update', collection: 'trips', recordId: 'bulk',
      summary: `Bulk-classified ${targets.length} trips PRIVATE (after-hours suggestion)`,
    });
    toast({ title: 'Bulk reclassification done', body: `${targets.length} after-hours trips marked PRIVATE.`, status: 'ok' });
  };

  /* export excel (respects filters, with totals row) */
  const exportExcel = () => {
    const data = filtered.map((t) => {
      const ev = eventCounts(t);
      return {
        Date: fmtDayMon(t.startAt),
        Start: fmtTimeEAT(t.startAt), End: fmtTimeEAT(t.endAt),
        Vehicle: vehById.get(t.vehicleId)?.plate ?? t.vehicleId,
        Driver: drvById.get(t.driverId)?.name ?? t.driverId,
        From: t.from, To: t.to, Corridor: corridorById(t.corridor).name,
        'Distance (km)': t.distanceKm,
        'Duration (min)': t.durationMin, 'Idle (min)': t.idleMin,
        'Max speed (km/h)': t.maxSpeedKmh,
        'Harsh events': ev.harsh, 'Geofence events': ev.geo,
        Classification: t.classification.toUpperCase(),
      };
    });
    const totals = {
      Date: 'TOTAL', Start: '', End: '', Vehicle: `${filtered.length} trips`, Driver: '', From: '', To: '',
      Corridor: '',
      'Distance (km)': Math.round(kpi.km),
      'Duration (min)': filtered.reduce((s, t) => s + t.durationMin, 0),
      'Idle (min)': filtered.reduce((s, t) => s + t.idleMin, 0),
      'Max speed (km/h)': '', 'Harsh events': '', 'Geofence events': '', Classification: '',
    };
    const ws = XLSX.utils.json_to_sheet([...data, totals]);
    ws['!cols'] = Object.keys(data[0] ?? totals).map((k) => ({ wch: Math.max(10, k.length + 3) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trips');
    const monthLabel = from.slice(0, 7) === to.slice(0, 7)
      ? new Date(`${from}T00:00:00Z`).toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toLowerCase() + '-' + from.slice(0, 4)
      : `${from}_${to}`;
    XLSX.writeFile(wb, `trips-${monthLabel}.xlsx`);
    toast({ title: 'Export ready', body: `trips-${monthLabel}.xlsx — ${filtered.length} trips + totals row.`, status: 'ok' });
  };

  /* grouping */
  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const m = new Map<string, Trip[]>();
    filtered.forEach((t) => {
      const key = groupBy === 'vehicle' ? (vehById.get(t.vehicleId)?.plate ?? t.vehicleId)
        : groupBy === 'driver' ? (drvById.get(t.driverId)?.name ?? t.driverId)
        : t.startAt.slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), t]);
    });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered, groupBy, vehById, drvById]);

  /* table columns */
  const columns: Column<Trip>[] = [
    { key: 'date', header: 'Date', mono: true, render: (t) => fmtDayMon(t.startAt) },
    {
      key: 'time', header: 'Start → End', mono: true,
      render: (t) => `${fmtTimeEAT(t.startAt)} → ${fmtTimeEAT(t.endAt)}`,
    },
    { key: 'vehicle', header: 'Vehicle', render: (t) => <PlateTag plate={vehById.get(t.vehicleId)?.plate ?? t.vehicleId} /> },
    { key: 'driver', header: 'Driver', render: (t) => <span className="text-[13px] text-ink-600">{drvById.get(t.driverId)?.name ?? '—'}</span> },
    {
      key: 'route', header: 'Route summary',
      render: (t) => {
        const o = resolvePlace(t.from, geofences);
        const d = resolvePlace(t.to, geofences);
        const chip = (text: string, gf: Geofence | null) => gf ? (
          <span title={gf.name} className="inline-block rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold text-accent-strong transition-transform hover:-translate-y-px">{text}</span>
        ) : (
          <span className="text-[12px] text-ink-600">{text}</span>
        );
        return (
          <span className="flex items-center gap-1 whitespace-nowrap">
            {chip(t.from, o)}
            <span className="text-ink-400">→</span>
            {chip(t.to, d)}
            <span className="text-[11px] text-ink-400">via {corridorById(t.corridor).name.split(' ')[0]}</span>
          </span>
        );
      },
    },
    { key: 'dist', header: 'Distance', mono: true, align: 'right', render: (t) => `${fmtNum(t.distanceKm, 1)} km` },
    {
      key: 'dur', header: 'Duration', mono: true, align: 'right',
      render: (t) => (
        <span className="flex flex-col items-end leading-4">
          <span>{humanizeMin(t.durationMin)}</span>
          <span className="text-[10px] text-ink-400">idle {humanizeMin(t.idleMin)}</span>
        </span>
      ),
    },
    {
      key: 'speed', header: 'Avg / Max', mono: true, align: 'right',
      render: (t) => {
        const driveMin = Math.max(1, t.durationMin - t.idleMin);
        return `${Math.round(t.distanceKm / (driveMin / 60))} / ${t.maxSpeedKmh}`;
      },
    },
    {
      key: 'events', header: 'Events',
      render: (t) => {
        const ev = eventCounts(t);
        if (!ev.harsh && !ev.geo) return <span className="text-ink-400">—</span>;
        return (
          <span className="flex gap-1">
            {ev.harsh > 0 && <span className="rounded-full bg-alert-soft px-1.5 py-0.5 text-[10px] font-semibold text-alert-on-soft">{ev.harsh} harsh</span>}
            {ev.geo > 0 && <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-strong">{ev.geo} geofence</span>}
          </span>
        );
      },
    },
    {
      key: 'cls', header: 'Classification', width: '170px',
      render: (t) => <ClassCell trip={t} onClassify={classify} suggestion={suggestPrivate(t)} />,
    },
  ];

  const openTrip = trips.find((t) => t.id === openTripId) ?? null;
  const selectCls = 'h-9 rounded-lg border border-border bg-white px-2 text-[12px] font-medium text-ink-900 outline-none focus:border-accent';

  return (
    <motion.div initial="hidden" animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
      className="mx-auto flex max-w-[1520px] flex-col gap-4 p-4 lg:p-6">

      {/* header */}
      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
        className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Trips</h1>
          <p className="text-[13px] text-ink-400">Auto-detected trips · business/private classification</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border bg-white shadow-card">
            {([['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['custom', 'Custom']] as [PeriodKey, string][]).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPeriodQuick(k)}
                className={cn('h-9 px-3 text-[12px] font-semibold transition-colors',
                  period === k ? 'bg-navy-900 text-white' : 'text-ink-600 hover:bg-surface-muted')}>
                {label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(selectCls, 'font-mono')} />
              <span className="text-ink-400">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cn(selectCls, 'font-mono')} />
            </>
          )}
          <button type="button" onClick={exportExcel}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white shadow-card hover:bg-navy-800">
            <Download size={13} /> Export Excel
          </button>
        </div>
      </motion.div>

      {/* KPI strip */}
      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
        className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KPIStatCard label="Trips" value={kpi.n} icon={Route} />
        <KPIStatCard label="Total distance" value={kpi.km} format={(v) => `${fmtNum(Math.round(v))} km`} icon={Gauge} />
        <KPIStatCard label="Drive time" value={kpi.driveH} format={(v) => `${fmtNum(Math.round(v))} h`} icon={Clock} />
        <KPIStatCard label="Business" value={kpi.bizPct} format={(v) => `${Math.round(v)}%`} icon={Briefcase} sparkColor="#06B6D4" />
        <KPIStatCard label="Private / unclassified" value={kpi.otherPct} format={(v) => `${Math.round(v)}%`} icon={Home} sparkColor="#F59E0B" />
      </motion.div>

      {/* classification band */}
      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
        className="grid gap-4 lg:grid-cols-2">
        <div className="relative rounded-card border border-border bg-white p-4 shadow-card">
          <h3 className="text-[15px] font-semibold text-ink-900">Classification mix</h3>
          <div className="relative">
            <DonutChartCard
              data={[
                { name: 'Business', value: clsCounts.business, color: '#06B6D4' },
                { name: 'Private', value: clsCounts.private, color: '#64748B' },
                { name: 'Unclassified', value: clsCounts.unclassified, color: '#F59E0B' },
              ]}
              height={190}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-[22px] font-bold text-ink-900">{Math.round(kpi.bizPct)}% <span className="text-[12px] text-ink-400">BIZ</span></span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-4 text-[11px] text-ink-600">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> Business {clsCounts.business}</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-inactive" /> Private {clsCounts.private}</span>
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                {clsCounts.unclassified > 0 && <span className="absolute h-full w-full rounded-full bg-warn animate-pulse-live-ring" />}
                <span className="relative h-2 w-2 rounded-full bg-warn" />
              </span>
              Unclassified {clsCounts.unclassified}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-card border border-border bg-white p-4 shadow-card">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-ink-900">Classification queue</h3>
            <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold',
              unclassifiedTotal > 0 ? 'bg-warn-soft text-warn-on-soft' : 'bg-ok-soft text-ok-on-soft')}>
              {unclassifiedTotal > 0 ? `${unclassifiedTotal} trips need classification` : 'all classified'}
            </span>
          </div>
          {unclassifiedQueue.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border/70 px-2.5 py-1.5">
              <PlateTag plate={vehById.get(t.vehicleId)?.plate ?? t.vehicleId} />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-600">
                {fmtDayMon(t.startAt)} {fmtTimeEAT(t.startAt)} · {t.from} → {t.to}
              </span>
              <button type="button" onClick={() => classify(t, 'business')}
                className="rounded bg-accent-soft px-2 py-1 text-[10px] font-bold text-accent-strong hover:bg-accent hover:text-navy-950">BIZ</button>
              <button type="button" onClick={() => classify(t, 'private')}
                className="rounded bg-inactive-soft px-2 py-1 text-[10px] font-bold text-inactive-on-soft hover:bg-inactive hover:text-white">PRIV</button>
            </div>
          ))}
          {unclassifiedQueue.length === 0 && (
            <p className="py-3 text-[13px] text-ink-400">Queue clear — every trip in the log is classified.</p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
            <button type="button" onClick={() => setClsF('unclassified')}
              className="text-[12px] font-semibold text-accent-strong hover:underline">Review all ↓</button>
            <button type="button" onClick={() => setBulkConfirm(true)}
              className="ml-auto rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-ink-600 hover:bg-surface-muted">
              Accept all PRIVATE suggestions
            </button>
          </div>
          <p className="text-[10px] text-ink-400">Policy: trips outside 06:00–19:00 Mon–Sat auto-suggest PRIVATE.</p>
        </div>
      </motion.div>

      {/* filters */}
      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
        className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-white p-3 shadow-card">
        <select value={vehF} onChange={(e) => setVehF(e.target.value)} className={selectCls}>
          <option value="all">All vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
        </select>
        <select value={drvF} onChange={(e) => setDrvF(e.target.value)} className={selectCls}>
          <option value="all">All drivers</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={clsF} onChange={(e) => setClsF(e.target.value as typeof clsF)} className={selectCls}>
          <option value="all">All classes</option>
          <option value="business">Business</option>
          <option value="private">Private</option>
          <option value="unclassified">Unclassified</option>
        </select>
        <select value={geoF} onChange={(e) => setGeoF(e.target.value)} className={selectCls}>
          <option value="all">Any origin/destination</option>
          {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        {/* distance range */}
        <div className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-ink-400">Distance</span>
          <input type="range" min={0} max={500} step={10} value={distMin}
            onChange={(e) => setDistMin(Math.min(Number(e.target.value), distMax))}
            className="h-1 w-20 accent-[#06B6D4]" title={`min ${distMin} km`} />
          <input type="range" min={0} max={500} step={10} value={distMax}
            onChange={(e) => setDistMax(Math.max(Number(e.target.value), distMin))}
            className="h-1 w-20 accent-[#06B6D4]" title={`max ${distMax} km`} />
          <span className="font-mono text-[11px] font-semibold text-ink-900">{distMin}–{distMax} km</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-ink-400">Group by</span>
          <Tabs
            tabs={[
              { key: 'none', label: 'None' }, { key: 'vehicle', label: 'Vehicle' },
              { key: 'driver', label: 'Driver' }, { key: 'day', label: 'Day' },
            ]}
            active={groupBy}
            onChange={(k) => setGroupBy(k as GroupKey)}
            className="border-b-0"
          />
        </div>
      </motion.div>

      {/* table(s) */}
      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="flex flex-col gap-3">
        {groupBy === 'none' || !groups ? (
          <DataTable
            columns={columns}
            rows={filtered}
            pageSize={14}
            onRowClick={(t) => setOpenTripId(t.id)}
            empty={<EmptyState icon={Route} title="No trips in this window" hint="Widen the period or relax the filters — seeded history spans 60 days." />}
            rowActions={(t) => [
              { label: 'Replay →', icon: Play, onClick: () => setOpenTripId(t.id) },
              { label: 'Reclassify', icon: Briefcase, onClick: () => classify(t, t.classification === 'business' ? 'private' : 'business') },
              { label: 'Delete', icon: Trash2, danger: true, onClick: () => { remove('trips', t.id); toast({ title: 'Trip deleted', body: `${fmtDayMon(t.startAt)} · ${t.from} → ${t.to}`, status: 'warn' }); } },
            ]}
          />
        ) : (
          groups.map(([key, rows]) => {
            const isCollapsed = collapsed.has(key);
            const km = rows.reduce((s, t) => s + t.distanceKm, 0);
            const drive = rows.reduce((s, t) => s + Math.max(0, t.durationMin - t.idleMin), 0);
            return (
              <div key={key} className="overflow-hidden rounded-card border border-border bg-white shadow-card">
                <button type="button"
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                  className="flex w-full items-center gap-3 bg-navy-900 px-4 py-2.5 text-left">
                  <ChevronDown size={14} className={cn('text-accent-on-navy transition-transform', isCollapsed && '-rotate-90')} />
                  <span className="text-[13px] font-semibold text-white">
                    {groupBy === 'day' ? fmtDayMon(`${key}T00:00:00Z`) : key}
                  </span>
                  <span className="ml-auto font-mono text-[11px] font-medium text-navy-100">
                    {rows.length} trips · {fmtNum(Math.round(km))} km · {humanizeMin(drive)} drive
                  </span>
                </button>
                {!isCollapsed && (
                  <DataTable
                    columns={columns}
                    rows={rows}
                    pageSize={Math.max(12, rows.length)}
                    onRowClick={(t) => setOpenTripId(t.id)}
                    rowActions={(t) => [
                      { label: 'Replay →', icon: Play, onClick: () => setOpenTripId(t.id) },
                      { label: 'Reclassify', icon: Briefcase, onClick: () => classify(t, t.classification === 'business' ? 'private' : 'business') },
                      { label: 'Delete', icon: Trash2, danger: true, onClick: () => remove('trips', t.id) },
                    ]}
                  />
                )}
              </div>
            );
          })
        )}
      </motion.div>

      <TripDrawer
        trip={openTrip}
        vehicles={vehicles}
        drivers={drivers}
        geofences={geofences}
        allTrips={trips}
        safetyEvents={safetyEvents}
        onClassify={classify}
        onClose={() => setOpenTripId(null)}
      />

      <ConfirmDialog
        open={bulkConfirm}
        onClose={() => setBulkConfirm(false)}
        onConfirm={bulkAcceptSuggestions}
        title="Accept all PRIVATE suggestions?"
        confirmLabel="Reclassify all"
        body={`All unclassified trips outside 06:00–19:00 Mon–Sat (${trips.filter((t) => t.classification === 'unclassified' && suggestPrivate(t).suggest).length}) will be marked PRIVATE. Each change is written to the audit trail.`}
      />
    </motion.div>
  );
}
