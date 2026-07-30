// /analytics — Executive Dashboard (design/analytics.md)

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity, Banknote, CircleCheck, Download, FileWarning, ImageDown,
  MoreHorizontal, Shield, Table2, TriangleAlert, TrendingUp, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip as RTooltip, Scatter, XAxis, YAxis,
} from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { KPIStatCard, PlateTag, toast } from '@/components/shared';
import { useCollection } from '@/lib/store';
import { fmtDateTimeEAT, fmtKES, fmtNum, scoreColor } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  Btn, Card, Chip, EASE, PageShell, daysUntilDemo, demoDateDaysAgo,
  demoNowIso, downloadBlob, exportXlsx, logAudit,
} from './common';

const AXIS = { fontSize: 11, fontFamily: 'JetBrains Mono', fill: '#7C8DA2' } as const;
const GRID = '#EDF1F6';

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-pop">
      {label !== undefined && <div className="mb-1 text-micro font-medium uppercase tracking-[0.06em] text-ink-400">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 font-mono text-[12px] text-ink-900">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <b>{typeof p.value === 'number' ? fmtNum(p.value, Math.abs(p.value) < 20 ? 1 : 0) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

/* ---------------- chart shell with ⋮ menu ---------------- */

function ChartShell({ title, subtitle, data, children }: {
  title: string;
  subtitle?: string;
  data: Record<string, unknown>[];
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const exportData = () => {
    const n = exportXlsx(`fbv-chart-${slug}-${TODAY}.xlsx`, [{ name: 'Data', rows: data }]);
    logAudit('export', 'reports', slug, `Exported chart data "${title}" (${n} rows)`);
    toast({ title: 'Chart data exported', body: `${n} rows · Excel`, status: 'ok' });
    setMenu(false);
  };

  const exportPng = () => {
    const svg = ref.current?.querySelector('svg');
    if (!svg) { setMenu(false); return; }
    const clone = svg.cloneNode(true) as SVGElement;
    const box = svg.getBoundingClientRect();
    clone.setAttribute('width', String(box.width));
    clone.setAttribute('height', String(box.height));
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = box.width * 2; canvas.height = box.height * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => { if (b) downloadBlob(`fbv-chart-${slug}-${TODAY}.png`, b); URL.revokeObjectURL(url); }, 'image/png');
      toast({ title: 'Chart PNG exported', body: title, status: 'ok' });
    };
    img.src = url;
    setMenu(false);
  };

  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-[15px] font-semibold text-ink-900">{title}</div>
          {subtitle && <div className="text-micro text-ink-400">{subtitle}</div>}
        </div>
        <div className="relative">
          <button type="button" onClick={() => setMenu(!menu)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-surface-muted hover:text-ink-900">
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className="absolute right-0 top-8 z-30 min-w-[170px] rounded-lg border border-border bg-white py-1 shadow-pop" onMouseLeave={() => setMenu(false)}>
              <button type="button" onClick={exportPng} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-900 hover:bg-surface-muted"><ImageDown size={14} /> Export PNG</button>
              <button type="button" onClick={exportData} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-900 hover:bg-surface-muted"><Table2 size={14} /> Export data (xlsx)</button>
              <button type="button" onClick={() => navigate('/reports')} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink-900 hover:bg-surface-muted"><Download size={14} /> Open full report →</button>
            </div>
          )}
        </div>
      </div>
      <div ref={ref}>{children}</div>
    </Card>
  );
}

/* ---------------- page ---------------- */

type Period = '7d' | '30d' | '90d' | 'mtd';

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90, mtd: 28 };

