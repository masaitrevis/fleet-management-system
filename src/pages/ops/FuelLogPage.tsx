// FBV FleetOS — /fuel — Fuel log, anomaly alerts & Excel bulk upload (fuel.md).

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Camera, Check, ChevronLeft, ChevronRight, CircleCheck, Download, FileSpreadsheet,
  Flag, Fuel, Gauge, Pencil, Plus, ShieldAlert, Timer, Upload, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { add, kvGet, kvSet, update, useCollection, useKV } from '@/lib/store';
import type { FuelLog, Vehicle } from '@/lib/types';
import { fmtDateTimeEAT, fmtKES, fmtNum } from '@/lib/format';
import {
  AlertBanner, ColumnMapper, Drawer, FileDropzone, KPIStatCard, Modal, PlateTag,
  StatusPill, toast,
} from '@/components/shared';
import type { ColumnMapping } from '@/components/shared';
import {
  Btn, Card, DEMO_NOW_ISO, EASE, PageHeader, PageShell, SubNavPills,
  downloadSheet, evaluateFuelLog, hash01, kmPerLitre, kmSincePrev,
  readSheetRows, rollingAvgKmpl, withinDays, MiniMap, IDLE_L_PER_H, daysAgoOf,
} from './ops-shared';
import type { AnomalyFlag } from './ops-shared';

/* ------------------------------------------------------------------ */
/* Review decisions (kv)                                               */
/* ------------------------------------------------------------------ */

interface FuelReview { status: 'fraud' | 'cleared'; reason?: string; at: string; by: string }
type ReviewMap = Record<string, FuelReview>;

function getReviews(): ReviewMap { return (kvGet('fuel-reviews' as never) as unknown as ReviewMap) ?? {}; }
function setReview(logId: string, r: FuelReview) {
  kvSet('fuel-reviews' as never, { ...getReviews(), [logId]: r } as never);
}

const SOURCE_OF = (id: string): 'MOBILE' | 'EXCEL' | 'CARD' =>
  (['MOBILE', 'EXCEL', 'CARD'] as const)[Math.floor(hash01(id + 'src') * 3)];

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */

