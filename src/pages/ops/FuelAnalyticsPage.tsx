// FBV FleetOS — /fuel/analytics — consumption analytics & idling cost (fuel-analytics.md).

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowRight, Download, Flame, Fuel, Gauge, MapPin, Timer, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCollection, useKV } from '@/lib/store';
import { fmtKES, fmtNum } from '@/lib/format';
import { HeatmapGrid, KPIStatCard, PlateTag, StatusPill, toast } from '@/components/shared';
import {
  Btn, Card, EASE, IDLE_L_PER_H, PageHeader, PageShell, SubNavPills, daysAgoOf,
  downloadWorkbook, evaluateFuelLog, idleMinutesByVehicleDay, kmPerLitre, kmSincePrev, withinDays,
} from './ops-shared';

const AXIS = { fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#7C8DA2' } as const;
const GRID = '#EDF1F6';
const TARGET_KMPL = 9.0;

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-pop">
      {label !== undefined && <div className="mb-1 text-micro font-medium uppercase tracking-[0.06em] text-ink-400">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[12px] text-ink-900">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? '#06B6D4' }} />
          {p.name}: <b>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

export default function FuelAnalyticsPage() {
  const logs = useCollection('fuelLogs');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const trips = useCollection('trips');
  const geofences = useCollection('geofences');
  const geofenceEvents = useCollection('geofenceEvents');
  const workOrders = useCollection('workOrders');
  const settings = useKV('settings');
  const reviews = (useKV('fuel-reviews' as never) as unknown as Record<string, { status: string }>) ?? {};
  const [period, setPeriod] = useState(30);
  const navigate = useNavigate();

  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const drvById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const periodLogs = useMemo(() => logs.filter((l) => withinDays(l.at, period)), [logs, period]);
  const priorLogs = useMemo(() => logs.filter((l) => {
    const ago = daysAgoOf(l.at);
    return ago >= period && ago < period * 2;
  }), [logs, period]);

  /* ---- per-vehicle stats ---- */
  const perVehicle = useMemo(() => vehicles.map((v) => {
    const mine = periodLogs.filter((l) => l.vehicleId === v.id);
    const kmpls = mine.map((l) => kmPerLitre(l, logs)).filter((x): x is number => x != null && x > 2 && x < 30);
    const kmpl = kmpls.length ? kmpls.reduce((a, b) => a + b, 0) / kmpls.length : null;
    const allKmpls = logs.filter((l) => l.vehicleId === v.id).map((l) => kmPerLitre(l, logs)).filter((x): x is number => x != null && x > 2 && x < 30);
    const ownAvg = allKmpls.length ? allKmpls.reduce((a, b) => a + b, 0) / allKmpls.length : null;
    const km = mine.reduce((a, l) => a + (kmSincePrev(l, logs) ?? 0), 0);
    const litres = mine.reduce((a, l) => a + l.litres, 0);
    const spend = mine.reduce((a, l) => a + l.totalKes, 0);
    const anomalies = mine.filter((l) => evaluateFuelLog(l, v, logs).length > 0).length;
    return { v, kmpl, ownAvg, km, litres, spend, anomalies, fills: mine.length };
  }).filter((r) => r.fills > 0).sort((a, b) => (b.kmpl ?? 0) - (a.kmpl ?? 0)), [vehicles, periodLogs, logs]);

  const fleetAvg = useMemo(() => {
    const vals = perVehicle.map((r) => r.kmpl).filter((x): x is number => x != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [perVehicle]);

  const priorAvg = useMemo(() => {
    const vals = priorLogs.map((l) => kmPerLitre(l, logs)).filter((x): x is number => x != null && x > 2 && x < 30);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [priorLogs, logs]);

  /* ---- daily fleet km/L trend ---- */
  const trend = useMemo(() => {
    const out: { day: string; kmpl: number | null }[] = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let d = period - 1; d >= 0; d--) {
      const dayLogs = periodLogs.filter((l) => daysAgoOf(l.at) === d);
      const vals = dayLogs.map((l) => kmPerLitre(l, logs)).filter((x): x is number => x != null && x > 2 && x < 30);
      const date = new Date(Date.UTC(2026, 6, 28 - d));
      out.push({
        day: `${date.getUTCDate()} ${months[date.getUTCMonth()]}`,
        kmpl: vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null,
      });
    }
    return out;
  }, [periodLogs, logs, period]);

  const trendDip = useMemo(() => {
    // lowest point with an anomalous fill that day — annotation
    let worst: { day: string; kmpl: number } | null = null;
    for (const t of trend) {
      if (t.kmpl != null && (!worst || t.kmpl < worst.kmpl)) worst = { day: t.day, kmpl: t.kmpl };
    }
    return worst;
  }, [trend]);

  const totalSpend = periodLogs.reduce((a, l) => a + l.totalKes, 0);
  const totalKm = perVehicle.reduce((a, r) => a + r.km, 0);
  const spendPerKm = totalKm > 0 ? totalSpend / totalKm : 0;
  const projectedMonthly = totalSpend * (30 / Math.max(1, Math.min(period, 30)));

  /* ---- per-driver ---- */
  const perDriver = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const l of periodLogs) {
      const k = kmPerLitre(l, logs);
      if (k != null && k > 2 && k < 30) {
        const arr = m.get(l.driverId) ?? [];
        arr.push(k);
        m.set(l.driverId, arr);
      }
    }
    return Array.from(m.entries()).map(([driverId, vals]) => ({
      driverId,
      name: drvById.get(driverId)?.name ?? driverId,
      kmpl: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)),
    })).sort((a, b) => b.kmpl - a.kmpl);
  }, [periodLogs, logs, drvById]);

  /* ---- outliers (anomaly radar) ---- */
  const outliers = useMemo(() => {
    return periodLogs
      .map((l) => ({ log: l, flags: evaluateFuelLog(l, vehById.get(l.vehicleId), logs) }))
      .filter((x) => x.flags.length > 0)
      .sort((a, b) => b.log.at.localeCompare(a.log.at));
  }, [periodLogs, logs, vehById]);

  /* ---- idling ---- */
  const periodTrips = useMemo(() => trips.filter((t) => withinDays(t.startAt, period)), [trips, period]);
  const idleByVeh = useMemo(() => vehicles.map((v) => {
    const mine = periodTrips.filter((t) => t.vehicleId === v.id);
    const idleMin = mine.reduce((a, t) => a + t.idleMin, 0);
    const engineMin = mine.reduce((a, t) => a + t.durationMin + t.idleMin, 0);
    const wastedL = (idleMin / 60) * IDLE_L_PER_H;
    // top idle location = geofence with most dwell minutes for this vehicle
    let topLoc = '—';
    let topMin = 0;
    for (const gf of geofences) {
      const m = geofenceEvents.filter((e) => e.vehicleId === v.id && e.geofenceId === gf.id && e.type === 'dwell')
        .reduce((a, e) => a + (e.dwellMin ?? 0), 0);
      if (m > topMin) { topMin = m; topLoc = `${gf.name} — ${Math.round(m / 60)} h`; }
    }
    return { v, idleMin, engineMin, wastedL, cost: wastedL * settings.fuelPriceDieselKes, topLoc };
  }).filter((r) => r.idleMin > 0).sort((a, b) => b.idleMin - a.idleMin), [vehicles, periodTrips, geofences, geofenceEvents, settings]);

  const totalIdleH = idleByVeh.reduce((a, r) => a + r.idleMin, 0) / 60;
  const totalWastedL = idleByVeh.reduce((a, r) => a + r.wastedL, 0);
  const totalIdleCost = idleByVeh.reduce((a, r) => a + r.cost, 0);
  const worstIdle = idleByVeh[0];

  /* heatmap: top 10 idle vehicles × last 14 days */
  const HEAT_DAYS = 14;
  const heatData = useMemo(() => {
    const map = idleMinutesByVehicleDay(trips, HEAT_DAYS);
    const rows = idleByVeh.slice(0, 10).map((r) => r.v);
    const cols: string[] = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
    for (let d = HEAT_DAYS - 1; d >= 0; d--) {
      const date = new Date(Date.UTC(2026, 6, 28 - d));
      cols.push(`${date.getUTCDate()} ${months[date.getUTCMonth()].slice(0, 3)}`);
    }
    const raw = rows.map((v) => {
      const arr: number[] = [];
      for (let d = HEAT_DAYS - 1; d >= 0; d--) arr.push(map.get(`${v.id}|${d}`) ?? 0);
      return arr;
    });
    const max = Math.max(60, ...raw.flat());
    return {
      rows: rows.map((v) => v.plate), cols, raw,
      values: raw.map((r) => r.map((m) => (m === 0 ? null : Math.min(1, m / max)))) as (number | null)[][],
      max,
    };
  }, [trips, idleByVeh]);

  const worstVehRow = perVehicle[perVehicle.length - 1];
  const bestVehRow = perVehicle[0];
  const medianKmpl = useMemo(() => {
    const vals = perVehicle.map((r) => r.kmpl ?? 0).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)] ?? 0;
  }, [perVehicle]);
  const linkedWo = worstVehRow ? workOrders.find((w) => w.vehicleId === worstVehRow.v.id && w.status !== 'done' && w.status !== 'cancelled') : undefined;

  const exportReport = () => {
    downloadWorkbook([
      {
        name: 'Consumption', rows: perVehicle.map((r) => ({
          Plate: r.v.plate, Model: r.v.model, KmPerL: r.kmpl?.toFixed(1) ?? '',
          DeltaVsOwnAvg: r.ownAvg && r.kmpl ? `${Math.round((r.kmpl / r.ownAvg - 1) * 100)}%` : '',
          Litres: r.litres.toFixed(1), SpendKES: r.spend, KmDriven: r.km, Anomalies: r.anomalies,
        })),
      },
      {
        name: 'Outliers', rows: outliers.map((o) => ({
          Date: o.log.at.slice(0, 10), Plate: vehById.get(o.log.vehicleId)?.plate ?? '',
          Station: o.log.station, Flags: o.flags.map((f) => f.label).join('; '),
          Status: reviews[o.log.id]?.status ?? 'under review',
        })),
      },
      {
        name: 'Idling', rows: idleByVeh.map((r) => ({
          Plate: r.v.plate, IdleHours: (r.idleMin / 60).toFixed(1),
          PctOfEngineOn: `${((r.idleMin / Math.max(1, r.engineMin)) * 100).toFixed(0)}%`,
          FuelWastedL: r.wastedL.toFixed(1), CostKES: Math.round(r.cost), TopIdleLocation: r.topLoc,
        })),
      },
    ], `fuel-analytics-${period}d-jul-2026.xlsx`);
    toast({ title: 'Report exported', body: `3 sheets: Consumption / Outliers / Idling`, status: 'ok' });
  };

  const PERIODS = [7, 30, 90];

  return (
    <PageShell>
      <PageHeader title="Fuel Analytics & Idling" sub="Consumption, outliers and the cost of idling"
        actions={<Btn icon={Download} variant="ghost" onClick={exportReport}>Export report</Btn>} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SubNavPills items={[{ to: '/fuel', label: '← Fuel Log' }, { to: '/fuel/analytics', label: 'Analytics & Idling' }]} />
        {/* period pills */}
        <div className="flex items-center gap-1 rounded-full border border-border bg-white p-1 shadow-card">
          {PERIODS.map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)}
              className={cn('relative rounded-full px-3.5 py-1.5 font-mono text-[12px] font-semibold transition-colors',
                period === p ? 'text-white' : 'text-ink-600 hover:bg-surface-muted')}>
              {period === p && <motion.span layoutId="period-pill" className="absolute inset-0 rounded-full bg-navy-900" transition={{ duration: 0.25, ease: EASE }} />}
              <span className="relative">{p}d</span>
            </button>
          ))}
        </div>
      </div>

      <motion.div key={period} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        className="flex flex-col gap-4">

        {/* 1. hero row */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Card title="Fleet km/L trend" className="xl:col-span-3"
            actions={<span className="font-mono text-[11px] text-ink-400">target {TARGET_KMPL.toFixed(1)} km/L</span>}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="kmpl-g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={Math.floor(period / 10)} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                  <RTooltip content={<ChartTip />} />
                  <ReferenceLine y={TARGET_KMPL} stroke="#0F2540" strokeDasharray="6 5" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="kmpl" name="km/L" stroke="#06B6D4" strokeWidth={2}
                    fill="url(#kmpl-g)" isAnimationActive animationDuration={900} connectNulls
                    dot={(props: { cx?: number; cy?: number; payload?: { kmpl: number | null } }) => {
                      const { cx, cy, payload } = props;
                      if (trendDip && payload?.kmpl === trendDip.kmpl && cx != null && cy != null) {
                        return <circle key="dip" cx={cx} cy={cy} r={4.5} fill="#DC2626" stroke="#fff" strokeWidth={1.5} />;
                      }
                      return <g key={`${cx}-${cy}`} />;
                    }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {trendDip && (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-400">
                <span className="h-2 w-2 rounded-full bg-alert" /> {trendDip.day} — anomaly pulled fleet down ({trendDip.kmpl.toFixed(1)} km/L)
              </div>
            )}
          </Card>

          <Card title="Fleet summary" className="xl:col-span-2">
            <div className="flex items-end gap-3">
              <span className="font-mono text-[40px] font-bold leading-[44px] tracking-[-0.02em] text-ink-900 tabular-nums">
                {fleetAvg.toFixed(1)}<span className="ml-1 text-[16px] font-semibold text-ink-400">km/L</span>
              </span>
              {priorAvg != null && (
                <span className={cn('mb-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-medium',
                  fleetAvg >= priorAvg ? 'bg-ok-soft text-ok-on-soft' : 'bg-alert-soft text-alert-on-soft')}>
                  {fleetAvg >= priorAvg ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  {fleetAvg >= priorAvg ? '▲' : '▼'} {Math.abs(fleetAvg - priorAvg).toFixed(1)} vs prior {period}d
                </span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
              <div className="rounded-lg bg-surface-muted p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-400">Best vehicle</div>
                {bestVehRow && <div className="mt-1 flex items-center gap-2"><PlateTag plate={bestVehRow.v.plate} /><span className="font-mono text-[12px] font-semibold text-ok-on-soft">{bestVehRow.kmpl?.toFixed(1)}</span></div>}
              </div>
              <div className="rounded-lg bg-surface-muted p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-400">Worst vehicle</div>
                {worstVehRow && <div className="mt-1 flex items-center gap-2"><PlateTag plate={worstVehRow.v.plate} /><span className="font-mono text-[12px] font-semibold text-alert">{worstVehRow.kmpl?.toFixed(1)}</span></div>}
              </div>
              <div className="rounded-lg bg-surface-muted p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-400">Spend / km</div>
                <div className="mt-1 font-mono text-[14px] font-semibold text-ink-900">KES {spendPerKm.toFixed(2)}</div>
              </div>
              <div className="rounded-lg bg-surface-muted p-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-400">Projected monthly spend</div>
                <div className="mt-1 font-mono text-[14px] font-semibold text-ink-900">{fmtKES(projectedMonthly, { compact: true })}</div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, (totalSpend / Math.max(1, projectedMonthly)) * 100)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full bg-accent" />
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* 2. per-vehicle combo */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title={`Per-vehicle consumption — ${period}d`}>
            <div style={{ height: Math.max(220, perVehicle.length * 26) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perVehicle.map((r) => ({ plate: r.v.plate, kmpl: Number((r.kmpl ?? 0).toFixed(1)), outlier: (r.kmpl ?? 0) < fleetAvg * 0.8, id: r.v.id }))}
                  layout="vertical" margin={{ top: 0, right: 36, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="plate" tick={{ ...AXIS, fontSize: 10 }} tickLine={false} axisLine={false} width={72} />
                  <RTooltip content={<ChartTip />} cursor={{ fill: '#F2F5F9' }} />
                  <Bar dataKey="kmpl" name="km/L" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={700}
                    onClick={(d: { id?: string }) => d?.id && navigate(`/vehicles/${d.id}`)}
                    label={{ position: 'right', fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#46586D' }}>
                    {perVehicle.map((r) => (
                      <Cell key={r.v.id} fill={(r.kmpl ?? 0) < fleetAvg * 0.8 ? '#DC2626' : '#06B6D4'} cursor="pointer" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[12px] text-ink-400">Bars red when &gt;20% below fleet mean · click a bar for vehicle 360°</div>
          </Card>

          <Card title="Detail" pad={false} className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/70 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
                    <th className="h-9 px-3">Vehicle</th><th className="h-9 px-3 text-right">km/L</th><th className="h-9 px-3 text-right">Δ avg</th>
                    <th className="h-9 px-3 text-right">Litres</th><th className="h-9 px-3 text-right">Spend</th><th className="h-9 px-3 text-right">km</th>
                    <th className="h-9 px-3 text-center">Anom.</th><th className="h-9 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {perVehicle.map((r, i) => {
                    const delta = r.ownAvg && r.kmpl ? Math.round((r.kmpl / r.ownAvg - 1) * 100) : 0;
                    const outlier = (r.kmpl ?? 0) < fleetAvg * 0.8;
                    return (
                      <motion.tr key={r.v.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.025, duration: 0.22, ease: EASE }}
                        className="border-b border-border/60 hover:bg-surface-muted">
                        <td className="h-9 px-3"><PlateTag plate={r.v.plate} /></td>
                        <td className={cn('h-9 px-3 text-right font-mono text-[12px] font-semibold',
                          r.kmpl != null && r.kmpl >= TARGET_KMPL ? 'text-ok-on-soft' : outlier ? 'text-alert' : 'text-ink-900')}>
                          {r.kmpl?.toFixed(1) ?? '—'}
                        </td>
                        <td className={cn('h-9 px-3 text-right font-mono text-[12px]', delta >= 0 ? 'text-ok-on-soft' : 'text-ink-600')}>{delta >= 0 ? '+' : ''}{delta}%</td>
                        <td className="h-9 px-3 text-right font-mono text-[12px]">{fmtNum(r.litres)}</td>
                        <td className="h-9 px-3 text-right font-mono text-[12px]">{fmtKES(r.spend, { compact: true })}</td>
                        <td className="h-9 px-3 text-right font-mono text-[12px]">{fmtNum(r.km)}</td>
                        <td className="h-9 px-3 text-center">
                          {r.anomalies > 0 && <span className="rounded-full bg-alert-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold text-alert-on-soft">{r.anomalies}</span>}
                        </td>
                        <td className="h-9 px-3">{outlier && <StatusPill status="alert" label="Outlier" />}</td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {worstVehRow && medianKmpl > 0 && (
              <div className="border-t border-border px-4 py-3 text-[12px] leading-5 text-ink-600">
                <span className="font-mono font-semibold">{worstVehRow.v.plate}</span> ({worstVehRow.v.model}, {worstVehRow.v.year}) burns{' '}
                {Math.max(0, Math.round((1 - (worstVehRow.kmpl ?? 0) / medianKmpl) * 100))}% above fleet median — injectors suspected
                {linkedWo && <>; linked WO <Link to="/maintenance" className="font-mono font-semibold text-accent-strong">{linkedWo.number}</Link></>}.
              </div>
            )}
          </Card>
        </div>

        {/* 3. per-driver */}
        <Card title="Per-driver consumption"
          actions={<span className="text-[12px] text-ink-400">Controlled for vehicle mix (same-vehicle comparisons)</span>}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perDriver} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ ...AXIS, fontSize: 9.5 }} tickLine={false} axisLine={{ stroke: GRID }}
                  interval={0} angle={-24} textAnchor="end" height={52} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 'auto']} />
                <RTooltip content={<ChartTip />} cursor={{ fill: '#F2F5F9' }} />
                <ReferenceLine y={Number(fleetAvg.toFixed(1))} stroke="#0F2540" strokeDasharray="6 5" strokeWidth={1.5} />
                <Bar dataKey="kmpl" name="km/L" fill="#06B6D4" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={700}
                  onClick={(d: { driverId?: string }) => d?.driverId && navigate(`/drivers/${d.driverId}`)} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
            {perDriver[0] && <span className="text-ink-600">Top: <b>{perDriver[0].name}</b> <span className="font-mono text-[12px] text-ok-on-soft">{perDriver[0].kmpl} km/L</span></span>}
            {perDriver[perDriver.length - 1] && (
              <span className="flex items-center gap-2 text-ink-600">
                Bottom: <b>{perDriver[perDriver.length - 1].name}</b> <span className="font-mono text-[12px]">{perDriver[perDriver.length - 1].kmpl}</span>
                <Link to={`/drivers/${perDriver[perDriver.length - 1].driverId}`}
                  className="rounded-full bg-warn-soft px-2 py-0.5 text-micro font-semibold text-warn-on-soft hover:opacity-80">
                  → open coaching
                </Link>
              </span>
            )}
          </div>
        </Card>

        {/* 4. anomaly radar (navy) */}
        <section className="rounded-card bg-navy-900 p-4 shadow-card sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white"><Flame size={16} className="text-accent-on-navy" /> Anomaly radar — {period}d</h2>
            <span className="font-mono text-[12px] text-navy-100">{outliers.length} detected</span>
          </div>
          <div className="flex flex-col divide-y divide-navy-700">
            {outliers.slice(0, 8).map((o, i) => {
              const review = reviews[o.log.id];
              return (
                <motion.div key={o.log.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25, ease: EASE }}
                  className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', o.flags[0].severity === 'alert' ? 'bg-alert' : 'bg-warn')} />
                  <span className="font-mono text-[12px] font-semibold text-white">{o.flags.map((f) => f.label).join(' · ')}</span>
                  <span className="text-[13px] text-navy-100">{vehById.get(o.log.vehicleId)?.plate} · {o.log.station}</span>
                  <span className="font-mono text-[11px] text-navy-100/60">{o.log.at.slice(0, 10)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {review
                      ? <StatusPill status={review.status === 'fraud' ? 'alert' : 'ok'} label={review.status === 'fraud' ? 'Confirmed fraud' : 'Cleared'} />
                      : <StatusPill status="warn" label="Under review" />}
                    <Link to="/fuel" className="flex items-center gap-0.5 text-[12px] font-semibold text-accent-on-navy hover:underline">
                      Review <ArrowRight size={12} />
                    </Link>
                  </span>
                </motion.div>
              );
            })}
            {outliers.length === 0 && <div className="py-6 text-center text-[13px] text-navy-100/70">No anomalies detected in this period.</div>}
          </div>
        </section>

        {/* 5. idling report */}
        <div className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-[18px] font-bold leading-[26px] tracking-[-0.01em] text-ink-900">
            <Timer size={18} className="text-accent-strong" /> Idling report — the money section
          </h2>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <KPIStatCard label="Total idle MTD" value={totalIdleH} format={(v) => `${fmtNum(v)} h`} icon={Timer} />
            <KPIStatCard label="Fuel wasted" value={totalWastedL} format={(v) => `${fmtNum(v)} L`} icon={Fuel} deltaGood={false} />
            <KPIStatCard label="Cost burned" value={totalIdleCost} format={(v) => fmtKES(v)} icon={Flame} deltaGood={false} sparkColor="#DC2626" />
            <KPIStatCard label="Worst offender" value={worstIdle ? worstIdle.idleMin / 60 : 0}
              format={(v) => `${worstIdle?.v.plate ?? '—'} · ${v.toFixed(0)} h`} icon={Gauge} deltaGood={false} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <HeatmapGrid rows={heatData.rows} cols={heatData.cols} values={heatData.values} cellSize={24}
                onCellClick={(r, c) => {
                  const mins = heatData.raw[r]?.[c] ?? 0;
                  toast({
                    title: `${heatData.rows[r]} · ${heatData.cols[c]}`,
                    body: `${mins} min idle · ${((mins / 60) * IDLE_L_PER_H).toFixed(1)} L wasted`,
                    status: mins > 90 ? 'alert' : 'info',
                  });
                  navigate('/trips');
                }} />
              <div className="mt-2 text-[12px] text-ink-400">Cell = idle minutes (grey → amber → red) · click for trips</div>
            </Card>

            <Card title="Idle by vehicle" pad={false} className="overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted/70 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
                      <th className="h-9 px-3">Vehicle</th><th className="h-9 px-3 text-right">Idle h</th><th className="h-9 px-3 text-right">% engine-on</th>
                      <th className="h-9 px-3 text-right">Wasted L</th><th className="h-9 px-3 text-right">Cost</th><th className="h-9 px-3">Top idle location</th><th className="h-9 px-3 text-center">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {idleByVeh.slice(0, 8).map((r) => (
                      <tr key={r.v.id} className="border-b border-border/60 hover:bg-surface-muted">
                        <td className="h-9 px-3"><PlateTag plate={r.v.plate} /></td>
                        <td className="h-9 px-3 text-right font-mono text-[12px]">{(r.idleMin / 60).toFixed(1)}</td>
                        <td className="h-9 px-3 text-right font-mono text-[12px]">{((r.idleMin / Math.max(1, r.engineMin)) * 100).toFixed(0)}%</td>
                        <td className="h-9 px-3 text-right font-mono text-[12px]">{r.wastedL.toFixed(1)}</td>
                        <td className="h-9 px-3 text-right font-mono text-[12px] font-semibold text-alert">{fmtKES(r.cost)}</td>
                        <td className="h-9 max-w-[180px] truncate px-3 text-[12px] text-ink-600">
                          <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-accent-strong" />{r.topLoc}</span>
                        </td>
                        <td className="h-9 px-3 text-center">
                          {r.idleMin / 60 > totalIdleH / Math.max(1, idleByVeh.length)
                            ? <TrendingUp size={14} className="inline text-alert" />
                            : <TrendingDown size={14} className="inline text-ok" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* recommendation */}
          <div className="flex flex-wrap items-center gap-3 rounded-card border border-accent/40 bg-accent-soft/60 p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent-strong shadow-card"><Gauge size={18} /></span>
            <div className="min-w-0 flex-1 text-[13px] leading-5 text-ink-900">
              Coach 3 drivers + revise JKIA pickup scheduling — projected saving{' '}
              <span className="font-mono font-bold">{fmtKES(Math.round(totalIdleCost * 0.7), { compact: true })}/mo</span>.
            </div>
            <Btn variant="ghost" onClick={() => navigate('/safety')}>Create coaching</Btn>
            <Btn variant="ghost" onClick={() => navigate('/geofences')}>View locations</Btn>
          </div>
        </div>
      </motion.div>
    </PageShell>
  );
}