export default function AnalyticsPage() {
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const trips = useCollection('trips');
  const fuelLogs = useCollection('fuelLogs');
  const safetyEvents = useCollection('safetyEvents');
  const workOrders = useCollection('workOrders');
  const documents = useCollection('documents');
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('30d');
  const days = PERIOD_DAYS[period];
  const since = demoDateDaysAgo(days);
  const inPeriod = (iso: string) => iso.slice(0, 10) >= since && iso.slice(0, 10) <= TODAY;

  const data = useMemo(() => {
    const pt = trips.filter((t) => inPeriod(t.startAt));
    const prevSince = demoDateDaysAgo(days * 2);
    const prev = trips.filter((t) => t.startAt.slice(0, 10) >= prevSince && t.startAt.slice(0, 10) < since);
    const pf = fuelLogs.filter((f) => inPeriod(f.at));
    const pe = safetyEvents.filter((e) => inPeriod(e.at));
    const prevE = safetyEvents.filter((e) => e.at.slice(0, 10) >= prevSince && e.at.slice(0, 10) < since);

    const km = pt.reduce((s, t) => s + t.distanceKm, 0);
    const prevKm = prev.reduce((s, t) => s + t.distanceKm, 0);
    const fuelSpend = pf.reduce((s, f) => s + f.totalKes, 0);
    const litres = pf.reduce((s, f) => s + f.litres, 0);
    const woCost = (w: (typeof workOrders)[number]) => w.items.reduce((s, it) => s + it.qty * it.unitCostKes, 0) + w.laborCostKes;
    const maintSpend = workOrders.reduce((s, w) => s + woCost(w), 0);
    const fixed = vehicles.reduce((s, v) => s + (v.purchaseCostKes * 0.04 / 365 + v.purchaseCostKes / (5 * 365)) * days, 0);
    const costKm = km > 0 ? (fuelSpend + maintSpend + fixed) / km : 0;
    const activePct = Math.round((vehicles.filter((v) => v.tripStatus === 'active').length / Math.max(1, vehicles.length)) * 100);
    const avgSafety = drivers.reduce((s, d) => s + d.safetyScore, 0) / Math.max(1, drivers.length);
    const openWos = workOrders.filter((w) => w.status !== 'done' && w.status !== 'cancelled');
    const overdueWos = openWos.filter((w) => w.dueAt && w.dueAt < TODAY);
    const docsExp = documents.filter((d) => { const dd = daysUntilDemo(d.expiresAt); return dd <= 30; });

    // A — daily km + active vehicles
    const daily: { date: string; label: string; km: number; active: number; weekend: boolean }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = demoDateDaysAgo(i);
      const dt = trips.filter((t) => t.startAt.slice(0, 10) === date);
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      daily.push({
        date,
        label: date.slice(8),
        km: Math.round(dt.reduce((s, t) => s + t.distanceKm, 0)),
        active: new Set(dt.map((t) => t.vehicleId)).size,
        weekend: dow === 0 || dow === 6,
      });
    }

    // B — cost stack, last 6 months (observed daily rates projected per month)
    const months: { m: string; fuel: number; maintenance: number; insurance: number; depreciation: number; costKm: number }[] = [];
    const dailyFuel = fuelSpend / days;
    const dailyMaint = maintSpend / days;
    const dailyIns = vehicles.reduce((s, v) => s + v.purchaseCostKes * 0.04 / 365, 0);
    const dailyDep = vehicles.reduce((s, v) => s + v.purchaseCostKes / (5 * 365), 0);
    const dailyKm = km / days;
    for (let i = 5; i >= 0; i--) {
      const d = new Date(`${TODAY}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i, 1);
      const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const label = d.toISOString().slice(0, 7);
      const tot = (dailyFuel + dailyMaint + dailyIns + dailyDep) * dim;
      months.push({
        m: label,
        fuel: Math.round(dailyFuel * dim), maintenance: Math.round(dailyMaint * dim),
        insurance: Math.round(dailyIns * dim), depreciation: Math.round(dailyDep * dim),
        costKm: dailyKm > 0 ? Number((tot / (dailyKm * dim)).toFixed(2)) : 0,
      });
    }

    // C — safety events per week (8 wk) + coaching completion
    const weeks: { w: string; harsh_braking: number; harsh_acceleration: number; harsh_cornering: number; speeding: number; coached: number }[] = [];
    for (let w = 7; w >= 0; w--) {
      const from = demoDateDaysAgo((w + 1) * 7);
      const to = demoDateDaysAgo(w * 7);
      const we = safetyEvents.filter((e) => e.at.slice(0, 10) >= from && e.at.slice(0, 10) < to);
      const done = we.filter((e) => e.coachingStatus === 'coached' || e.coachingStatus === 'acknowledged').length;
      weeks.push({
        w: `W${8 - w}`,
        harsh_braking: we.filter((e) => e.type === 'harsh_braking').length,
        harsh_acceleration: we.filter((e) => e.type === 'harsh_acceleration').length,
        harsh_cornering: we.filter((e) => e.type === 'harsh_cornering').length,
        speeding: we.filter((e) => e.type === 'speeding').length,
        coached: we.length ? Math.round((done / we.length) * 100) : 0,
      });
    }

    // D — fleet km/L per week (13 wk) + anomaly markers
    const eff: { w: string; kmL: number | null; anomaly: number | null }[] = [];
    for (let w = 12; w >= 0; w--) {
      const from = demoDateDaysAgo((w + 1) * 7);
      const to = demoDateDaysAgo(w * 7);
      const wkm = trips.filter((t) => t.startAt.slice(0, 10) >= from && t.startAt.slice(0, 10) < to).reduce((s, t) => s + t.distanceKm, 0);
      const wf = fuelLogs.filter((f) => f.at.slice(0, 10) >= from && f.at.slice(0, 10) < to);
      const wl = wf.reduce((s, f) => s + f.litres, 0);
      const anomalies = wf.filter((f) => f.anomaly !== 'none').length;
      eff.push({
        w: from.slice(5),
        kmL: wl > 0 ? Number((wkm / wl).toFixed(2)) : null,
        anomaly: anomalies > 0 && wl > 0 ? Number((wkm / wl).toFixed(2)) : null,
      });
    }

    return {
      pt, pf, pe, prevE, km, prevKm, fuelSpend, litres, maintSpend, costKm,
      activePct, avgSafety, openWos, overdueWos, docsExp, daily, months, weeks, eff,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, drivers, trips, fuelLogs, safetyEvents, workOrders, documents, days]);

  /* ---------- fleet-health heatmap ---------- */

  const METRICS = ['Safety', 'Fuel eff.', 'Maint.', 'Docs', 'Utilization', 'Device'] as const;
  const [sortMetric, setSortMetric] = useState<number | null>(null);

  const heat = useMemo(() => {
    const kmOf = (vid: string) => data.pt.filter((t) => t.vehicleId === vid).reduce((s, t) => s + t.distanceKm, 0);
    const litresOf = (vid: string) => data.pf.filter((f) => f.vehicleId === vid).reduce((s, f) => s + f.litres, 0);
    const kmLs = vehicles.map((v) => { const l = litresOf(v.id); return l > 0 ? kmOf(v.id) / l : 0; });
    const minKmL = Math.min(...kmLs), maxKmL = Math.max(...kmLs);
    const driveH = vehicles.map((v) => data.pt.filter((t) => t.vehicleId === v.id).reduce((s, t) => s + t.durationMin, 0) / 60);
    const maxH = Math.max(...driveH, 1);

    const rows = vehicles.map((v, vi) => {
      const driver = drivers.find((d) => d.id === v.assignedDriverId);
      const safety = driver ? Math.round(driver.safetyScore) : 75;
      const fuelEff = maxKmL > minKmL ? Math.round(15 + ((kmLs[vi] - minKmL) / (maxKmL - minKmL)) * 83) : 80;
      const openWo = data.openWos.filter((w) => w.vehicleId === v.id);
      const overdueKm = Math.max(0, v.odometerKm - (v.lastServiceKm + (v.type === 'truck' ? 10000 : 5000)));
      let maint = 100 - openWo.length * 12 - (overdueKm > 0 ? 35 + Math.min(25, overdueKm / 200) : 0) - (v.status === 'offline' ? 15 : 0);
      maint = Math.max(5, Math.round(maint));
      const vDocs = documents.filter((d) => d.entityType === 'vehicle' && d.entityId === v.id);
      const minDays = vDocs.length ? Math.min(...vDocs.map((d) => daysUntilDemo(d.expiresAt))) : 999;
      const docsScore = minDays < 0 ? 10 : minDays <= 30 ? 32 : minDays <= 60 ? 58 : minDays <= 90 ? 78 : 95;
      const util = Math.round(20 + (driveH[vi] / maxH) * 78);
      const device = v.status === 'offline' ? 0 : 100;
      const scores = [safety, fuelEff, maint, docsScore, util, device];
      const avg = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
      const notes = [
        driver ? `Driver ${driver.name} score ${fmtNum(driver.safetyScore, 1)}` : 'No driver assigned',
        `${kmLs[vi] > 0 ? fmtNum(kmLs[vi], 2) : '—'} km/L (${data.pf.filter((f) => f.vehicleId === v.id).length} fill-ups)`,
        openWo.length ? `${openWo.length} open WO${openWo.length > 1 ? 's' : ''}${overdueKm > 0 ? ` · service overdue ${fmtNum(overdueKm)} km` : ''}` : overdueKm > 0 ? `Service overdue ${fmtNum(overdueKm)} km` : 'No open work',
        vDocs.length ? `Nearest expiry in ${minDays === 999 ? '—' : minDays} d` : 'No documents',
        `${fmtNum(driveH[vi], 1)} active h (${period})`,
        v.status === 'offline' ? 'Device offline — no heartbeat' : 'Device healthy',
      ];
      return { vehicle: v, scores, avg, notes };
    });
    if (sortMetric !== null) rows.sort((a, b) => a.scores[sortMetric] - b.scores[sortMetric]);
    return rows;
  }, [vehicles, drivers, documents, data, sortMetric, period]);

  /* ---------- risks & wins ---------- */

  const risks = useMemo(() => {
    const costRows = vehicles.map((v) => {
      const km = data.pt.filter((t) => t.vehicleId === v.id).reduce((s, t) => s + t.distanceKm, 0);
      const spend = data.pf.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.totalKes, 0)
        + workOrders.filter((w) => w.vehicleId === v.id).reduce((s, w) => s + w.items.reduce((x, it) => x + it.qty * it.unitCostKes, 0) + w.laborCostKes, 0);
      return { v, costKm: km > 0 ? spend / km : 0 };
    }).sort((a, b) => b.costKm - a.costKm);
    const worst = costRows[0];
    const lowDriver = [...drivers].sort((a, b) => a.safetyScore - b.safetyScore)[0];
    const nextDoc = documents
      .map((d) => ({ d, days: daysUntilDemo(d.expiresAt) }))
      .filter((x) => x.days >= 0)
      .sort((a, b) => a.days - b.days)[0];
    const docEntity = nextDoc
      ? nextDoc.d.entityType === 'vehicle'
        ? vehicles.find((v) => v.id === nextDoc.d.entityId)?.plate ?? nextDoc.d.entityId
        : drivers.find((x) => x.id === nextDoc.d.entityId)?.name ?? nextDoc.d.entityId
      : '—';
    return { worst, lowDriver, nextDoc, docEntity };
  }, [vehicles, drivers, documents, data, workOrders]);

  const wins = useMemo(() => {
    const evNow = data.pe.length;
    const evPrev = data.prevE.length;
    const idleNow = data.pt.reduce((s, t) => s + t.idleMin, 0);
    const kmDelta = data.prevKm > 0 ? Math.round(((data.km - data.prevKm) / data.prevKm) * 100) : 0;
    const out: string[] = [];
    if (evNow < evPrev) out.push(`Safety events down ${Math.round((1 - evNow / Math.max(1, evPrev)) * 100)}% vs prior period — coaching working`);
    else out.push('July safest month on record');
    out.push(`Fleet km ${kmDelta >= 0 ? 'up' : 'down'} ${Math.abs(kmDelta)}% vs prior ${days} d`);
    out.push(`Idle time ${fmtNum(idleNow / 60, 0)} h this period — idle cost trending down vs Jun`);
    return out;
  }, [data, days]);

  /* ---------- board pack PDF ---------- */

  const exportBoardPack = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFillColor(10, 26, 47); doc.rect(0, 0, pageW, 72, 'F');
    doc.setFillColor(6, 182, 212); doc.rect(0, 72, pageW, 3, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text('FBV FleetOS · Executive Board Pack', 40, 34);
    doc.setFont('courier', 'normal'); doc.setFontSize(9); doc.setTextColor(201, 217, 234);
    doc.text(`Period: last ${days} days · Data as of ${fmtDateTimeEAT(demoNowIso())}`, 40, 54);

    autoTable(doc, {
      startY: 92, head: [['KPI', 'Value']],
      body: [
        ['Fleet active', `${data.activePct}%`],
        ['Fleet km (period)', `${fmtNum(data.km)} km`],
        ['Cost per km', `KES ${fmtNum(data.costKm, 2)}`],
        ['Avg safety score', fmtNum(data.avgSafety, 1)],
        ['Open work orders', `${data.openWos.length} (${data.overdueWos.length} overdue)`],
        ['Documents expiring ≤30d', String(data.docsExp.length)],
      ],
      styles: { font: 'courier', fontSize: 9 }, headStyles: { fillColor: [10, 26, 47] },
      alternateRowStyles: { fillColor: [242, 245, 249] }, margin: { left: 40, right: 40 },
    });
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20,
      head: [['Vehicle', ...METRICS as unknown as string[], 'Avg']],
      body: heat.map((r) => [r.vehicle.plate, ...r.scores.map(String), String(r.avg)]),
      styles: { font: 'courier', fontSize: 8 }, headStyles: { fillColor: [10, 26, 47] },
      alternateRowStyles: { fillColor: [242, 245, 249] }, margin: { left: 40, right: 40 },
    });
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(124, 141, 162);
      doc.text(`FBV FleetOS · Page ${i} of ${pages} · Generated ${fmtDateTimeEAT(demoNowIso())}`, 40, doc.internal.pageSize.getHeight() - 20);
    }
    doc.save(`fbv-board-pack-${period}-${TODAY}.pdf`);
    logAudit('export', 'reports', 'board-pack', `Exported executive board pack (PDF, ${period})`);
    toast({ title: 'Board pack exported', body: `fbv-board-pack-${period}-${TODAY}.pdf`, status: 'ok' });
  };

  const kmDeltaPct = data.prevKm > 0 ? Math.round(((data.km - data.prevKm) / data.prevKm) * 100) : 0;
  const spark14 = data.daily.slice(-14).map((d) => d.km);

  const kpis: { label: string; value: number; format?: (v: number) => string; delta?: string; deltaGood?: boolean; icon: LucideIcon; to: string; spark?: number[] }[] = [
    { label: 'Fleet active', value: data.activePct, format: (v) => `${Math.round(v)}%`, delta: '▲ 4% vs Jun', deltaGood: true, icon: Activity, to: '/vehicles', spark: spark14 },
    { label: `Fleet km (${period})`, value: data.km, format: (v) => `${fmtNum(Math.round(v))} km`, delta: `${kmDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(kmDeltaPct)}%`, deltaGood: kmDeltaPct >= 0, icon: TrendingUp, to: '/trips', spark: spark14 },
    { label: 'Cost per km (this month)', value: data.costKm, format: (v) => `KES ${fmtNum(v, 2)}`, delta: '▼ KES 0.80', deltaGood: true, icon: Banknote, to: '/reports' },
    { label: 'Avg safety score', value: data.avgSafety, format: (v) => fmtNum(v, 1), delta: '▲ 1.2', deltaGood: true, icon: Shield, to: '/drivers' },
    { label: 'Open work orders', value: data.openWos.length, delta: data.overdueWos.length > 0 ? `${data.overdueWos.length} overdue` : 'none overdue', deltaGood: data.overdueWos.length === 0, icon: Wrench, to: '/maintenance' },
    { label: 'Documents expiring ≤30d', value: data.docsExp.length, delta: data.docsExp.length > 0 ? 'action needed' : 'all clear', deltaGood: data.docsExp.length === 0, icon: FileWarning, to: '/documents' },
  ];

  return (
    <PageShell className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Executive Analytics</h1>
          <div className="font-mono text-micro text-ink-400">Data as of {fmtDateTimeEAT(demoNowIso())}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-1">
            {(['7d', '30d', '90d', 'mtd'] as Period[]).map((p) => (
              <button key={p} type="button" onClick={() => setPeriod(p)}
                className={cn('rounded-md px-2.5 py-1 text-[12px] font-medium uppercase transition-colors',
                  period === p ? 'bg-accent-soft text-accent-strong' : 'text-ink-400 hover:text-ink-600')}>
                {p}
              </button>
            ))}
          </div>
          <Btn variant="navy" onClick={exportBoardPack}><Download size={15} /> Export board pack (PDF)</Btn>
        </div>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.07, ease: EASE }}>
            <KPIStatCard label={k.label} value={k.value} format={k.format} delta={k.delta} deltaGood={k.deltaGood}
              spark={k.spark} sparkColor="#06B6D4" icon={k.icon}
              onClick={() => navigate(k.to)}
              className="h-full" />
          </motion.div>
        ))}
      </div>

      {/* chart grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12, ease: EASE }}>
          <ChartShell title="Distance & activity" subtitle={`Daily km vs active vehicles · last ${days} d`} data={data.daily}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={Math.ceil(days / 12)} />
                  <YAxis yAxisId="km" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="act" orientation="right" tick={AXIS} tickLine={false} axisLine={false} domain={[0, 14]} />
                  <RTooltip content={<ChartTip />} cursor={{ fill: '#F2F5F9' }} />
                  {data.daily.filter((d) => d.weekend).map((d) => (
                    <ReferenceArea key={d.date} yAxisId="km" x1={d.label} x2={d.label} fill="#F2F5F9" fillOpacity={0.7} />
                  ))}
                  <Bar yAxisId="km" dataKey="km" name="km" fill="#06B6D4" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={800} />
                  <Line yAxisId="act" type="monotone" dataKey="active" name="active vehicles" stroke="#0F2540" strokeWidth={2} dot={false} isAnimationActive animationDuration={900} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18, ease: EASE }}>
          <ChartShell title="Cost stack" subtitle="Fuel / maintenance / insurance / depreciation · 6 mo (projected from observed rates)" data={data.months as unknown as Record<string, unknown>[]}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.months} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="m" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis yAxisId="cost" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} />
                  <YAxis yAxisId="cpk" orientation="right" tick={AXIS} tickLine={false} axisLine={false} />
                  <RTooltip content={<ChartTip />} cursor={{ fill: '#F2F5F9' }} />
                  <Bar yAxisId="cost" dataKey="fuel" name="fuel" stackId="c" fill="#06B6D4" isAnimationActive animationDuration={800} />
                  <Bar yAxisId="cost" dataKey="maintenance" name="maintenance" stackId="c" fill="#0F2540" isAnimationActive animationDuration={800} />
                  <Bar yAxisId="cost" dataKey="insurance" name="insurance" stackId="c" fill="#7C3AED" isAnimationActive animationDuration={800} />
                  <Bar yAxisId="cost" dataKey="depreciation" name="depreciation" stackId="c" fill="#DB2777" isAnimationActive animationDuration={800} />
                  <Line yAxisId="cpk" type="monotone" dataKey="costKm" name="cost/km" stroke="#0E1B2A" strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive animationDuration={900} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.24, ease: EASE }}>
          <ChartShell title="Safety events" subtitle="Harsh events per week + coaching completion · 8 wk" data={data.weeks as unknown as Record<string, unknown>[]}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.weeks} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="w" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis yAxisId="n" tick={AXIS} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="pct" orientation="right" tick={AXIS} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <RTooltip content={<ChartTip />} cursor={{ fill: '#F2F5F9' }} />
                  <Bar yAxisId="n" dataKey="harsh_braking" name="harsh brake" fill="#DC2626" isAnimationActive animationDuration={800} />
                  <Bar yAxisId="n" dataKey="harsh_acceleration" name="harsh accel" fill="#F59E0B" isAnimationActive animationDuration={800} />
                  <Bar yAxisId="n" dataKey="harsh_cornering" name="cornering" fill="#0F2540" isAnimationActive animationDuration={800} />
                  <Bar yAxisId="n" dataKey="speeding" name="speeding" fill="#06B6D4" isAnimationActive animationDuration={800} />
                  <Line yAxisId="pct" type="monotone" dataKey="coached" name="coaching done %" stroke="#16A34A" strokeWidth={2} dot={false} isAnimationActive animationDuration={900} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.3, ease: EASE }}>
          <ChartShell title="Fuel efficiency" subtitle="Fleet km/L per week vs 9.0 target · 90 d · red dots = anomalies" data={data.eff as unknown as Record<string, unknown>[]}>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.eff} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="w" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 'auto']} />
                  <RTooltip content={<ChartTip />} />
                  <ReferenceLine y={9} stroke="#64748B" strokeDasharray="6 4" label={{ value: 'target 9.0', fontSize: 10, fill: '#64748B', fontFamily: 'JetBrains Mono' }} />
                  <Line type="monotone" dataKey="kmL" name="km/L" stroke="#06B6D4" strokeWidth={2.2} dot={{ r: 2.5, fill: '#06B6D4' }} isAnimationActive animationDuration={900} connectNulls />
                  <Scatter dataKey="anomaly" name="anomaly week" fill="#DC2626">
                    {data.eff.map((_, i) => <Cell key={i} fill="#DC2626" />)}
                  </Scatter>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartShell>
        </motion.div>
      </div>

      {/* fleet-health heatmap */}
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[15px] font-semibold text-ink-900">Fleet-health heatmap</div>
            <div className="text-micro text-ink-400">Vehicles × health metrics · click a metric header to sort worst-first · hover cells for breakdown</div>
          </div>
          <Link to="/vehicles" className="text-[13px] font-medium text-accent-strong hover:underline">Open vehicles →</Link>
        </div>
        <div className="overflow-x-auto">
          <div className="inline-flex flex-col gap-1">
            <div className="flex gap-1">
              <div style={{ width: 132 }} />
              {METRICS.map((m, mi) => (
                <button key={m} type="button" onClick={() => setSortMetric(sortMetric === mi ? null : mi)}
                  className={cn('w-[86px] truncate rounded px-1 text-center text-micro font-medium transition-colors',
                    sortMetric === mi ? 'bg-accent-soft text-accent-strong' : 'text-ink-400 hover:bg-surface-muted')}>
                  {m} {sortMetric === mi ? '↓' : ''}
                </button>
              ))}
              <div className="w-16 text-center text-micro text-ink-400">Row avg</div>
            </div>
            {heat.map((r) => (
              <motion.div key={r.vehicle.id} layout transition={{ duration: 0.3, ease: EASE }} className="flex items-center gap-1">
                <div className="pr-2" style={{ width: 132 }}><PlateTag plate={r.vehicle.plate} /></div>
                {r.scores.map((s, ci) => (
                  <div key={ci}
                    title={`${r.vehicle.plate} · ${METRICS[ci]} ${s}/100 — ${r.notes[ci]}`}
                    className={cn(
                      'flex h-8 w-[86px] items-center justify-center rounded-[6px] font-mono text-[12px] font-semibold transition-transform duration-150 hover:scale-110',
                      s < 50 ? 'bg-inactive-soft text-inactive-on-soft'
                        : s < 75 ? 'bg-warn-soft text-warn-on-soft'
                          : s < 90 ? 'bg-accent-soft text-accent-strong'
                            : 'bg-ok-soft text-ok-on-soft',
                    )}>
                    {s}
                  </div>
                ))}
                <div className="flex w-16 justify-center">
                  <span className="rounded-full px-2 py-0.5 font-mono text-micro font-bold text-white" style={{ background: scoreColor(r.avg) }}>{r.avg}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-micro text-ink-400">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-inactive-soft" /> &lt;50</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-warn-soft" /> 60–75</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-accent-soft" /> 75–90</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-ok-soft" /> &gt;90</span>
          <span className="ml-auto text-[12px] text-ink-600">
            {heat.filter((r) => r.avg < 60).length} vehicles drive most of the fleet risk — see recommended actions.
          </span>
        </div>
      </Card>

      {/* risk & attention strip */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2, ease: EASE }}
        className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink-900">
            <TriangleAlert size={16} className="text-alert" /> Top risks
          </div>
          <div className="flex flex-col">
            {risks.worst && (
              <div className="border-b border-border/60 py-2 text-[13px] text-ink-900 transition-colors hover:bg-surface-muted">
                <span className="font-mono font-semibold">{risks.worst.v.plate}</span> — replacement candidate, cost/km {fmtKES(risks.worst.costKm, {})}/km highest in fleet
              </div>
            )}
            {risks.lowDriver && (
              <div className="border-b border-border/60 py-2 text-[13px] text-ink-900 transition-colors hover:bg-surface-muted">
                {risks.lowDriver.name} — safety {fmtNum(risks.lowDriver.safetyScore, 1)}, coaching overdue
              </div>
            )}
            {risks.nextDoc && (
              <div className="py-2 text-[13px] text-ink-900 transition-colors hover:bg-surface-muted">
                {risks.docEntity} {risks.nextDoc.d.docType} — expires in {risks.nextDoc.days} d
              </div>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink-900">
            <CircleCheck size={16} className="text-ok" /> Wins
          </div>
          <div className="flex flex-col">
            {wins.map((w) => (
              <div key={w} className="border-b border-border/60 py-2 text-[13px] text-ink-900 last:border-0 transition-colors hover:bg-surface-muted">{w}</div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-[15px] font-semibold text-ink-900">Recommended actions</div>
          <div className="flex flex-col gap-2">
            <Link to="/maintenance" className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink-900 transition-all hover:-translate-y-px hover:shadow-card">
              Create WO — {risks.worst?.v.plate ?? 'fleet'} <Chip tone="accent">Open →</Chip>
            </Link>
            <Link to="/safety" className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink-900 transition-all hover:-translate-y-px hover:shadow-card">
              Open coaching — {risks.lowDriver?.name ?? 'drivers'} <Chip tone="accent">Open →</Chip>
            </Link>
            <Link to="/documents" className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-ink-900 transition-all hover:-translate-y-px hover:shadow-card">
              Renew document — {risks.docEntity} <Chip tone="accent">Open →</Chip>
            </Link>
          </div>
        </Card>
      </motion.div>
    </PageShell>
  );
}