export default function FuelLogPage() {
  const logs = useCollection('fuelLogs');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const trips = useCollection('trips');
  const settings = useKV('settings');
  const reviews = (useKV('fuel-reviews' as never) as unknown as ReviewMap) ?? {};

  const [fVehicle, setFVehicle] = useState('');
  const [fDriver, setFDriver] = useState('');
  const [fStation, setFStation] = useState('');
  const [fSource, setFSource] = useState('');
  const [fDays, setFDays] = useState('60');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logModal, setLogModal] = useState<{ open: boolean; edit?: FuelLog }>({ open: false });
  const [wizardOpen, setWizardOpen] = useState(false);

  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const drvById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  /** anomaly flags per log id */
  const flagsById = useMemo(() => {
    const m = new Map<string, AnomalyFlag[]>();
    for (const l of logs) {
      const f = evaluateFuelLog(l, vehById.get(l.vehicleId), logs);
      if (f.length) m.set(l.id, f);
    }
    return m;
  }, [logs, vehById]);

  const stations = useMemo(() => Array.from(new Set(logs.map((l) => l.station))).sort(), [logs]);

  const filtered = useMemo(() => {
    const days = Number(fDays);
    return logs
      .filter((l) => withinDays(l.at, days))
      .filter((l) => !fVehicle || l.vehicleId === fVehicle)
      .filter((l) => !fDriver || l.driverId === fDriver)
      .filter((l) => !fStation || l.station === fStation)
      .filter((l) => !fSource || SOURCE_OF(l.id) === fSource)
      .filter((l) => !flaggedOnly || flagsById.has(l.id))
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [logs, fVehicle, fDriver, fStation, fSource, fDays, flaggedOnly, flagsById]);

  /* KPI strip — month-to-date (Jul 2026) */
  const mtd = useMemo(() => logs.filter((l) => l.at.slice(0, 7) === '2026-07'), [logs]);
  const spendMtd = mtd.reduce((a, l) => a + l.totalKes, 0);
  const litresMtd = mtd.reduce((a, l) => a + l.litres, 0);
  const fleetAvg = useMemo(() => {
    const vals = mtd.map((l) => kmPerLitre(l, logs)).filter((v): v is number => v != null && v > 2 && v < 30);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [mtd, logs]);
  const anomalies30 = useMemo(
    () => logs.filter((l) => withinDays(l.at, 30) && flagsById.has(l.id) && !reviews[l.id]).length,
    [logs, flagsById, reviews],
  );
  const idle = useMemo(() => {
    const mins = trips.filter((t) => t.startAt.slice(0, 7) === '2026-07').reduce((a, t) => a + t.idleMin, 0);
    const litres = (mins / 60) * IDLE_L_PER_H;
    return { litres, cost: litres * settings.fuelPriceDieselKes };
  }, [trips, settings]);

  const recentFlagged = useMemo(
    () => logs.filter((l) => withinDays(l.at, 7) && flagsById.has(l.id) && !reviews[l.id])
      .sort((a, b) => b.at.localeCompare(a.at)),
    [logs, flagsById, reviews],
  );

  const litresSpark = useMemo(() => {
    const out: number[] = [];
    for (let d = 13; d >= 0; d--) {
      out.push(logs.filter((l) => daysAgoOf(l.at) === d).reduce((a, l) => a + l.litres, 0));
    }
    return out;
  }, [logs]);

  const selected = selectedId ? logs.find((l) => l.id === selectedId) : undefined;

  const exportRows = () => {
    downloadSheet(filtered.map((l) => ({
      Date: fmtDateTimeEAT(l.at),
      Plate: vehById.get(l.vehicleId)?.plate ?? l.vehicleId,
      Driver: drvById.get(l.driverId)?.name ?? l.driverId,
      Station: l.station,
      Litres: l.litres.toFixed(2),
      PricePerL: l.pricePerLKes.toFixed(2),
      TotalKES: l.totalKes,
      OdometerKm: l.odometerKm,
      KmSinceLast: kmSincePrev(l, logs) ?? '',
      KmPerL: kmPerLitre(l, logs)?.toFixed(1) ?? '',
      Source: SOURCE_OF(l.id),
      AnomalyFlags: (flagsById.get(l.id) ?? []).map((f) => f.label).join('; '),
    })), 'fuel-log-jul-2026.xlsx', 'Fuel Log');
    toast({ title: 'Export started', body: `${filtered.length} rows → fuel-log-jul-2026.xlsx`, status: 'ok' });
  };

  return (
    <PageShell>
      <PageHeader title="Fuel" sub="Fill-up log, anomaly detection & bulk upload — diesel baseline KES 189.50/L"
        actions={<>
          <Btn icon={Plus} onClick={() => setLogModal({ open: true })}>Log fill-up</Btn>
          <Btn icon={Upload} variant="ghost" onClick={() => setWizardOpen(true)}>Bulk upload (Excel)</Btn>
          <Btn icon={Download} variant="ghost" onClick={exportRows}>Export</Btn>
        </>} />

      <SubNavPills items={[{ to: '/fuel', label: 'Fuel Log' }, { to: '/fuel/analytics', label: 'Analytics & Idling →' }]} />

      {/* anomaly banner */}
      <AnimatePresence>
        {recentFlagged.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: EASE }} className="overflow-hidden rounded-card shadow-card">
            <AlertBanner severity="alert"
              message={<span>
                {recentFlagged.length} fuel anomal{recentFlagged.length === 1 ? 'y' : 'ies'} in the last 7 days —{' '}
                {recentFlagged.slice(0, 2).map((l, i) => (
                  <span key={l.id}>{i > 0 && ' · '}{(flagsById.get(l.id)?.[0]?.label ?? 'flagged').toLowerCase()} ({vehById.get(l.vehicleId)?.plate})</span>
                ))}
                {recentFlagged.length > 2 && ` · +${recentFlagged.length - 2} more`}. Review flagged rows ↓
              </span>}
              actionLabel={flaggedOnly ? undefined : 'Show only flagged'}
              onAction={() => setFlaggedOnly(true)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KPIStatCard label="Spend MTD" value={spendMtd} format={(v) => fmtKES(v)} icon={Fuel}
          delta="Jul 2026" spark={litresSpark.map((l) => l * settings.fuelPriceDieselKes)} />
        <KPIStatCard label="Litres MTD" value={litresMtd} format={(v) => `${fmtNum(v)} L`} icon={Fuel} spark={litresSpark} />
        <KPIStatCard label="Fleet avg" value={fleetAvg} format={(v) => `${v.toFixed(1)} km/L`} icon={Gauge} delta="target 9.0" deltaGood={fleetAvg >= 9} />
        <KPIStatCard label="Anomalies 30d" value={anomalies30} icon={ShieldAlert} deltaGood={false}
          delta={anomalies30 > 0 ? 'review required' : 'clear'} sparkColor="#DC2626"
          onClick={() => setFlaggedOnly(true)} />
        <KPIStatCard label="Idle fuel wasted MTD" value={idle.litres} format={(v) => `${fmtNum(v)} L`}
          icon={Timer} delta={`≈ ${fmtKES(idle.cost)}`} deltaGood={false} sparkColor="#F59E0B" />
      </div>

      {/* filters */}
      <Card pad={false} className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select label="Vehicle" value={fVehicle} onChange={setFVehicle}
            options={vehicles.map((v) => ({ value: v.id, label: v.plate }))} />
          <Select label="Driver" value={fDriver} onChange={setFDriver}
            options={drivers.map((d) => ({ value: d.id, label: d.name }))} />
          <Select label="Station" value={fStation} onChange={setFStation}
            options={stations.map((s) => ({ value: s, label: s }))} />
          <Select label="Source" value={fSource} onChange={setFSource}
            options={['MOBILE', 'EXCEL', 'CARD'].map((s) => ({ value: s, label: s }))} />
          <Select label="Range" value={fDays} onChange={setFDays}
            options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '60', label: 'Last 60 days' }]} allLabel="" />
          <label className={cn(
            'ml-auto flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
            flaggedOnly ? 'border-alert bg-alert-soft text-alert-on-soft' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            <input type="checkbox" className="hidden" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            <Flag size={13} /> Flagged only
          </label>
        </div>
      </Card>

      {/* log table */}
      <FuelTable rows={filtered} logs={logs} vehById={vehById} drvById={drvById}
        flagsById={flagsById} reviews={reviews}
        onRow={(l) => setSelectedId(l.id)}
        onEdit={(l) => setLogModal({ open: true, edit: l })} />

      {/* detail drawer */}
      {selected && (
        <FuelDetailDrawer log={selected} logs={logs} vehicle={vehById.get(selected.vehicleId)}
          driverName={drvById.get(selected.driverId)?.name ?? '—'}
          flags={flagsById.get(selected.id) ?? []} review={reviews[selected.id]}
          onClose={() => setSelectedId(null)}
          onEdit={() => { setSelectedId(null); setLogModal({ open: true, edit: selected }); }} />
      )}

      {/* log fill-up modal */}
      <LogFillModal open={logModal.open} edit={logModal.edit} logs={logs} vehicles={vehicles}
        dieselPrice={settings.fuelPriceDieselKes} petrolPrice={settings.fuelPricePetrolKes}
        stations={stations} onClose={() => setLogModal({ open: false })} />

      {/* bulk upload wizard */}
      <UploadWizard open={wizardOpen} logs={logs} vehicles={vehicles} stations={stations}
        onClose={() => setWizardOpen(false)} />
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Filter select                                                       */
/* ------------------------------------------------------------------ */

function Select({ label, value, onChange, options, allLabel }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; allLabel?: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink-400">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-[170px] rounded-lg border border-border bg-white px-2 text-[13px] text-ink-900 outline-none focus:border-accent">
        {allLabel !== '' && <option value="">All</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Fuel log table (custom — flagged rows need red bg + left bar)       */
/* ------------------------------------------------------------------ */

function FuelTable({ rows, logs, vehById, drvById, flagsById, reviews, onRow, onEdit }: {
  rows: FuelLog[]; logs: FuelLog[];
  vehById: Map<string, Vehicle>; drvById: Map<string, { id: string; name: string }>;
  flagsById: Map<string, AnomalyFlag[]>; reviews: ReviewMap;
  onRow: (l: FuelLog) => void; onEdit: (l: FuelLog) => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => { if (page >= pages) setPage(0); }, [pages, page]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="sticky top-0 border-b border-border bg-surface-muted/70 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
              {['Date / time', 'Vehicle', 'Driver', 'Station', 'Litres', 'Price/L', 'Total', 'Odometer', 'km since', 'km/L', 'Source', 'Anomaly flags', ''].map((h, i) => (
                <th key={i} className={cn('h-9 px-3', i >= 4 && i <= 9 && 'text-right')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((l, i) => {
              const v = vehById.get(l.vehicleId);
              const flags = flagsById.get(l.id) ?? [];
              const review = reviews[l.id];
              const kmpl = kmPerLitre(l, logs);
              const avg = rollingAvgKmpl(l.vehicleId, logs, l.id);
              const band = kmpl == null || avg == null ? 'neutral'
                : kmpl >= avg * 1.05 ? 'good' : kmpl < avg * 0.85 ? 'bad' : 'neutral';
              const km = kmSincePrev(l, logs);
              return (
                <motion.tr key={l.id}
                  initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.025, ease: EASE }}
                  onClick={() => onRow(l)}
                  className={cn('cursor-pointer border-b border-border/60 transition-colors duration-100',
                    flags.length && !review ? 'bg-alert-soft/40 hover:bg-alert-soft/70' : 'hover:bg-surface-muted')}>
                  <td className={cn('h-11 px-3 font-mono text-[12px] text-ink-600',
                    flags.length && !review && 'border-l-[3px] border-l-alert')}>
                    {fmtDateTimeEAT(l.at)}
                  </td>
                  <td className="h-11 px-3">{v ? <PlateTag plate={v.plate} /> : '—'}</td>
                  <td className="h-11 px-3 text-[13px]">{drvById.get(l.driverId)?.name ?? '—'}</td>
                  <td className="h-11 max-w-[180px] truncate px-3 text-[13px]">{l.station}</td>
                  <td className="h-11 px-3 text-right font-mono text-[12px]">{l.litres.toFixed(2)}</td>
                  <td className="h-11 px-3 text-right font-mono text-[12px]">{l.pricePerLKes.toFixed(2)}</td>
                  <td className="h-11 px-3 text-right font-mono text-[12px] font-semibold">{fmtKES(l.totalKes)}</td>
                  <td className="h-11 px-3 text-right font-mono text-[12px]">{fmtNum(l.odometerKm)}</td>
                  <td className="h-11 px-3 text-right font-mono text-[12px] text-ink-600">{km != null ? fmtNum(km) : '—'}</td>
                  <td className={cn('h-11 px-3 text-right font-mono text-[12px] font-semibold',
                    band === 'good' ? 'text-ok-on-soft' : band === 'bad' ? 'text-alert' : 'text-ink-600')}>
                    {kmpl != null ? kmpl.toFixed(1) : '—'}
                  </td>
                  <td className="h-11 px-3">
                    <span className="rounded-full bg-inactive-soft px-2 py-0.5 text-micro font-medium text-inactive-on-soft">{SOURCE_OF(l.id)}</span>
                  </td>
                  <td className="h-11 px-3">
                    <div className="flex flex-wrap gap-1">
                      {review ? (
                        <span className={cn('rounded-full px-2 py-0.5 text-micro font-medium uppercase',
                          review.status === 'fraud' ? 'bg-alert text-white' : 'bg-ok-soft text-ok-on-soft')}>
                          {review.status === 'fraud' ? 'FRAUD' : 'CLEARED'}
                        </span>
                      ) : flags.map((f, fi) => (
                        <motion.span key={f.code} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.1 + fi * 0.05, duration: 0.2 }}
                          className={cn('whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold',
                            f.severity === 'alert' ? 'bg-alert text-white' : 'bg-warn-soft text-warn-on-soft')}>
                          {f.label}
                        </motion.span>
                      ))}
                    </div>
                  </td>
                  <td className="h-11 px-2" onClick={(e) => e.stopPropagation()}>
                    <button type="button" title="Edit" onClick={() => onEdit(l)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-surface-muted hover:text-ink-900">
                      <Pencil size={14} />
                    </button>
                  </td>
                </motion.tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-10 text-center text-[13px] text-ink-400">No fuel logs match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-micro text-ink-400">
        <span className="font-mono">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-muted disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="font-mono">{page + 1} / {pages}</span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-muted disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail drawer — fields + mini map + computed checks + review flows  */
/* ------------------------------------------------------------------ */

function FuelDetailDrawer({ log, logs, vehicle, driverName, flags, review, onClose, onEdit }: {
  log: FuelLog; logs: FuelLog[]; vehicle: Vehicle | undefined; driverName: string;
  flags: AnomalyFlag[]; review: FuelReview | undefined;
  onClose: () => void; onEdit: () => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fraudOpen, setFraudOpen] = useState(false);
  const [reason, setReason] = useState('');
  const kmpl = kmPerLitre(log, logs);
  const avg = rollingAvgKmpl(log.vehicleId, logs, log.id);
  const gpsKm = flags.find((f) => f.code === 'GPS MISMATCH')
    ? Math.max(6, Math.round(hash01(log.id) * 28 + 6)) : 0;
  const mismatch = gpsKm > 0;
  const tankOk = !vehicle || log.litres <= vehicle.tankCapacityL;

  const confirmFraud = () => {
    setReview(log.id, { status: 'fraud', at: DEMO_NOW_ISO, by: 'Wanjiru Maina' });
    add('alerts', {
      id: '', type: 'fuel_anomaly', severity: 'critical',
      message: `Fuel fraud confirmed — ${flags[0]?.label ?? 'anomaly'} (${vehicle?.plate ?? log.vehicleId}, ${log.station})`,
      entityRef: { kind: 'vehicle', id: log.vehicleId, label: vehicle?.plate ?? log.vehicleId },
      at: DEMO_NOW_ISO, read: false, acknowledged: false,
    });
    add('audit', {
      id: '', at: DEMO_NOW_ISO, userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
      collection: 'fuelLogs', recordId: log.id,
      summary: `Confirmed fuel fraud — ${vehicle?.plate ?? log.vehicleId} ${log.litres.toFixed(0)} L at ${log.station}`,
    });
    toast({ title: 'Fraud confirmed', body: 'Alert raised + audit entry written.', status: 'alert' });
  };

  const markReviewed = () => {
    setReview(log.id, { status: 'cleared', reason, at: DEMO_NOW_ISO, by: 'Wanjiru Maina' });
    add('audit', {
      id: '', at: DEMO_NOW_ISO, userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
      collection: 'fuelLogs', recordId: log.id,
      summary: `Fuel anomaly cleared (legitimate) — ${vehicle?.plate ?? log.vehicleId}: ${reason}`,
    });
    toast({ title: 'Marked reviewed — legitimate', status: 'ok' });
  };

  const rows: [string, React.ReactNode][] = [
    ['Date / time', <span className="font-mono text-[12px]">{fmtDateTimeEAT(log.at, true)}</span>],
    ['Vehicle', vehicle ? <PlateTag plate={vehicle.plate} /> : log.vehicleId],
    ['Driver', driverName],
    ['Station', log.station],
    ['Litres', <span className="font-mono text-[12px]">{log.litres.toFixed(2)} L</span>],
    ['Price / L', <span className="font-mono text-[12px]">{log.pricePerLKes.toFixed(2)} KES</span>],
    ['Total', <span className="font-mono text-[12px] font-semibold">{fmtKES(log.totalKes)}</span>],
    ['Odometer', <span className="font-mono text-[12px]">{fmtNum(log.odometerKm)} km</span>],
    ['Source', SOURCE_OF(log.id)],
  ];

  return (
    <Drawer open onClose={onClose} width={500}
      title={<span className="flex items-center gap-2">Fill-up detail {flags.length > 0 && !review && <StatusPill status="alert" label="Flagged" />}
        {review && <StatusPill status={review.status === 'fraud' ? 'alert' : 'ok'} label={review.status === 'fraud' ? 'Fraud confirmed' : 'Cleared'} />}</span>}
      footer={
        <div className="flex flex-wrap gap-2">
          <Btn icon={ShieldAlert} variant="danger" onClick={() => setFraudOpen(true)} disabled={review?.status === 'fraud'}>Confirm fraud</Btn>
          <Btn icon={CircleCheck} variant="ok" onClick={() => setReviewOpen(true)} disabled={review?.status === 'cleared'}>Mark reviewed — legitimate</Btn>
          <Btn icon={Pencil} variant="ghost" onClick={onEdit}>Edit</Btn>
        </div>
      }>
      <div className="flex flex-col gap-4">
        {/* fields */}
        <div className="overflow-hidden rounded-lg border border-border">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[130px,1fr] border-b border-border/60 text-[13px] last:border-0">
              <div className="bg-surface-muted/60 px-3 py-2 font-medium text-ink-600">{k}</div>
              <div className="px-3 py-2 text-ink-900">{v}</div>
            </div>
          ))}
        </div>

        {/* mini map — station pin vs vehicle GPS at fill time */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
            Station vs vehicle GPS {mismatch && <span className="font-mono text-alert">· {gpsKm} km apart</span>}
          </div>
          <MiniMap height={190}
            pins={[
              { lat: log.lat, lng: log.lng, color: '#DC2626', label: log.station.split(' ')[0], kind: 'station' },
              { lat: (vehicle?.homeLat ?? -1.3031) + (mismatch ? 0.24 : 0.004), lng: (vehicle?.homeLng ?? 36.8526) + (mismatch ? 0.31 : 0.005), color: '#06B6D4', label: vehicle?.plate, kind: 'truck', ring: true },
            ]}
            lines={mismatch ? [{
              pts: [
                { lat: log.lat, lng: log.lng },
                { lat: (vehicle?.homeLat ?? -1.3031) + 0.24, lng: (vehicle?.homeLng ?? 36.8526) + 0.31 },
              ], color: '#DC2626', dashed: true, width: 2.5,
            }] : []} />
        </div>

        {/* computed checks */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Computed checks</div>
          <div className="flex flex-col gap-1.5">
            <CheckRow ok={tankOk}
              label={`Tank capacity — ${log.litres.toFixed(0)} L vs ${vehicle?.tankCapacityL ?? '—'} L tank`}
              detail={tankOk ? 'within capacity' : 'EXCEEDS'} />
            <CheckRow ok={!(avg != null && kmpl != null && kmpl < avg * 0.85)}
              label={`Consumption — ${kmpl != null ? kmpl.toFixed(1) : '—'} km/L vs rolling avg ${avg != null ? avg.toFixed(1) : '—'}`}
              detail={avg != null && kmpl != null ? `${kmpl >= avg ? '+' : ''}${Math.round((kmpl / avg - 1) * 100)}%` : 'insufficient data'} />
            <CheckRow ok={!mismatch}
              label={mismatch ? `GPS distance — fill logged ${gpsKm} km from vehicle position` : 'GPS distance — fill within 5 km of vehicle position'}
              detail={mismatch ? 'MISMATCH' : 'OK'} />
          </div>
        </div>

        {review && (
          <div className={cn('rounded-lg px-3 py-2 text-[13px]',
            review.status === 'fraud' ? 'bg-alert-soft text-alert-on-soft' : 'bg-ok-soft text-ok-on-soft')}>
            {review.status === 'fraud' ? 'Confirmed as fraud' : 'Reviewed — legitimate'}
            {review.reason && <> · “{review.reason}”</>} · {review.by} · <span className="font-mono text-[11px]">{fmtDateTimeEAT(review.at)}</span>
          </div>
        )}
      </div>

      {/* mark reviewed modal (reason required) */}
      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="Mark reviewed — legitimate"
        footer={<>
          <Btn variant="ghost" onClick={() => setReviewOpen(false)}>Cancel</Btn>
          <Btn variant="ok" icon={Check} disabled={!reason.trim()} onClick={() => { markReviewed(); setReviewOpen(false); }}>Mark reviewed</Btn>
        </>}>
        <label className="flex flex-col gap-1.5 text-[13px] text-ink-600">
          Reason (required)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="e.g. Driver topped up a jerrycan for the yard generator — receipt attached"
            className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </label>
      </Modal>

      {/* confirm fraud modal */}
      <Modal open={fraudOpen} onClose={() => setFraudOpen(false)} title="Confirm fuel fraud"
        footer={<>
          <Btn variant="ghost" onClick={() => setFraudOpen(false)}>Cancel</Btn>
          <Btn variant="danger" icon={ShieldAlert} onClick={() => { confirmFraud(); setFraudOpen(false); }}>Confirm fraud</Btn>
        </>}>
        <p className="text-[13px] leading-5 text-ink-600">
          This marks the fill-up as fraudulent, raises a critical fuel-anomaly alert and writes an audit entry.
          Flagged: <span className="font-mono text-[12px] font-semibold text-alert">{flags.map((f) => f.label).join(' · ') || 'manual review'}</span>
        </p>
      </Modal>
    </Drawer>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]',
      ok ? 'border-border bg-white' : 'border-alert/30 bg-alert-soft/50')}>
      <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-white', ok ? 'bg-ok' : 'bg-alert')}>
        {ok ? <Check size={12} /> : <X size={12} />}
      </span>
      <span className="flex-1 text-ink-900">{label}</span>
      <span className={cn('font-mono text-[11px] font-semibold', ok ? 'text-ok-on-soft' : 'text-alert')}>{detail}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Log fill-up modal (with anomaly scan on save)                       */
/* ------------------------------------------------------------------ */

function LogFillModal({ open, edit, logs, vehicles, dieselPrice, petrolPrice, stations, onClose }: {
  open: boolean; edit?: FuelLog; logs: FuelLog[]; vehicles: Vehicle[];
  dieselPrice: number; petrolPrice: number; stations: string[]; onClose: () => void;
}) {
  const [vehicleId, setVehicleId] = useState('');
  const [station, setStation] = useState('');
  const [otherStation, setOtherStation] = useState('');
  const [litres, setLitres] = useState('');
  const [price, setPrice] = useState('');
  const [odo, setOdo] = useState('');
  const [receipt, setReceipt] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanStep, setScanStep] = useState(0);

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const lastOdo = useMemo(() => {
    if (!vehicleId) return null;
    const mine = logs.filter((l) => l.vehicleId === vehicleId && l.id !== edit?.id);
    return mine.length ? Math.max(...mine.map((l) => l.odometerKm)) : null;
  }, [logs, vehicleId, edit]);

  useEffect(() => {
    if (!open) return;
    setScanning(false); setScanStep(0);
    if (edit) {
      setVehicleId(edit.vehicleId);
      setStation(stations.includes(edit.station) ? edit.station : '__other');
      setOtherStation(stations.includes(edit.station) ? '' : edit.station);
      setLitres(String(edit.litres));
      setPrice(String(edit.pricePerLKes));
      setOdo(String(edit.odometerKm));
    } else {
      setVehicleId(''); setStation(''); setOtherStation(''); setLitres(''); setPrice(''); setOdo(''); setReceipt(false);
    }
  }, [open, edit, stations]);

  // auto price default by fuel type
  useEffect(() => {
    if (open && vehicle && !price) setPrice(String(vehicle.fuelType === 'diesel' ? dieselPrice : petrolPrice));
  }, [vehicle, open, price, dieselPrice, petrolPrice]);

  const total = (Number(litres) || 0) * (Number(price) || 0);
  const odoBad = lastOdo != null && Number(odo) < lastOdo;
  const valid = vehicleId && (station && (station !== '__other' || otherStation.trim())) &&
    Number(litres) > 0 && Number(price) > 0 && Number(odo) > 0 && !odoBad;

  const save = () => {
    if (!valid) return;
    setScanning(true); setScanStep(0);
    // 600ms scanning shimmer — checks tick sequentially 200ms apart
    [1, 2, 3].forEach((s) => setTimeout(() => setScanStep(s), s * 200));
    setTimeout(() => {
      const finalStation = station === '__other' ? otherStation.trim() : station;
      const veh = vehicles.find((v) => v.id === vehicleId);
      const anomaly: FuelLog['anomaly'] = veh && Number(litres) > veh.tankCapacityL ? 'volume_exceeds_tank' : 'none';
      if (edit) {
        update('fuelLogs', edit.id, {
          vehicleId, station: finalStation, litres: Number(litres), pricePerLKes: Number(price),
          totalKes: Math.round(total), odometerKm: Number(odo), anomaly,
        });
      } else {
        add('fuelLogs', {
          id: '', vehicleId, driverId: veh?.assignedDriverId ?? 'drv-01',
          station: finalStation, lat: veh?.homeLat ?? -1.3031, lng: veh?.homeLng ?? 36.8526,
          litres: Number(litres), pricePerLKes: Number(price), totalKes: Math.round(total),
          odometerKm: Number(odo), at: DEMO_NOW_ISO, anomaly,
        });
      }
      setScanning(false);
      if (veh && Number(litres) > veh.tankCapacityL) {
        toast({ title: 'Logged — flagged', body: `Volume exceeds tank capacity (${Number(litres).toFixed(0)} L > ${veh.tankCapacityL} L)`, status: 'alert' });
      } else {
        toast({ title: edit ? 'Fill-up updated' : 'Logged — all checks passed', status: 'ok' });
      }
      onClose();
    }, 700);
  };

  const inputCls = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';

  return (
    <Modal open={open} onClose={onClose} title={edit ? 'Edit fill-up' : 'Log fill-up'} wide
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn icon={Fuel} disabled={!valid || scanning} onClick={save}>{scanning ? 'Checking…' : edit ? 'Save changes' : 'Save fill-up'}</Btn>
      </>}>
      <div className="relative flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Vehicle
            <select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setPrice(''); }} className={inputCls}>
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Driver (auto)
            <div className="flex h-9 items-center rounded-lg bg-surface-muted px-3 text-[13px] text-ink-600">
              {vehicle ? `Assigned driver · tank ${vehicle.tankCapacityL} L` : '—'}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Station
            <select value={station} onChange={(e) => setStation(e.target.value)} className={inputCls}>
              <option value="">Select station…</option>
              {stations.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value="__other">Other (free text)…</option>
            </select>
          </label>
          {station === '__other' && (
            <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
              Other station
              <input value={otherStation} onChange={(e) => setOtherStation(e.target.value)} placeholder="e.g. TotalEnergies Salamaa, A109" className={inputCls} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Litres
            <input value={litres} onChange={(e) => setLitres(e.target.value)} type="number" min="0" step="0.01" placeholder="60.00" className={cn(inputCls, 'font-mono')} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Price / L (KES)
            <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" step="0.01" placeholder={String(dieselPrice)} className={cn(inputCls, 'font-mono')} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Odometer (km) {lastOdo != null && <span className="font-mono text-ink-400/80">last {fmtNum(lastOdo)}</span>}
            <input value={odo} onChange={(e) => setOdo(e.target.value)} type="number" min="0" placeholder={lastOdo != null ? String(lastOdo + 480) : ''}
              className={cn(inputCls, 'font-mono', odoBad && 'border-alert focus:border-alert focus:ring-alert/30')} />
            {odoBad && <span className="text-[11px] font-medium text-alert">Must be ≥ last validated odometer ({fmtNum(lastOdo!)} km)</span>}
          </label>
          <div className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
            Date / time (EAT)
            <div className="flex h-9 items-center rounded-lg bg-surface-muted px-3 font-mono text-[12px] text-ink-600">{fmtDateTimeEAT(DEMO_NOW_ISO)} (now)</div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-navy-900 px-4 py-3">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-navy-100">Total</span>
          <motion.span key={Math.round(total)} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
            className="font-mono text-[22px] font-bold text-accent-on-navy tabular-nums">{fmtKES(total)}</motion.span>
        </div>

        <button type="button" onClick={() => setReceipt(!receipt)}
          className={cn('flex items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-[13px] transition-colors',
            receipt ? 'border-ok bg-ok-soft/50 text-ok-on-soft' : 'border-border text-ink-400 hover:border-ink-400/60')}>
          <Camera size={15} /> {receipt ? 'Receipt photo attached' : 'Attach receipt photo (optional)'}
        </button>

        {/* anomaly scan shimmer */}
        <AnimatePresence>
          {scanning && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-white/92 backdrop-blur-[1px]">
              <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Running anomaly checks…</div>
              {['Tank capacity', 'Consumption vs rolling avg', 'GPS position'].map((c, i) => (
                <motion.div key={c} initial={{ opacity: 0.3 }} animate={{ opacity: scanStep > i ? 1 : 0.3 }}
                  className="flex items-center gap-2 text-[13px] text-ink-900">
                  <span className={cn('flex h-4.5 w-4.5 h-[18px] w-[18px] items-center justify-center rounded-full',
                    scanStep > i ? 'bg-ok text-white' : 'bg-surface-muted text-ink-400')}>
                    {scanStep > i && <Check size={11} />}
                  </span>
                  {c}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Bulk upload wizard (Excel) — fuel preset                            */
/* ------------------------------------------------------------------ */

const FUEL_TARGETS = [
  { key: 'date', label: 'Date', required: true },
  { key: 'plate', label: 'Plate', required: true },
  { key: 'driver', label: 'Driver' },
  { key: 'station', label: 'Station', required: true },
  { key: 'litres', label: 'Litres', required: true },
  { key: 'priceperl', label: 'PricePerL', required: true },
  { key: 'odometer', label: 'Odometer', required: true },
];

function autoMap(cols: string[]): ColumnMapping[] {
  return cols.map((c) => {
    const norm = c.toLowerCase().replace(/[^a-z]/g, '');
    const t = FUEL_TARGETS.find((tg) => tg.key === norm || norm.includes(tg.key) || tg.label.toLowerCase() === norm);
    return { source: c, target: t?.key ?? null, confidence: t ? 0.96 : 0.2 };
  });
}

interface RowResult {
  n: number;
  status: 'valid' | 'warning' | 'error';
  issues: string[];
  record?: Omit<FuelLog, 'id'>;
}

function UploadWizard({ open, logs, vehicles, stations, onClose }: {
  open: boolean; logs: FuelLog[]; vehicles: Vehicle[]; stations: string[]; onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [imported, setImported] = useState<{ count: number; flagged: number } | null>(null);

  useEffect(() => {
    if (open) { setStep(0); setFileName(''); setRows([]); setMappings([]); setResults([]); setImported(null); }
  }, [open]);

  const onFiles = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const data = await readSheetRows(f);
      if (!data.length) { toast({ title: 'No rows found in file', status: 'warn' }); return; }
      setFileName(f.name);
      setRows(data);
      setMappings(autoMap(Object.keys(data[0])));
      setStep(1);
    } catch {
      toast({ title: 'Could not parse file', body: 'Use the .xlsx template format.', status: 'alert' });
    }
  };

  const validate = () => {
    const col = (r: Record<string, unknown>, key: string) => {
      const m = mappings.find((mm) => mm.target === key);
      return m ? r[m.source] : undefined;
    };
    const byPlate = new Map(vehicles.map((v) => [v.plate.toUpperCase().replace(/\s/g, ''), v]));
    const res: RowResult[] = rows.map((r, i) => {
      const issues: string[] = [];
      let status: RowResult['status'] = 'valid';
      const plateRaw = String(col(r, 'plate') ?? '').toUpperCase().replace(/\s/g, '');
      const veh = byPlate.get(plateRaw);
      const litres = Number(col(r, 'litres'));
      const price = Number(col(r, 'priceperl'));
      const odo = Number(col(r, 'odometer'));
      const station = String(col(r, 'station') ?? '').trim();
      const dateRaw = col(r, 'date');
      if (!veh) { issues.push('plate not found'); status = 'error'; }
      if (!litres || litres <= 0) { issues.push('invalid litres'); status = 'error'; }
      if (!price || price <= 0) { issues.push('invalid price/L'); status = 'error'; }
      if (!odo || odo <= 0) { issues.push('invalid odometer'); status = 'error'; }
      if (veh && litres > veh.tankCapacityL * 1.1) { issues.push(`litres > tank×1.1 (${veh.tankCapacityL} L)`); status = 'error'; }
      if (veh) {
        const prevMax = Math.max(0, ...logs.filter((l) => l.vehicleId === veh.id).map((l) => l.odometerKm));
        if (odo && odo < prevMax) { issues.push(`odo < previous (${odo} < ${prevMax})`); if (status !== 'error') status = 'error'; }
      }
      if (station && !stations.includes(station)) { issues.push('unknown station — will create'); if (status === 'valid') status = 'warning'; }
      let at = DEMO_NOW_ISO;
      if (dateRaw) {
        const d = new Date(String(dateRaw));
        if (!Number.isNaN(d.getTime())) at = d.toISOString();
        else { issues.push('invalid date'); status = 'error'; }
      }
      const record: Omit<FuelLog, 'id'> | undefined = status !== 'error' && veh ? {
        vehicleId: veh.id, driverId: veh.assignedDriverId ?? 'drv-01',
        station: station || 'Unspecified', lat: veh.homeLat, lng: veh.homeLng,
        litres, pricePerLKes: price, totalKes: Math.round(litres * price), odometerKm: odo, at,
        anomaly: litres > veh.tankCapacityL ? 'volume_exceeds_tank' : 'none',
      } : undefined;
      return { n: i + 2, status, issues, record };
    });
    setResults(res);
    setStep(2);
  };

  const doImport = () => {
    const ok = results.filter((r) => r.record);
    ok.forEach((r) => add('fuelLogs', { id: '', ...r.record! }));
    const merged = [...logs, ...ok.map((r) => ({ id: `new-${r.n}`, ...r.record! } as FuelLog))];
    const vehById = new Map(vehicles.map((v) => [v.id, v]));
    const flagged = ok.filter((r) => evaluateFuelLog({ id: `new-${r.n}`, ...r.record! } as FuelLog, vehById.get(r.record!.vehicleId), merged).length > 0).length;
    setImported({ count: ok.length, flagged });
    add('audit', {
      id: '', at: DEMO_NOW_ISO, userId: 'usr-01', userName: 'Admin User', action: 'import',
      collection: 'fuelLogs', recordId: 'bulk', summary: `Bulk-uploaded ${ok.length} fuel logs from ${fileName}`,
    });
    setStep(3);
  };

  const validCount = results.filter((r) => r.status !== 'error').length;

  const downloadTemplate = () => {
    downloadSheet([{
      Date: '2026-07-27 08:30', Plate: 'KDJ 123A', Driver: 'David Mwangi',
      Station: 'Total Energies Mombasa Rd', Litres: 60, PricePerL: 189.5, Odometer: 128402,
    }], 'fuel-template.xlsx', 'Fuel');
  };

  const downloadErrors = () => {
    downloadSheet(results.filter((r) => r.status === 'error').map((r) => ({ Row: r.n, Issues: r.issues.join('; ') })),
      'fuel-upload-errors.xlsx', 'Errors');
  };

  const STEPS = ['Drop file', 'Map columns', 'Validate', 'Done'];

  return (
    <Modal open={open} onClose={onClose} wide
      title={<span className="flex items-center gap-2"><FileSpreadsheet size={16} className="text-accent-strong" /> Bulk upload — fuel log</span>}>
      {/* stepper */}
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] font-semibold',
              i < step ? 'bg-ok text-white' : i === step ? 'bg-accent text-navy-950' : 'bg-surface-muted text-ink-400')}>
              {i < step ? <Check size={12} /> : i + 1}
            </span>
            <span className={cn('text-[12px] font-medium', i === step ? 'text-ink-900' : 'text-ink-400')}>{s}</span>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }}
          transition={{ duration: 0.26, ease: EASE }}>
          {step === 0 && (
            <div className="flex flex-col gap-3">
              <FileDropzone onFiles={onFiles} />
              <button type="button" onClick={downloadTemplate}
                className="self-start text-[12px] font-medium text-accent-strong underline underline-offset-2">
                Download fuel template (.xlsx) — Date, Plate, Driver, Station, Litres, PricePerL, Odometer
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <div className="text-[13px] text-ink-600">
                <span className="font-mono text-[12px]">{fileName}</span> — {rows.length} rows. Auto-matched columns:
              </div>
              <ColumnMapper mappings={mappings} targets={FUEL_TARGETS} onChange={setMappings} />
              <div className="flex justify-end gap-2 pt-1">
                <Btn variant="ghost" onClick={() => setStep(0)}>Back</Btn>
                <Btn onClick={validate} disabled={!FUEL_TARGETS.filter((t) => t.required).every((t) => mappings.some((m) => m.target === t.key))}>
                  Validate rows
                </Btn>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-3">
              <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="sticky top-0 border-b border-border bg-surface-muted/70 text-left text-[12px] uppercase tracking-[0.06em] text-ink-400">
                      <th className="h-8 px-3">Row</th><th className="h-8 px-3">Result</th><th className="h-8 px-3">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <motion.tr key={r.n} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02, duration: 0.2 }} className="border-b border-border/60">
                        <td className="h-9 px-3 font-mono text-[12px]">{r.n}</td>
                        <td className="h-9 px-3">
                          {r.status === 'valid' && <span className="flex items-center gap-1 text-ok-on-soft"><Check size={14} /> valid</span>}
                          {r.status === 'warning' && <StatusPill status="warn" label="warning" />}
                          {r.status === 'error' && <StatusPill status="alert" label="error" />}
                        </td>
                        <td className="h-9 px-3 text-ink-600">{r.issues.join(' · ') || '—'}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={downloadErrors} className="text-[12px] font-medium text-accent-strong underline underline-offset-2">
                  Download error report
                </button>
                <div className="flex gap-2">
                  <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
                  <Btn onClick={doImport} disabled={validCount === 0}>Import {validCount} of {results.length} rows</Btn>
                </div>
              </div>
            </div>
          )}

          {step === 3 && imported && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-ok-soft text-ok-on-soft">
                <Check size={26} />
              </motion.span>
              <div className="text-[18px] font-bold text-ink-900">{imported.count} fill-ups imported</div>
              <div className="text-[13px] text-ink-600">
                Anomaly re-check complete —{' '}
                <span className={cn('font-semibold', imported.flagged ? 'text-alert' : 'text-ok-on-soft')}>
                  {imported.flagged} imported row{imported.flagged === 1 ? '' : 's'} flagged
                </span>
              </div>
              <Btn onClick={onClose} className="mt-2">Close</Btn>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
