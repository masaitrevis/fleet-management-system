// FBV FleetOS — /geofences (design/geofences.md)
// Zone list + manual Leaflet draw editor (circle/polygon via map events,
// no leaflet-draw) + entry/exit log, dwell report, restricted violations.

import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, Bell, BellOff, Circle as CircleIcon, Clock, Download,
  Hexagon, MapPin, MoreHorizontal, Pencil, Plus, ShieldAlert, Trash2,
} from 'lucide-react';
import { Circle, Polygon, Tooltip, CircleMarker } from 'react-leaflet';
import * as XLSX from 'xlsx';
import { FleetMap, FenceEditHandles, GeofenceDrawLayer } from '@/components/FleetMap';
import type { FleetMapHandle, DrawShape } from '@/components/FleetMap';
import {
  ConfirmDialog, DataTable, EmptyState, PlateTag, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, remove, update, useCollection, useLivePositions } from '@/lib/store';
import { TODAY } from '@/lib/seed';
import { fmtDateEAT, fmtDateTimeEAT, fmtNum, fmtTimeEAT } from '@/lib/format';
import type { Geofence, GeofenceEvent } from '@/lib/types';
import { cn } from '@/lib/utils';
import { humanizeMin, pointInGeofence } from './replay';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ---------------- zone typing (color field carries the type tag) ----- */

export type ZoneType = 'depot' | 'customer' | 'restricted';

const SEEDED_TYPES: Record<string, ZoneType> = {
  'gf-01': 'depot', 'gf-02': 'depot', 'gf-03': 'restricted', 'gf-04': 'customer',
  'gf-05': 'customer', 'gf-06': 'restricted', 'gf-07': 'depot', 'gf-08': 'depot',
};

function zoneType(gf: Geofence): ZoneType {
  if (gf.color === 'depot' || gf.color === 'customer' || gf.color === 'restricted') return gf.color;
  return SEEDED_TYPES[gf.id] ?? 'customer';
}

const TYPE_PILL: Record<ZoneType, string> = {
  depot: 'bg-navy-900 text-white',
  customer: 'bg-accent-soft text-accent-strong',
  restricted: 'bg-alert-soft text-alert-on-soft',
};
const TYPE_LABEL: Record<ZoneType, string> = {
  depot: 'Depot', customer: 'Customer', restricted: 'Restricted',
};

function rulesSummary(gf: Geofence): string {
  const parts: string[] = [];
  if (gf.rules.alertOnEnter && gf.rules.alertOnExit) parts.push('Alert on entry+exit');
  else if (gf.rules.alertOnEnter) parts.push('Alert on entry');
  else if (gf.rules.alertOnExit) parts.push('Alert on exit');
  else parts.push('No entry/exit alerts');
  if (gf.rules.alertOnDwellMin) parts.push(`Dwell>${gf.rules.alertOnDwellMin}m`);
  if (zoneType(gf) === 'restricted') parts.push('Restricted hours');
  return parts.join(' · ');
}

function gfCenter(gf: Geofence): { lat: number; lng: number } | null {
  if (gf.center) return gf.center;
  if (gf.polygon && gf.polygon.length) {
    return {
      lat: gf.polygon.reduce((s, p) => s + p.lat, 0) / gf.polygon.length,
      lng: gf.polygon.reduce((s, p) => s + p.lng, 0) / gf.polygon.length,
    };
  }
  return null;
}

/* ---------------- editor toolbar ------------------------------------- */

interface EditorState {
  name: string;
  type: ZoneType;
  shape: 'circle' | 'polygon';
  alertOnEnter: boolean;
  alertOnExit: boolean;
  dwellMin: number | null;
}

