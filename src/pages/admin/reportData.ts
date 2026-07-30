// Report builders — compute real report data from the fleet store.
// Used by /reports (catalog, preview, Excel/PDF export) and history re-downloads.

import { list } from '@/lib/store';
import type { Vehicle } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { fmtKES, fmtNum } from '@/lib/format';
import { daysUntilDemo, demoDateDaysAgo } from './common';

export type ReportKey =
  | 'utilization' | 'cost-km' | 'safety-league' | 'fuel'
  | 'maintenance' | 'trips' | 'compliance' | 'executive';

export interface ReportDef {
  key: ReportKey;
  name: string;
  description: string;
  meta: string;
}

export const REPORT_DEFS: ReportDef[] = [
  { key: 'utilization', name: 'Fleet Utilization', description: 'Active hours vs idle vs downtime per vehicle, utilization % league.', meta: '9 sections · vehicles × period' },
  { key: 'cost-km', name: 'Cost per Kilometre', description: 'TCO-based cost/km per vehicle with fleet average benchmark.', meta: '4 cost lines · per vehicle' },
  { key: 'safety-league', name: 'Driver Safety League', description: 'Full scorecards, rankings and event rates per 1,000 km.', meta: '10 drivers · ranked' },
  { key: 'fuel', name: 'Fuel Report', description: 'Consumption, spend, anomalies and idling waste summary.', meta: 'litres · KES · km/L' },
  { key: 'maintenance', name: 'Maintenance Cost Report', description: 'Spend by vehicle, vendor and type, WO cycle times, parts usage.', meta: 'WOs · parts · vendors' },
  { key: 'trips', name: 'Trip & Distance Report', description: 'Distances, trip counts and business/private split per vehicle.', meta: 'trips × classification' },
  { key: 'compliance', name: 'Compliance Report', description: 'DVIR completion rates, document expiry status, shift-rest violations.', meta: 'DVIR · docs · shifts' },
  { key: 'executive', name: 'Executive Summary', description: '2-page board pack: KPIs, trends, top risks, recommendations.', meta: 'board pack · 2 pages' },
];

export interface BuiltReport {
  def: ReportDef;
  periodLabel: string;
  scopeLabel: string;
  kpis: { label: string; value: string }[];
  columns: { key: string; label: string; mono?: boolean }[];
  rows: Record<string, string | number>[];
}

function scopedVehicles(scope: string): Vehicle[] {
  const all = list('vehicles');
  if (scope === 'long-haul') return all.filter((v) => v.simRoute === 'a109' || v.simRoute === 'a104');
  if (scope === 'city') return all.filter((v) => v.simRoute.startsWith('city'));
  return all;
}

export function scopeLabel(scope: string): string {
  return scope === 'long-haul' ? 'Long-haul group' : scope === 'city' ? 'City fleet' : 'All vehicles';
}

export function periodLabel(days: number): string {
  return days === 7 ? 'Last 7 days' : days === 30 ? 'Last 30 days' : days === 90 ? 'Last 90 days' : `Last ${days} days`;
}

export function buildReport(key: ReportKey, periodDays: number, scope: string): BuiltReport {
  const def = REPORT_DEFS.find((d) => d.key === key)!;
  const vehicles = scopedVehicles(scope);
  const vIds = new Set(vehicles.map((v) => v.id));
  const since = demoDateDaysAgo(periodDays);
  const inPeriod = (iso: string) => iso.slice(0, 10) >= since && iso.slice(0, 10) <= TODAY;

  const trips = list('trips').filter((t) => vIds.has(t.vehicleId) && inPeriod(t.startAt));
  const fuelLogs = list('fuelLogs').filter((f) => vIds.has(f.vehicleId) && inPeriod(f.at));
  const safetyEvents = list('safetyEvents').filter((e) => vIds.has(e.vehicleId) && inPeriod(e.at));
  const allWos = list('workOrders').filter((w) => vIds.has(w.vehicleId));
  const drivers = list('drivers');
  const docs = list('documents');
  const inspections = list('inspections').filter((i) => vIds.has(i.vehicleId) && inPeriod(i.at));
  const shifts = list('shifts').filter((s) => s.vehicleId && vIds.has(s.vehicleId) && inPeriod(s.startAt));

  const woCost = (w: (typeof allWos)[number]) =>
    w.items.reduce((s, it) => s + it.qty * it.unitCostKes, 0) + w.laborCostKes;

  const kmOf = (vid: string) => trips.filter((t) => t.vehicleId === vid).reduce((s, t) => s + t.distanceKm, 0);
  const fuelOf = (vid: string) => fuelLogs.filter((f) => f.vehicleId === vid);
  const fixedDaily = (v: Vehicle) => v.purchaseCostKes * 0.04 / 365 + v.purchaseCostKes / (5 * 365);

  const base = { def, periodLabel: periodLabel(periodDays), scopeLabel: scopeLabel(scope) };

  switch (key) {
    case 'utilization': {
      const rows = vehicles.map((v) => {
        const vt = trips.filter((t) => t.vehicleId === v.id);
        const driveH = vt.reduce((s, t) => s + t.durationMin, 0) / 60;
        const idleH = vt.reduce((s, t) => s + t.idleMin, 0) / 60;
        const util = Math.min(100, (driveH / (periodDays * 8)) * 100);
        return {
          Plate: v.plate, Vehicle: v.model, Trips: vt.length,
          'Active h': fmtNum(driveH, 1), 'Idle h': fmtNum(idleH, 1),
          'Idle %': driveH + idleH > 0 ? fmtNum((idleH / (driveH + idleH)) * 100, 1) : '0.0',
          'Utilization %': fmtNum(util, 0),
        };
      }).sort((a, b) => Number(b['Utilization %']) - Number(a['Utilization %']));
      const avgUtil = rows.reduce((s, r) => s + Number(r['Utilization %']), 0) / Math.max(1, rows.length);
      return {
        ...base,
        kpis: [
          { label: 'Fleet utilization', value: `${fmtNum(avgUtil, 0)}%` },
          { label: 'Active hours', value: fmtNum(rows.reduce((s, r) => s + Number(r['Active h']), 0), 0) },
          { label: 'Most utilized', value: String(rows[0]?.Plate ?? '—') },
        ],
        columns: [
          { key: 'Plate', label: 'Plate', mono: true }, { key: 'Vehicle', label: 'Vehicle' },
          { key: 'Trips', label: 'Trips', mono: true }, { key: 'Active h', label: 'Active h', mono: true },
          { key: 'Idle h', label: 'Idle h', mono: true }, { key: 'Idle %', label: 'Idle %', mono: true },
          { key: 'Utilization %', label: 'Utilization %', mono: true },
        ],
        rows,
      };
    }

    case 'cost-km': {
      const rows = vehicles.map((v) => {
        const km = kmOf(v.id);
        const fuel = fuelOf(v.id).reduce((s, f) => s + f.totalKes, 0);
        const maint = allWos.filter((w) => w.vehicleId === v.id).reduce((s, w) => s + woCost(w), 0);
        const fixed = fixedDaily(v) * periodDays;
        const total = fuel + maint + fixed;
        return {
          Plate: v.plate, Vehicle: v.model, 'Km (period)': fmtNum(km),
          'Fuel KES': fmtNum(fuel), 'Maint KES': fmtNum(maint), 'Fixed KES': fmtNum(fixed),
          'Total KES': fmtNum(total), 'Cost/km': km > 0 ? fmtNum(total / km, 2) : '—',
        };
      }).sort((a, b) => Number(String(b['Cost/km']).replace(/,/g, '')) - Number(String(a['Cost/km']).replace(/,/g, '')));
      const totKm = rows.reduce((s, r) => s + Number(String(r['Km (period)']).replace(/,/g, '')), 0);
      const totCost = rows.reduce((s, r) => s + Number(String(r['Total KES']).replace(/,/g, '')), 0);
      return {
        ...base,
        kpis: [
          { label: 'Fleet avg cost/km', value: totKm > 0 ? `KES ${fmtNum(totCost / totKm, 2)}` : '—' },
          { label: 'Total cost', value: fmtKES(totCost, { compact: true }) },
          { label: 'Highest cost/km', value: String(rows[0]?.Plate ?? '—') },
        ],
        columns: [
          { key: 'Plate', label: 'Plate', mono: true }, { key: 'Vehicle', label: 'Vehicle' },
          { key: 'Km (period)', label: 'Km', mono: true }, { key: 'Fuel KES', label: 'Fuel', mono: true },
          { key: 'Maint KES', label: 'Maintenance', mono: true }, { key: 'Fixed KES', label: 'Insurance+Depr.', mono: true },
          { key: 'Total KES', label: 'Total', mono: true }, { key: 'Cost/km', label: 'Cost/km', mono: true },
        ],
        rows,
      };
    }

    case 'safety-league': {
      const rows = drivers.map((d) => {
        const ev = safetyEvents.filter((e) => e.driverId === d.id);
        const km = trips.filter((t) => t.driverId === d.id).reduce((s, t) => s + t.distanceKm, 0);
        return {
          Driver: d.name, 'Safety score': fmtNum(d.safetyScore, 1), Events: ev.length,
          'Km driven': fmtNum(km),
          'Events /1,000 km': km > 0 ? fmtNum((ev.length / km) * 1000, 2) : '—',
          Status: d.status.toUpperCase(),
        };
      }).sort((a, b) => Number(b['Safety score']) - Number(a['Safety score']))
        .map((r, i) => ({ Rank: i + 1, ...r }));
      const avg = drivers.reduce((s, d) => s + d.safetyScore, 0) / Math.max(1, drivers.length);
      return {
        ...base,
        kpis: [
          { label: 'Avg safety score', value: fmtNum(avg, 1) },
          { label: 'Events (period)', value: String(safetyEvents.length) },
          { label: 'Top driver', value: String(rows[0]?.Driver ?? '—') },
        ],
        columns: [
          { key: 'Rank', label: '#', mono: true }, { key: 'Driver', label: 'Driver' },
          { key: 'Safety score', label: 'Score', mono: true }, { key: 'Events', label: 'Events', mono: true },
          { key: 'Km driven', label: 'Km', mono: true }, { key: 'Events /1,000 km', label: 'Events/1,000 km', mono: true },
          { key: 'Status', label: 'Status', mono: true },
        ],
        rows,
      };
    }

    case 'fuel': {
      const rows = vehicles.map((v) => {
        const fl = fuelOf(v.id);
        const litres = fl.reduce((s, f) => s + f.litres, 0);
        const spend = fl.reduce((s, f) => s + f.totalKes, 0);
        const km = kmOf(v.id);
        const anomalies = fl.filter((f) => f.anomaly !== 'none').length;
        return {
          Plate: v.plate, Fillups: fl.length, 'Litres': fmtNum(litres, 1),
          'Spend KES': fmtNum(spend), 'km/L': litres > 0 ? fmtNum(km / litres, 2) : '—',
          Anomalies: anomalies,
        };
      }).sort((a, b) => Number(String(b['Spend KES']).replace(/,/g, '')) - Number(String(a['Spend KES']).replace(/,/g, '')));
      const totL = rows.reduce((s, r) => s + Number(String(r.Litres).replace(/,/g, '')), 0);
      const totSpend = rows.reduce((s, r) => s + Number(String(r['Spend KES']).replace(/,/g, '')), 0);
      const totKm = vehicles.reduce((s, v) => s + kmOf(v.id), 0);
      return {
        ...base,
        kpis: [
          { label: 'Fuel spend', value: fmtKES(totSpend, { compact: true }) },
          { label: 'Fleet km/L', value: totL > 0 ? fmtNum(totKm / totL, 2) : '—' },
          { label: 'Anomalies', value: String(rows.reduce((s, r) => s + Number(r.Anomalies), 0)) },
        ],
        columns: [
          { key: 'Plate', label: 'Plate', mono: true }, { key: 'Fillups', label: 'Fill-ups', mono: true },
          { key: 'Litres', label: 'Litres', mono: true }, { key: 'Spend KES', label: 'Spend', mono: true },
          { key: 'km/L', label: 'km/L', mono: true }, { key: 'Anomalies', label: 'Anomalies', mono: true },
        ],
        rows,
      };
    }

    case 'maintenance': {
      const vendors = list('vendors');
      const rows = vehicles.map((v) => {
        const vw = allWos.filter((w) => w.vehicleId === v.id);
        const parts = vw.reduce((s, w) => s + w.items.reduce((x, it) => x + it.qty * it.unitCostKes, 0), 0);
        const labor = vw.reduce((s, w) => s + w.laborCostKes, 0);
        const done = vw.filter((w) => w.completedAt);
        const cycle = done.length
          ? done.reduce((s, w) => s + (new Date(w.completedAt!).getTime() - new Date(w.openedAt).getTime()) / 86400000, 0) / done.length
          : 0;
        const vendorNames = [...new Set(vw.map((w) => vendors.find((x) => x.id === w.vendorId)?.name).filter(Boolean))].join('; ');
        return {
          Plate: v.plate, WOs: vw.length, Open: vw.filter((w) => w.status !== 'done' && w.status !== 'cancelled').length,
          'Parts KES': fmtNum(parts), 'Labor KES': fmtNum(labor), 'Total KES': fmtNum(parts + labor),
          'Avg cycle (d)': fmtNum(cycle, 1), Vendors: vendorNames || '—',
        };
      }).filter((r) => Number(r.WOs) > 0)
        .sort((a, b) => Number(String(b['Total KES']).replace(/,/g, '')) - Number(String(a['Total KES']).replace(/,/g, '')));
      const total = rows.reduce((s, r) => s + Number(String(r['Total KES']).replace(/,/g, '')), 0);
      return {
        ...base,
        kpis: [
          { label: 'Maintenance spend', value: fmtKES(total, { compact: true }) },
          { label: 'Work orders', value: String(allWos.length) },
          { label: 'Open WOs', value: String(allWos.filter((w) => w.status !== 'done' && w.status !== 'cancelled').length) },
        ],
        columns: [
          { key: 'Plate', label: 'Plate', mono: true }, { key: 'WOs', label: 'WOs', mono: true },
          { key: 'Open', label: 'Open', mono: true }, { key: 'Parts KES', label: 'Parts', mono: true },
          { key: 'Labor KES', label: 'Labor', mono: true }, { key: 'Total KES', label: 'Total', mono: true },
          { key: 'Avg cycle (d)', label: 'Avg cycle (d)', mono: true }, { key: 'Vendors', label: 'Vendors' },
        ],
        rows,
      };
    }

    case 'trips': {
      const rows = vehicles.map((v) => {
        const vt = trips.filter((t) => t.vehicleId === v.id);
        const km = vt.reduce((s, t) => s + t.distanceKm, 0);
        const biz = vt.filter((t) => t.classification === 'business').reduce((s, t) => s + t.distanceKm, 0);
        const priv = vt.filter((t) => t.classification === 'private').reduce((s, t) => s + t.distanceKm, 0);
        return {
          Plate: v.plate, Trips: vt.length, 'Distance km': fmtNum(km),
          'Avg trip km': vt.length ? fmtNum(km / vt.length, 1) : '—',
          'Business %': km > 0 ? fmtNum((biz / km) * 100, 0) : '—',
          'Private %': km > 0 ? fmtNum((priv / km) * 100, 0) : '—',
        };
      }).sort((a, b) => Number(String(b['Distance km']).replace(/,/g, '')) - Number(String(a['Distance km']).replace(/,/g, '')));
      const totKm = rows.reduce((s, r) => s + Number(String(r['Distance km']).replace(/,/g, '')), 0);
      return {
        ...base,
        kpis: [
          { label: 'Fleet km', value: fmtNum(totKm) },
          { label: 'Trips', value: String(trips.length) },
          { label: 'Business share', value: `${fmtNum((trips.filter((t) => t.classification === 'business').reduce((s, t) => s + t.distanceKm, 0) / Math.max(1, totKm)) * 100, 0)}%` },
        ],
        columns: [
          { key: 'Plate', label: 'Plate', mono: true }, { key: 'Trips', label: 'Trips', mono: true },
          { key: 'Distance km', label: 'Distance', mono: true }, { key: 'Avg trip km', label: 'Avg trip', mono: true },
          { key: 'Business %', label: 'Business %', mono: true }, { key: 'Private %', label: 'Private %', mono: true },
        ],
        rows,
      };
    }

    case 'compliance': {
      const rows = vehicles.map((v) => {
        const vi = inspections.filter((i) => i.vehicleId === v.id);
        const passRate = vi.length ? (vi.filter((i) => i.result === 'pass').length / vi.length) * 100 : 100;
        const vDocs = docs.filter((d) => d.entityType === 'vehicle' && d.entityId === v.id);
        const minDays = vDocs.length ? Math.min(...vDocs.map((d) => daysUntilDemo(d.expiresAt))) : 999;
        const expiring = vDocs.filter((d) => daysUntilDemo(d.expiresAt) <= 90).length;
        const driver = drivers.find((d) => d.id === v.assignedDriverId);
        const restWarn = driver ? shifts.filter((s) => s.driverId === driver.id && s.restWarning).length : 0;
        return {
          Plate: v.plate, 'DVIRs': vi.length, 'DVIR pass %': fmtNum(passRate, 0),
          'Docs expiring ≤90d': expiring,
          'Nearest doc (d)': minDays === 999 ? '—' : minDays,
          'Rest warnings': restWarn,
        };
      });
      const docRows = docs
        .filter((d) => daysUntilDemo(d.expiresAt) <= 90)
        .map((d) => ({
          Entity: d.entityType === 'vehicle'
            ? (vehicles.find((v) => v.id === d.entityId)?.plate ?? d.entityId)
            : (drivers.find((x) => x.id === d.entityId)?.name ?? d.entityId),
          Document: d.docType, Number: d.number,
          'Expires': d.expiresAt, 'Days left': daysUntilDemo(d.expiresAt),
        }))
        .sort((a, b) => Number(a['Days left']) - Number(b['Days left']));
      const dvirTotal = inspections.length;
      const dvirPass = inspections.filter((i) => i.result === 'pass').length;
      return {
        ...base,
        kpis: [
          { label: 'DVIR pass rate', value: `${dvirTotal ? fmtNum((dvirPass / dvirTotal) * 100, 0) : 100}%` },
          { label: 'Docs expiring ≤30d', value: String(docs.filter((d) => daysUntilDemo(d.expiresAt) <= 30).length) },
          { label: 'Rest violations', value: String(shifts.filter((s) => s.restWarning).length) },
        ],
        columns: [
          { key: 'Entity', label: 'Entity', mono: true }, { key: 'Document', label: 'Document' },
          { key: 'Number', label: 'Number', mono: true }, { key: 'Expires', label: 'Expires', mono: true },
          { key: 'Days left', label: 'Days left', mono: true },
        ],
        rows: docRows.length ? docRows : rows,
      };
    }

    case 'executive': {
      const totKm = trips.reduce((s, t) => s + t.distanceKm, 0);
      const fuelSpend = fuelLogs.reduce((s, f) => s + f.totalKes, 0);
      const maintSpend = allWos.reduce((s, w) => s + woCost(w), 0);
      const fixed = vehicles.reduce((s, v) => s + fixedDaily(v) * periodDays, 0);
      const avgSafety = drivers.reduce((s, d) => s + d.safetyScore, 0) / Math.max(1, drivers.length);
      const openWos = allWos.filter((w) => w.status !== 'done' && w.status !== 'cancelled').length;
      const docsExp = docs.filter((d) => daysUntilDemo(d.expiresAt) <= 30).length;
      const activePct = Math.round((vehicles.filter((v) => v.tripStatus === 'active').length / Math.max(1, vehicles.length)) * 100);
      const rows = [
        { KPI: 'Fleet active', Value: `${activePct}%`, Note: 'vehicles in service' },
        { KPI: 'Fleet km (period)', Value: `${fmtNum(totKm)} km`, Note: base.periodLabel },
        { KPI: 'Cost per km', Value: totKm > 0 ? `KES ${fmtNum((fuelSpend + maintSpend + fixed) / totKm, 2)}` : '—', Note: 'fuel + maintenance + fixed' },
        { KPI: 'Avg safety score', Value: fmtNum(avgSafety, 1), Note: `${drivers.length} drivers` },
        { KPI: 'Open work orders', Value: String(openWos), Note: `${allWos.length} total` },
        { KPI: 'Documents expiring ≤30d', Value: String(docsExp), Note: 'compliance radar' },
        { KPI: 'Fuel spend', Value: fmtKES(fuelSpend, { compact: true }), Note: `${fmtNum(fuelLogs.reduce((s, f) => s + f.litres, 0), 0)} L` },
        { KPI: 'Safety events', Value: String(safetyEvents.length), Note: base.periodLabel },
      ];
      return {
        ...base,
        kpis: [
          { label: 'Fleet active', value: `${activePct}%` },
          { label: 'Cost per km', value: totKm > 0 ? `KES ${fmtNum((fuelSpend + maintSpend + fixed) / totKm, 2)}` : '—' },
          { label: 'Avg safety', value: fmtNum(avgSafety, 1) },
        ],
        columns: [
          { key: 'KPI', label: 'KPI' }, { key: 'Value', label: 'Value', mono: true }, { key: 'Note', label: 'Note' },
        ],
        rows,
      };
    }
  }
}