function EditorToolbar({ st, setSt, onSave, onCancel, saving, hint }: {
  st: EditorState; setSt: (s: EditorState) => void;
  onSave: () => void; onCancel: () => void;
  saving?: boolean; hint?: string;
}) {
  const chip = (active: boolean) => cn(
    'flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition-colors',
    active ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-400 hover:text-ink-600',
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}
      className="glass-white pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2 shadow-pop">
      {/* shape toggle */}
      <div className="flex overflow-hidden rounded-lg border border-border">
        {(['circle', 'polygon'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSt({ ...st, shape: s })}
            className={cn('flex h-8 items-center gap-1 px-2.5 text-[12px] font-semibold',
              st.shape === s ? 'bg-navy-900 text-white' : 'bg-white text-ink-600 hover:bg-surface-muted')}>
            {s === 'circle' ? <CircleIcon size={13} /> : <Hexagon size={13} />}
            {s === 'circle' ? 'Circle' : 'Polygon'}
          </button>
        ))}
      </div>
      <input value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })}
        placeholder="Zone name (e.g. Kitengela Yard)"
        className="h-8 w-48 rounded-lg border border-border px-2.5 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
      <select value={st.type} onChange={(e) => setSt({ ...st, type: e.target.value as ZoneType })}
        className="h-8 rounded-lg border border-border bg-white px-2 text-[12px] font-medium outline-none focus:border-accent">
        <option value="depot">Depot</option>
        <option value="customer">Customer</option>
        <option value="restricted">Restricted</option>
      </select>
      <button type="button" className={chip(st.alertOnEnter)} onClick={() => setSt({ ...st, alertOnEnter: !st.alertOnEnter })}>
        {st.alertOnEnter ? <Bell size={11} /> : <BellOff size={11} />} Entry ✓
      </button>
      <button type="button" className={chip(st.alertOnExit)} onClick={() => setSt({ ...st, alertOnExit: !st.alertOnExit })}>
        {st.alertOnExit ? <Bell size={11} /> : <BellOff size={11} />} Exit ✓
      </button>
      <button type="button" className={chip(st.dwellMin !== null)}
        onClick={() => setSt({ ...st, dwellMin: st.dwellMin === null ? 30 : null })}>
        <Clock size={11} /> Dwell &gt;
        {st.dwellMin !== null && (
          <input value={st.dwellMin} onClick={(e) => e.stopPropagation()}
            onChange={(e) => setSt({ ...st, dwellMin: Math.max(5, Number(e.target.value) || 30) })}
            className="w-9 rounded border border-border bg-white px-1 font-mono text-[11px] text-ink-900 outline-none" />
        )}
        {st.dwellMin === null && <span className="font-mono">30</span>} min
      </button>
      <button type="button" className={chip(st.type === 'restricted')}
        onClick={() => setSt({ ...st, type: st.type === 'restricted' ? 'customer' : 'restricted' })}>
        <ShieldAlert size={11} /> Restricted hours
      </button>
      <div className="ml-auto flex items-center gap-2">
        {hint && <span className="font-mono text-[11px] text-accent-strong">{hint}</span>}
        <button type="button" onClick={onCancel}
          className="h-8 rounded-lg border border-border px-3 text-[12px] font-semibold text-ink-600 hover:bg-surface-muted">Cancel</button>
        <button type="button" onClick={onSave} disabled={saving || !st.name.trim()}
          className="h-8 rounded-lg bg-accent px-3.5 text-[12px] font-bold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97] disabled:opacity-40">
          Save zone
        </button>
      </div>
    </motion.div>
  );
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export default function GeofencesPage() {
  const geofences = useCollection('geofences');
  const events = useCollection('geofenceEvents');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const live = useLivePositions();
  const mapRef = useRef<FleetMapHandle>(null);

  const [selectedId, setSelectedId] = useState<string | null>(geofences[0]?.id ?? null);
  const [mode, setMode] = useState<'idle' | 'draw' | 'edit'>('idle');
  const [editor, setEditor] = useState<EditorState>({
    name: '', type: 'depot', shape: 'circle',
    alertOnEnter: true, alertOnExit: true, dwellMin: 30,
  });
  const [draftShape, setDraftShape] = useState<DrawShape | null>(null);
  const [drawHint, setDrawHint] = useState('');
  const [editGeo, setEditGeo] = useState<Geofence | null>(null);
  const [deleteFor, setDeleteFor] = useState<Geofence | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const positions = useMemo(() => new Map(live.map((p) => [p.vehicleId, p])), [live]);
  const plates = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles]);

  const insideCounts = useMemo(() => {
    const m = new Map<string, number>();
    geofences.forEach((gf) => {
      m.set(gf.id, live.filter((p) => pointInGeofence(p.lat, p.lng, gf)).length);
    });
    return m;
  }, [geofences, live]);

  const todayStats = useMemo(() => {
    const m = new Map<string, { entries: number; exits: number; dwells: number[] }>();
    geofences.forEach((gf) => m.set(gf.id, { entries: 0, exits: 0, dwells: [] }));
    events.forEach((e) => {
      if (e.at.slice(0, 10) !== TODAY) return;
      const s = m.get(e.geofenceId);
      if (!s) return;
      if (e.type === 'enter') s.entries++;
      else if (e.type === 'exit') s.exits++;
      else if (e.dwellMin) s.dwells.push(e.dwellMin);
    });
    return m;
  }, [events, geofences]);

  const flyToZone = useCallback((gf: Geofence) => {
    const c = gfCenter(gf);
    if (c) mapRef.current?.flyTo(c.lat, c.lng, gf.kind === 'circle' ? 14 : 15);
  }, []);

  const selectZone = (gf: Geofence) => {
    setSelectedId(gf.id);
    if (mode === 'idle') flyToZone(gf);
  };

  /* -------- draw flow -------- */
  const startDraw = () => {
    setEditor({ name: '', type: 'depot', shape: 'circle', alertOnEnter: true, alertOnExit: true, dwellMin: 30 });
    setDraftShape(null);
    setMode('draw');
  };
  const onShapeComplete = (shape: DrawShape) => {
    setDraftShape(shape);
    toast({ title: 'Shape captured', body: 'Name the zone and confirm rules, then Save zone.', status: 'info' });
  };
  const onDraft = useCallback((d: { center?: { lat: number; lng: number }; radiusM?: number; vertices: { lat: number; lng: number }[] }) => {
    if (d.vertices.length > 0) setDrawHint(`${d.vertices.length} point${d.vertices.length === 1 ? '' : 's'}${d.vertices.length >= 3 ? ' — click first point to close' : ''}`);
    else if (d.center) setDrawHint(`r = ${fmtNum(d.radiusM ?? 0)} m`);
    else setDrawHint('');
  }, []);

  const saveNewZone = () => {
    if (!draftShape) {
      toast({ title: 'Draw the zone first', body: editor.shape === 'circle' ? 'Click the map to set the center, then click again to set the radius.' : 'Click to add vertices; close via the first point.', status: 'warn' });
      return;
    }
    const rec = add('geofences', {
      id: '', name: editor.name.trim(), kind: draftShape.kind,
      center: draftShape.center, radiusM: draftShape.radiusM, polygon: draftShape.polygon,
      color: editor.type,
      rules: { alertOnEnter: editor.alertOnEnter, alertOnExit: editor.alertOnExit, alertOnDwellMin: editor.dwellMin },
      createdAt: new Date().toISOString(),
    } as Geofence);
    add('audit', {
      id: '', at: new Date().toISOString(), userId: 'usr-02', userName: 'Wanjiru Maina',
      action: 'create', collection: 'geofences', recordId: rec.id,
      summary: `Created geofence ${editor.name.trim()} (${draftShape.kind})`,
    });
    toast({ title: 'Zone saved — alerts active', body: `${editor.name.trim()} is now monitored.`, status: 'ok' });
    setSelectedId(rec.id);
    setMode('idle');
    setDraftShape(null);
  };

  /* -------- edit flow -------- */
  const startEdit = (gf: Geofence) => {
    setSelectedId(gf.id);
    setEditGeo({ ...gf, polygon: gf.polygon ? gf.polygon.map((p) => ({ ...p })) : undefined });
    setEditor({
      name: gf.name, type: zoneType(gf), shape: gf.kind,
      alertOnEnter: gf.rules.alertOnEnter, alertOnExit: gf.rules.alertOnExit,
      dwellMin: gf.rules.alertOnDwellMin,
    });
    setMode('edit');
    flyToZone(gf);
  };
  const saveEdit = () => {
    if (!editGeo) return;
    update('geofences', editGeo.id, {
      name: editor.name.trim(),
      center: editGeo.center, radiusM: editGeo.radiusM, polygon: editGeo.polygon,
      color: editor.type,
      rules: { alertOnEnter: editor.alertOnEnter, alertOnExit: editor.alertOnExit, alertOnDwellMin: editor.dwellMin },
    });
    add('audit', {
      id: '', at: new Date().toISOString(), userId: 'usr-02', userName: 'Wanjiru Maina',
      action: 'update', collection: 'geofences', recordId: editGeo.id,
      summary: `Updated geofence ${editor.name.trim()} (geometry/rules)`,
    });
    toast({ title: 'Zone updated', body: `${editor.name.trim()} geometry & rules saved.`, status: 'ok' });
    setMode('idle');
    setEditGeo(null);
  };

  const deleteZone = (gf: Geofence) => {
    remove('geofences', gf.id);
    add('audit', {
      id: '', at: new Date().toISOString(), userId: 'usr-02', userName: 'Wanjiru Maina',
      action: 'delete', collection: 'geofences', recordId: gf.id,
      summary: `Deleted geofence ${gf.name}`,
    });
    toast({ title: 'Zone deleted', body: `${gf.name} and its alert rules were removed.`, status: 'warn' });
    if (selectedId === gf.id) setSelectedId(null);
  };

  /* -------- fence rendering (own layers so dblclick-to-edit works) --- */
  const [layers, setLayers] = useState({ geofences: true, trails: false, labels: true, traffic: false });
  const fenceStyle = (gf: Geofence) => ({
    color: zoneType(gf) === 'restricted' ? '#DC2626' : '#06B6D4',
    weight: 2, dashArray: '6 4' as const,
    fillColor: zoneType(gf) === 'restricted' ? '#DC2626' : '#06B6D4',
    fillOpacity: selectedId === gf.id ? 0.16 : 0.08,
  });
  const renderFence = (gf: Geofence, override?: Geofence) => {
    const g = override ?? gf;
    const style = fenceStyle(g);
    const label = layers.labels && (
      <Tooltip permanent direction="center" className="fbv-gf-label" opacity={1}>{g.name.toUpperCase()}</Tooltip>
    );
    const handlers = { dblclick: () => mode === 'idle' && startEdit(gf) };
    if (g.kind === 'circle' && g.center && g.radiusM) {
      return <Circle key={g.id} center={[g.center.lat, g.center.lng]} radius={g.radiusM} pathOptions={style} pane="fbv-geofences" eventHandlers={handlers}>{label}</Circle>;
    }
    if (g.kind === 'polygon' && g.polygon) {
      return <Polygon key={g.id} positions={g.polygon.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={style} pane="fbv-geofences" eventHandlers={handlers}>{label}</Polygon>;
    }
    return null;
  };

  // vehicles inside any zone → tiny cyan in-zone dot badge
  const inZoneDots = useMemo(() => {
    const dots: { id: string; lat: number; lng: number }[] = [];
    live.forEach((p) => {
      if (geofences.some((gf) => pointInGeofence(p.lat, p.lng, gf))) dots.push({ id: p.vehicleId, lat: p.lat, lng: p.lng });
    });
    return dots;
  }, [live, geofences]);

  return (
    <motion.div initial="hidden" animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
      className="mx-auto flex max-w-[1520px] flex-col gap-4 p-4 lg:p-6">

      <motion.div variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
        className="flex flex-col gap-4 lg:flex-row">
        {/* LEFT — zone list */}
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[380px]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Geofences</h1>
              <p className="text-[13px] text-ink-400">Zones, draw editor &amp; dwell analytics</p>
            </div>
            <button type="button" onClick={startDraw}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-bold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
              <Plus size={15} /> New zone
            </button>
          </div>

          <div className="flex max-h-[520px] flex-col gap-2 overflow-y-auto pr-0.5 lg:max-h-[calc(100vh-220px)]">
            {geofences.map((gf, i) => {
              const st = todayStats.get(gf.id) ?? { entries: 0, exits: 0, dwells: [] };
              const avgDwell = st.dwells.length ? st.dwells.reduce((a, b) => a + b, 0) / st.dwells.length : 0;
              const inside = insideCounts.get(gf.id) ?? 0;
              const type = zoneType(gf);
              return (
                <motion.button key={gf.id} type="button"
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.05, ease: EASE }}
                  onClick={() => selectZone(gf)}
                  className={cn('relative flex min-h-[96px] flex-col gap-1 rounded-card border p-3 text-left shadow-card transition-colors',
                    selectedId === gf.id ? 'border-accent bg-accent-soft/50' : 'border-border bg-white hover:bg-surface-muted')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg',
                      type === 'restricted' ? 'bg-alert-soft text-alert' : 'bg-accent-soft text-accent-strong')}>
                      {gf.kind === 'circle' ? <CircleIcon size={14} /> : <Hexagon size={14} />}
                    </span>
                    <span className="flex-1 truncate text-[14px] font-semibold text-ink-900">{gf.name}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold', TYPE_PILL[type])}>{TYPE_LABEL[type]}</span>
                    <span className="relative">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === gf.id ? null : gf.id); }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-ink-400 hover:bg-surface-muted">
                        <MoreHorizontal size={14} />
                      </button>
                      {menuFor === gf.id && (
                        <span className="absolute right-0 top-7 z-30 flex w-32 flex-col rounded-lg border border-border bg-white py-1 shadow-pop"
                          onMouseLeave={() => setMenuFor(null)}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(null); startEdit(gf); }}
                            className="flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink-900 hover:bg-surface-muted"><Pencil size={12} /> Edit</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setMenuFor(null); setDeleteFor(gf); }}
                            className="flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-alert hover:bg-surface-muted"><Trash2 size={12} /> Delete</button>
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-micro text-ink-400">
                    <span className="font-mono">{gf.kind === 'circle' ? `r ${fmtNum(gf.radiusM ?? 0)} m` : `${gf.polygon?.length ?? 0} vertices`}</span>
                    <span className="truncate">{rulesSummary(gf)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border/60 pt-1.5 font-mono text-[10px] text-ink-400">
                    <span>Entries today {st.entries} · Exits {st.exits} · Avg dwell {avgDwell ? humanizeMin(avgDwell) : '—'}</span>
                    <span className={cn('font-semibold', inside > 0 ? 'text-ok' : 'text-ink-400')}>
                      {inside > 0 ? `${inside} inside now` : 'empty'}
                    </span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* RIGHT — map editor */}
        <motion.div variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} transition={{ duration: 0.4 }}
          className="relative min-h-[55vh] flex-1 overflow-hidden rounded-card border border-border shadow-card lg:min-h-[calc(100vh-220px)]">
          <FleetMap
            ref={mapRef}
            positions={positions}
            plates={plates}
            geofences={[]}
            layers={layers}
            onLayers={setLayers}
            selectedId={null}
            onVehicleClick={(id) => {
              const v = vehicles.find((x) => x.id === id);
              if (v) toast({ title: v.plate, body: `In-zone badges show when a vehicle sits inside a fence.`, status: 'info' });
            }}
          >
            {layers.geofences && geofences.filter((gf) => gf.id !== editGeo?.id).map((gf) => renderFence(gf))}
            {editGeo && renderFence(editGeo, editGeo)}
            {editGeo && mode === 'edit' && (
              <FenceEditHandles geofence={editGeo} onChange={(patch) => setEditGeo((g) => (g ? { ...g, ...patch } : g))} />
            )}
            <GeofenceDrawLayer
              mode={editor.shape}
              active={mode === 'draw' && !draftShape}
              onComplete={onShapeComplete}
              onDraft={onDraft}
            />
            {/* saved-but-unsent draft preview */}
            {draftShape && mode === 'draw' && (
              draftShape.kind === 'circle' && draftShape.center ? (
                <Circle center={[draftShape.center.lat, draftShape.center.lng]} radius={draftShape.radiusM ?? 60}
                  pathOptions={{ color: '#06B6D4', weight: 2, fillColor: '#06B6D4', fillOpacity: 0.14 }} pane="fbv-geofences" />
              ) : draftShape.polygon ? (
                <Polygon positions={draftShape.polygon.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#06B6D4', weight: 2, fillColor: '#06B6D4', fillOpacity: 0.14 }} pane="fbv-geofences" />
              ) : null
            )}
            {inZoneDots.map((d) => (
              <CircleMarker key={d.id} center={[d.lat + 0.0009, d.lng + 0.0009]} radius={3.5} pane="fbv-markers"
                pathOptions={{ color: '#06B6D4', weight: 1.5, fillColor: '#06B6D4', fillOpacity: 0.9 }} />
            ))}
          </FleetMap>

          {/* floating toolbar */}
          <div className="pointer-events-none absolute inset-x-0 top-3 z-[700] flex justify-center px-3">
            {mode === 'draw' && (
              <div className="pointer-events-auto flex items-start gap-2">
                <EditorToolbar st={editor} setSt={setEditor} onSave={saveNewZone}
                  onCancel={() => { setMode('idle'); setDraftShape(null); }}
                  hint={draftShape ? (draftShape.kind === 'circle' ? `r = ${fmtNum(draftShape.radiusM ?? 0)} m` : `${draftShape.polygon?.length} vertices`) : drawHint || (editor.shape === 'circle' ? 'click: center → radius' : 'click to add vertices')} />
                {draftShape && (
                  <button type="button" onClick={() => setDraftShape(null)}
                    className="glass-white h-8 rounded-lg border border-border px-3 text-[12px] font-semibold text-ink-600 shadow-pop hover:bg-surface-muted">
                    Redraw
                  </button>
                )}
              </div>
            )}
            {mode === 'edit' && editGeo && (
              <EditorToolbar st={editor} setSt={setEditor} onSave={saveEdit}
                onCancel={() => { setMode('idle'); setEditGeo(null); }}
                hint={editGeo.kind === 'circle' ? `r = ${fmtNum(editGeo.radiusM ?? 0)} m` : `${editGeo.polygon?.length} vertices`} />
            )}
            {mode === 'idle' && (
              <div className="glass-white pointer-events-auto flex items-center gap-2 rounded-full border border-border px-3.5 py-1.5 text-[11px] text-ink-600 shadow-card">
                <MapPin size={12} className="text-accent-strong" />
                Double-click a fence (or ⋮ → Edit) to reshape · + New zone to draw
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      {/* BELOW FOLD — zone activity reports */}
      <ZoneActivity
        geofences={geofences}
        events={events}
        vehicles={vehicles}
        drivers={drivers}
      />

      <ConfirmDialog
        open={!!deleteFor}
        onClose={() => setDeleteFor(null)}
        onConfirm={() => deleteFor && deleteZone(deleteFor)}
        title={`Delete ${deleteFor?.name}?`}
        destructive
        confirmLabel="Delete zone"
        body={deleteFor && (
          <div className="flex flex-col gap-2">
            <span>This removes the zone and its linked alert rules:</span>
            <span className="rounded-lg bg-surface-muted px-3 py-2 font-mono text-[12px] text-ink-600">{rulesSummary(deleteFor)}</span>
            <span>{events.filter((e) => e.geofenceId === deleteFor.id).length} logged zone events stay in history.</span>
          </div>
        )}
      />
    </motion.div>
  );
}

/* ================================================================== */
/* Below fold — zone activity reports                                  */
/* ================================================================== */

const EVENT_PILL: Record<GeofenceEvent['type'], { cls: string; label: string }> = {
  enter: { cls: 'bg-accent-soft text-accent-strong', label: 'ENTERED' },
  exit: { cls: 'bg-navy-900 text-white', label: 'EXITED' },
  dwell: { cls: 'bg-warn-soft text-warn-on-soft', label: 'DWELL' },
};

function dateDaysAgo(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function ZoneActivity({ geofences, events, vehicles, drivers }: {
  geofences: Geofence[]; events: GeofenceEvent[];
  vehicles: { id: string; plate: string; assignedDriverId: string | null }[];
  drivers: { id: string; name: string }[];
}) {
  const [zoneF, setZoneF] = useState('all');
  const [vehF, setVehF] = useState('all');
  const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(TODAY);

  const gfById = useMemo(() => new Map(geofences.map((g) => [g.id, g])), [geofences]);
  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const driverName = useCallback((vehId: string) => {
    const v = vehById.get(vehId);
    return drivers.find((d) => d.id === v?.assignedDriverId)?.name ?? '—';
  }, [vehById, drivers]);

  const rows = useMemo(() => events
    .filter((e) => (zoneF === 'all' || e.geofenceId === zoneF)
      && (vehF === 'all' || e.vehicleId === vehF)
      && e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to)
    .sort((a, b) => b.at.localeCompare(a.at)),
    [events, zoneF, vehF, from, to]);

  const alertSent = (e: GeofenceEvent): boolean => {
    const gf = gfById.get(e.geofenceId);
    if (!gf) return false;
    if (e.type === 'enter') return gf.rules.alertOnEnter;
    if (e.type === 'exit') return gf.rules.alertOnExit;
    return gf.rules.alertOnDwellMin !== null && (e.dwellMin ?? 0) >= gf.rules.alertOnDwellMin;
  };

  const exportLog = () => {
    const data = rows.map((e) => ({
      Time: fmtDateTimeEAT(e.at, true),
      Vehicle: vehById.get(e.vehicleId)?.plate ?? e.vehicleId,
      Driver: driverName(e.vehicleId),
      Zone: gfById.get(e.geofenceId)?.name ?? e.geofenceId,
      Event: EVENT_PILL[e.type].label,
      'Dwell (min)': e.dwellMin ?? '',
      'Alert sent': alertSent(e) ? 'yes' : 'no',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = Object.keys(data[0] ?? { Time: 1 }).map((k) => ({ wch: Math.max(12, k.length + 6) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Zone activity');
    XLSX.writeFile(wb, `geofence-activity-${from}_${to}.xlsx`);
    toast({ title: 'Export ready', body: `geofence-activity-${from}_${to}.xlsx — ${rows.length} events.`, status: 'ok' });
  };

  /* dwell report — avg dwell per zone, trailing 7 days */
  const dwellReport = useMemo(() => {
    const cutoff = dateDaysAgo(7);
    const acc = new Map<string, number[]>();
    events.forEach((e) => {
      if (e.type === 'dwell' && e.dwellMin && e.at.slice(0, 10) >= cutoff) {
        acc.set(e.geofenceId, [...(acc.get(e.geofenceId) ?? []), e.dwellMin]);
      }
    });
    const rows = geofences.map((gf) => {
      const ds = acc.get(gf.id) ?? [];
      return { name: gf.name, avg: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : 0, n: ds.length };
    }).sort((a, b) => b.avg - a.avg);
    return rows;
  }, [events, geofences]);
  const maxDwell = Math.max(30, ...dwellReport.map((r) => r.avg));
  const topZone = dwellReport[0];

  /* restricted violations */
  const violations = useMemo(() => events.filter((e) => {
    if (e.type !== 'enter') return false;
    const gf = gfById.get(e.geofenceId);
    if (!gf || zoneType(gf) !== 'restricted') return false;
    if (gf.id === 'gf-03') { // JKIA Cargo — restricted after hours only
      const h = new Date(e.at).getUTCHours();
      return h >= 19 || h < 6;
    }
    return true;
  }).slice(0, 4), [events, gfById]);

  const columns: Column<GeofenceEvent>[] = [
    { key: 'time', header: 'Time', mono: true, render: (e) => `${fmtDateEAT(e.at)} ${fmtTimeEAT(e.at)}` },
    { key: 'vehicle', header: 'Vehicle', render: (e) => <PlateTag plate={vehById.get(e.vehicleId)?.plate ?? e.vehicleId} /> },
    { key: 'driver', header: 'Driver', render: (e) => <span className="text-[13px] text-ink-600">{driverName(e.vehicleId)}</span> },
    { key: 'zone', header: 'Zone', render: (e) => <span className="text-[13px] font-medium text-ink-900">{gfById.get(e.geofenceId)?.name ?? e.geofenceId}</span> },
    {
      key: 'event', header: 'Event',
      render: (e) => <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold', EVENT_PILL[e.type].cls)}>{EVENT_PILL[e.type].label}</span>,
    },
    { key: 'dwell', header: 'Dwell', mono: true, render: (e) => (e.dwellMin ? humanizeMin(e.dwellMin) : '—') },
    {
      key: 'alert', header: 'Alert sent', align: 'center',
      render: (e) => (alertSent(e)
        ? <span className="font-mono text-[12px] font-bold text-ok">✓</span>
        : <span className="text-ink-400">—</span>),
    },
  ];

  const selectCls = 'h-9 rounded-lg border border-border bg-white px-2 text-[12px] font-medium text-ink-900 outline-none focus:border-accent';

  return (
    <div className="flex flex-col gap-4">
      <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
        transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-bold leading-[26px] tracking-[-0.01em] text-ink-900">Zone activity</h2>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={zoneF} onChange={(e) => setZoneF(e.target.value)} className={selectCls}>
              <option value="all">All zones</option>
              {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={vehF} onChange={(e) => setVehF(e.target.value)} className={selectCls}>
              <option value="all">All vehicles</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
            </select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(selectCls, 'font-mono')} />
            <span className="text-[12px] text-ink-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cn(selectCls, 'font-mono')} />
            <button type="button" onClick={exportLog}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white hover:bg-navy-800">
              <Download size={13} /> Export Excel
            </button>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          pageSize={10}
          empty={<EmptyState icon={MapPin} title="No zone events in range" hint="Widen the date range — seeded history spans the last 14 days." />}
        />
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* dwell-time report */}
        <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="rounded-card border border-border bg-white p-4 shadow-card">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold leading-[22px] text-ink-900">Avg dwell per zone — this week</h3>
            <span className="font-mono text-[11px] text-ink-400">reference 30 min</span>
          </div>
          <div className="relative mt-3 flex flex-col gap-2.5">
            {/* 30-min reference line */}
            <span className="absolute bottom-0 top-5 w-px bg-navy-900/50" style={{ left: `calc(120px + (100% - 190px) * ${30 / maxDwell})` }} />
            {dwellReport.map((r, i) => (
              <div key={r.name} className="flex items-center gap-2">
                <span className="w-[112px] shrink-0 truncate text-right text-[12px] font-medium text-ink-600">{r.name}</span>
                <div className="relative h-5 flex-1">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(r.avg / maxDwell) * 100}%` }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.7, delay: i * 0.05, ease: EASE }}
                    className={cn('h-full rounded-md', r.avg > 30 ? 'bg-accent' : 'bg-accent/45')}
                  />
                </div>
                <span className="w-[70px] shrink-0 font-mono text-[11px] font-semibold text-navy-800">
                  {r.avg ? humanizeMin(r.avg) : '—'}
                </span>
              </div>
            ))}
          </div>
          {topZone && topZone.avg > 0 && (
            <p className="mt-3 border-t border-border/60 pt-2 text-[12px] text-ink-600">
              <span className="font-semibold text-ink-900">{topZone.name}</span> dwell ↑ — avg {humanizeMin(topZone.avg)} across {topZone.n} stops this week; possible offloading bottleneck.
            </p>
          )}
        </motion.div>

        {/* restricted-zone violations */}
        <motion.div initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="flex flex-col gap-2 rounded-card border border-border bg-white p-4 shadow-card">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-alert" />
            <h3 className="text-[15px] font-semibold leading-[22px] text-ink-900">Restricted-zone violations</h3>
            <span className="rounded-full bg-alert-soft px-2 py-0.5 text-micro font-semibold text-alert-on-soft">{violations.length}</span>
          </div>
          {violations.length === 0 && (
            <EmptyState icon={ShieldAlert} title="No violations" hint="No restricted-zone entries detected in the seeded window." />
          )}
          {violations.map((e) => {
            const gf = gfById.get(e.geofenceId);
            const plate = vehById.get(e.vehicleId)?.plate ?? e.vehicleId;
            const date = e.at.slice(0, 10);
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-alert-soft/70 px-3 py-2">
                <AlertTriangle size={14} className="shrink-0 text-alert" />
                <span className="text-[13px] font-medium text-alert-on-soft">
                  <span className="font-mono font-bold">{plate}</span> entered {gf?.name ?? 'restricted zone'} — {fmtDateTimeEAT(e.at)}
                  {e.dwellMin ? ` · ${humanizeMin(e.dwellMin)}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <button type="button"
                    onClick={() => toast({ title: 'Alert rule created', body: `Entry alert now armed for ${gf?.name}.`, status: 'ok' })}
                    className="rounded-md bg-white/80 px-2 py-1 text-[11px] font-semibold text-alert-on-soft hover:bg-white">
                    Create alert rule
                  </button>
                  <Link to={`/tracking?vehicle=${plate.replace(/\s/g, '')}&date=${date}`}
                    className="rounded-md bg-white/80 px-2 py-1 text-[11px] font-semibold text-accent-strong hover:bg-white">
                    View replay →
                  </Link>
                </span>
              </div>
            );
          })}
        </motion.div>
      </div>
    </div>
  );
}
