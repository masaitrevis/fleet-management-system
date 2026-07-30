// /admin/bulk-upload — Excel Bulk Upload Wizard (design/bulk-upload.md)

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Check, CheckCircle2, Download, FileSpreadsheet, Fuel,
  IdCard, Loader2, ShieldAlert, ShieldCheck, Truck, Upload, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  ColumnMapper, DataTable, EmptyState, FileDropzone, StatusPill, toast,
} from '@/components/shared';
import type { Column, ColumnMapping } from '@/components/shared';
import { add, kvGet, kvSet, list, useCollection } from '@/lib/store';
import type { Vehicle } from '@/lib/types';
import { fmtDateTimeEAT, fmtNum } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  AdminSubNav, Btn, Card, Chip, EASE, PageShell, currentUser, demoNowIso,
  exportXlsx, logAudit,
} from './common';

/* ---------------- dataset definitions ---------------- */

type DatasetKey = 'vehicles' | 'drivers' | 'fuelLogs';

interface TargetDef { key: string; label: string; required?: boolean; aliases?: string[] }

interface DatasetDef {
  key: DatasetKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
  targets: TargetDef[];
  sampleRows: string[][];
}

const DATASETS: DatasetDef[] = [
  {
    key: 'vehicles', label: 'Vehicles', icon: Truck,
    blurb: 'plates, types, tank capacity, costs…',
    targets: [
      { key: 'plate', label: 'Plate', required: true, aliases: ['plate_no', 'registration', 'reg_no'] },
      { key: 'type', label: 'Type', required: true, aliases: ['vehicle_type'] },
      { key: 'make', label: 'Make', required: true },
      { key: 'model', label: 'Model', aliases: ['vehicle_model'] },
      { key: 'year', label: 'Year' },
      { key: 'tankCapacityL', label: 'Tank capacity (L)', aliases: ['tank_l', 'tank'] },
      { key: 'fuelType', label: 'Fuel type', aliases: ['fuel'] },
      { key: 'odometerKm', label: 'Odometer (km)', aliases: ['odometer', 'odo_km'] },
      { key: 'purchaseCostKes', label: 'Purchase cost (KES)', aliases: ['cost_kes', 'purchase_cost'] },
      { key: 'depot', label: 'Depot' },
    ],
    sampleRows: [
      ['KDM 101Q', 'truck', 'Isuzu', 'FRR Box Truck', '2023', '200', 'diesel', '12400', '6950000', 'FBV Depot — Industrial Area'],
      ['KDM 202R', 'pickup', 'Toyota', 'Hilux', '2024', '80', 'diesel', '4200', '5350000', 'FBV Depot — Industrial Area'],
      ['KDM 303S', 'van', 'Toyota', 'Hiace', '2022', '70', 'diesel', '38900', '4250000', 'Mombasa Rd Yard'],
    ],
  },
  {
    key: 'drivers', label: 'Drivers', icon: IdCard,
    blurb: 'names, licences, PSV, phones…',
    targets: [
      { key: 'name', label: 'Full name', required: true, aliases: ['full_name', 'driver_name'] },
      { key: 'phone', label: 'Phone', aliases: ['mobile', 'tel'] },
      { key: 'licenseNo', label: 'Licence no', required: true, aliases: ['license', 'licence_no', 'dl_no'] },
      { key: 'licenseExpiry', label: 'Licence expiry', aliases: ['license_expiry', 'dl_expiry'] },
      { key: 'psvExpiry', label: 'PSV expiry', aliases: ['psv', 'psv_expiry'] },
      { key: 'status', label: 'Status' },
    ],
    sampleRows: [
      ['Michael Njoroge', '+254 722 111 222', 'DL-KE-901244', '2028-04-12', '2027-02-01', 'driving'],
      ['Lucy Wambui', '+254 733 444 555', 'DL-KE-902118', '2027-09-30', '2026-12-15', 'driving'],
      ['Kevin Mutiso', '+254 700 333 111', 'DL-KE-903455', '2029-01-20', '2028-06-01', 'off-duty'],
    ],
  },
  {
    key: 'fuelLogs', label: 'Fuel logs', icon: Fuel,
    blurb: 'dates, stations, litres, prices, odometers…',
    targets: [
      { key: 'at', label: 'Date', required: true, aliases: ['date', 'fuelled_at', 'filled_at'] },
      { key: 'plate', label: 'Plate', required: true, aliases: ['plate_no', 'vehicle'] },
      { key: 'station', label: 'Station', aliases: ['fuel_station'] },
      { key: 'litres', label: 'Litres', required: true, aliases: ['qty_l', 'volume_l'] },
      { key: 'pricePerLKes', label: 'Price per L (KES)', required: true, aliases: ['price', 'price_kes', 'unit_price'] },
      { key: 'odometerKm', label: 'Odometer (km)', required: true, aliases: ['odometer', 'odo_km'] },
    ],
    sampleRows: [
      ['2026-07-20', 'KDJ 123A', 'Total Energies Mombasa Rd', '142.5', '189.50', '128120'],
      ['2026-07-21', 'KDK 208C', 'Rubis Thika Rd', '98.0', '187.90', '96440'],
      ['2026-07-22', 'KDJ 457B', 'Rubis Industrial Area', '61.2', '190.10', '74206'],
    ],
  },
];

/* ---------------- parsing & auto-mapping ---------------- */

interface ParsedFile {
  name: string;
  sheetName: string;
  headers: string[];
  rows: string[][];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function autoMap(headers: string[], targets: TargetDef[]): ColumnMapping[] {
  return headers.map((h) => {
    const nh = norm(h);
    let best: TargetDef | null = null;
    let conf = 0;
    for (const t of targets) {
      const cands = [t.key, t.label, ...(t.aliases ?? [])].map(norm);
      if (cands.includes(nh)) { best = t; conf = 1; break; }
      if (!best && (nh.length > 2 && (norm(t.key).includes(nh) || nh.includes(norm(t.key))))) { best = t; conf = 0.82; }
    }
    return { source: h, target: best?.key ?? null, confidence: conf };
  });
}

/* ---------------- validation ---------------- */

interface RowIssue { level: 'error' | 'warning'; text: string }

interface ValidatedRow {
  idx: number;
  keyField: string;
  record: Record<string, string>;
  issues: RowIssue[];
  resolution: 'skip' | 'import';
}

const PLATE_RE = /^K[A-Z]{2}\s?\d{3}[A-Z]$/;
const TANK_MAX: Record<string, number> = { truck: 250, van: 100, pickup: 100, car: 70, bus: 120 };

function validate(dataset: DatasetKey, rows: string[][], mappings: ColumnMapping[]): ValidatedRow[] {
  const vehicles = list('vehicles');
  const drivers = list('drivers');
  const fuelLogs = list('fuelLogs');
  const byPlate = new Map(vehicles.map((v) => [v.plate.replace(/\s/g, '').toUpperCase(), v]));
  const out: ValidatedRow[] = [];

  rows.forEach((cells, i) => {
    const rec: Record<string, string> = {};
    mappings.forEach((m, ci) => { if (m.target) rec[m.target] = String(cells[ci] ?? '').trim(); });
    const issues: RowIssue[] = [];

    if (dataset === 'vehicles') {
      const plate = (rec.plate ?? '').toUpperCase();
      if (!PLATE_RE.test(plate)) issues.push({ level: 'error', text: `plate '${rec.plate ?? ''}' doesn't match KXX 000X format` });
      else if (byPlate.has(plate.replace(/\s/g, ''))) issues.push({ level: 'error', text: `plate '${plate}' already exists in the fleet (dedupe on plate)` });
      if (!TANK_MAX[(rec.type ?? '').toLowerCase()]) issues.push({ level: 'error', text: `type '${rec.type ?? ''}' must be truck/van/pickup/car/bus` });
      const tank = Number(rec.tankCapacityL);
      if (rec.tankCapacityL && TANK_MAX[(rec.type ?? '').toLowerCase()] && tank > TANK_MAX[(rec.type ?? '').toLowerCase()])
        issues.push({ level: 'warning', text: `tank ${fmtNum(tank)}L exceeds type max (${TANK_MAX[(rec.type ?? '').toLowerCase()]}L)` });
      if (rec.odometerKm && Number.isNaN(Number(rec.odometerKm.replace(/,/g, ''))))
        issues.push({ level: 'error', text: `odometer '${rec.odometerKm}' is not a number` });
      out.push({ idx: i, keyField: plate || `row ${i + 1}`, record: rec, issues, resolution: 'import' });
    }

    if (dataset === 'drivers') {
      if (!rec.name) issues.push({ level: 'error', text: 'name is required' });
      if (!/^DL-KE-\d+$/.test(rec.licenseNo ?? '')) issues.push({ level: 'error', text: `licence '${rec.licenseNo ?? ''}' should look like DL-KE-882114` });
      else if (drivers.some((d) => d.licenseNo === rec.licenseNo)) issues.push({ level: 'error', text: `licence ${rec.licenseNo} already on file (dedupe)` });
      if (rec.licenseExpiry && rec.licenseExpiry < TODAY) issues.push({ level: 'error', text: `licence expired ${rec.licenseExpiry}` });
      if (rec.psvExpiry && rec.psvExpiry < TODAY) issues.push({ level: 'warning', text: `PSV badge expired ${rec.psvExpiry}` });
      out.push({ idx: i, keyField: rec.name || `row ${i + 1}`, record: rec, issues, resolution: 'import' });
    }

    if (dataset === 'fuelLogs') {
      const plate = (rec.plate ?? '').toUpperCase();
      const vehicle = byPlate.get(plate.replace(/\s/g, ''));
      if (!rec.at || Number.isNaN(Date.parse(rec.at))) issues.push({ level: 'error', text: `date '${rec.at ?? ''}' not parseable` });
      if (!vehicle) issues.push({ level: 'error', text: `unknown plate '${rec.plate ?? ''}' — not in the fleet` });
      const litres = Number(rec.litres);
      const price = Number(rec.pricePerLKes);
      const odo = Number(String(rec.odometerKm ?? '').replace(/,/g, ''));
      if (vehicle && litres > vehicle.tankCapacityL * 1.1)
        issues.push({ level: 'warning', text: `litres ${fmtNum(litres, 1)} > tank ${vehicle.tankCapacityL}L × 1.1 — possible volume anomaly` });
      if (!Number.isNaN(price) && (price < 150 || price > 260))
        issues.push({ level: 'warning', text: `price KES ${fmtNum(price, 2)}/L outside sanity band 150–260` });
      if (vehicle && !Number.isNaN(odo) && odo < vehicle.odometerKm)
        issues.push({ level: 'error', text: `odometer ${fmtNum(odo)} < existing ${fmtNum(vehicle.odometerKm)} (must be monotonic)` });
      const hash = `${plate}|${rec.at}|${rec.litres}`;
      if (fuelLogs.some((f) => {
        const fp = vehicles.find((v) => v.id === f.vehicleId)?.plate.toUpperCase();
        return `${fp}|${f.at.slice(0, 10)}|${f.litres}` === hash;
      })) issues.push({ level: 'warning', text: 'possible duplicate of an existing fuel log (row hash match)' });
      out.push({ idx: i, keyField: plate || `row ${i + 1}`, record: rec, issues, resolution: 'import' });
    }
  });
  return out;
}

/* ---------------- commit ---------------- */

function commitRows(dataset: DatasetKey, rows: ValidatedRow[]): number {
  const vehicles = list('vehicles');
  const byPlate = new Map(vehicles.map((v) => [v.plate.replace(/\s/g, '').toUpperCase(), v]));
  let n = 0;
  for (const r of rows) {
    const rec = r.record;
    if (dataset === 'vehicles') {
      const odo = Number(String(rec.odometerKm || '0').replace(/,/g, '')) || 0;
      add('vehicles', {
        id: `veh-upl-${Date.now().toString(36)}-${n}`,
        plate: (rec.plate ?? '').toUpperCase().replace(/^([A-Z]{3})\s?(\d{3}[A-Z])$/, '$1 $2'),
        type: ((rec.type ?? 'truck').toLowerCase() as Vehicle['type']),
        make: rec.make || 'Unknown',
        model: rec.model || rec.make || 'Unknown',
        year: Number(rec.year) || 2024,
        status: 'stopped', tripStatus: 'active',
        odometerKm: odo, engineHours: Math.round(odo / 35), fuelLevelPct: 50,
        tankCapacityL: Number(rec.tankCapacityL) || 100,
        fuelType: (rec.fuelType ?? 'diesel').toLowerCase() === 'petrol' ? 'petrol' : 'diesel',
        purchaseCostKes: Number(String(rec.purchaseCostKes || '0').replace(/,/g, '')) || 0,
        assignedDriverId: null,
        depot: rec.depot || 'FBV Depot — Industrial Area',
        simRoute: 'city-industrial', homeLat: -1.3031, homeLng: 36.8526,
        lastServiceKm: odo, createdAt: TODAY,
      });
      n++;
    } else if (dataset === 'drivers') {
      add('drivers', {
        id: `drv-upl-${Date.now().toString(36)}-${n}`,
        name: rec.name ?? 'Unknown',
        phone: rec.phone || '+254 700 000 000',
        licenseNo: rec.licenseNo ?? '',
        licenseExpiry: rec.licenseExpiry || '2027-12-31',
        psvExpiry: rec.psvExpiry || '2027-06-30',
        safetyScore: 80,
        status: rec.status === 'driving' || rec.status === 'on-leave' ? rec.status : 'off-duty',
        hiredAt: TODAY, rewardPoints: 0, badges: [],
      });
      n++;
    } else {
      const plate = (rec.plate ?? '').toUpperCase();
      const vehicle = byPlate.get(plate.replace(/\s/g, ''))!;
      const litres = Number(rec.litres) || 0;
      const price = Number(rec.pricePerLKes) || 0;
      add('fuelLogs', {
        id: `fuel-upl-${Date.now().toString(36)}-${n}`,
        vehicleId: vehicle.id,
        driverId: vehicle.assignedDriverId ?? 'drv-01',
        station: rec.station || 'Unknown station',
        lat: -1.3031, lng: 36.8526,
        litres, pricePerLKes: price, totalKes: Math.round(litres * price),
        odometerKm: Number(String(rec.odometerKm ?? '0').replace(/,/g, '')) || vehicle.odometerKm,
        at: rec.at.length === 10 ? `${rec.at}T09:00:00.000Z` : rec.at,
        anomaly: litres > vehicle.tankCapacityL ? 'volume_exceeds_tank' : 'none',
      });
      n++;
    }
  }
  return n;
}

/* ---------------- import history ---------------- */

interface ImportRec {
  id: string;
  file: string;
  dataset: string;
  imported: number;
  total: number;
  errors: number;
  by: string;
  at: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  issues?: { row: number; text: string }[];
}

const SEED_HISTORY: ImportRec[] = [
  { id: 'imp-01', file: 'fuel-logs-june.xlsx', dataset: 'Fuel logs', imported: 52, total: 52, errors: 0, by: 'Admin User', at: '2026-07-02T10:14:00.000Z', status: 'COMPLETED' },
  { id: 'imp-02', file: 'drivers-batch2.xlsx', dataset: 'Drivers', imported: 9, total: 10, errors: 1, by: 'Wanjiru Maina', at: '2026-07-15T15:40:00.000Z', status: 'PARTIAL' },
  { id: 'imp-03', file: 'vehicles-july.xlsx', dataset: 'Vehicles', imported: 21, total: 24, errors: 3, by: 'Admin User', at: '2026-07-21T08:05:00.000Z', status: 'PARTIAL' },
];

/* ---------------- page ---------------- */

type Step = 1 | 2 | 3 | 4;

export default function BulkUploadPage() {
  useCollection('vehicles');
  const me = currentUser();
  const allowed = me.role === 'Admin' || me.role === 'Fleet Manager';

  const [step, setStep] = useState<Step>(1);
  const [dataset, setDataset] = useState<DatasetDef>(DATASETS[0]);
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [parseError, setParseError] = useState('');
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [validated, setValidated] = useState<ValidatedRow[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const [history, setHistory] = useState<ImportRec[]>(() =>
    (kvGet('importHistory') as ImportRec[] | undefined) ?? SEED_HISTORY);

  const requiredMissing = useMemo(() => {
    if (!mappings.length) return [] as TargetDef[];
    const mapped = new Set(mappings.map((m) => m.target));
    return dataset.targets.filter((t) => t.required && !mapped.has(t.key));
  }, [mappings, dataset]);

  const stats = useMemo(() => {
    if (!validated) return { valid: 0, warnings: 0, errors: 0, importable: 0 };
    const errors = validated.filter((r) => r.issues.some((i) => i.level === 'error'));
    const warnings = validated.filter((r) => !errors.includes(r) && r.issues.length > 0);
    const valid = validated.length - errors.length - warnings.length;
    const importable = validated.filter((r) =>
      !r.issues.some((i) => i.level === 'error') &&
      (r.issues.length === 0 || r.resolution === 'import')).length;
    return { valid, warnings: warnings.length, errors: errors.length, importable };
  }, [validated]);

  if (!allowed) {
    return (
      <PageShell>
        <Card><EmptyState icon={ShieldAlert} title="403 — Admins only"
          hint="Bulk upload is restricted to Admin and Fleet Manager roles." /></Card>
      </PageShell>
    );
  }

  const parseFile = async (f: File) => {
    setParseError('');
    try {
      const wb = XLSX.read(await f.arrayBuffer());
      const sheetName = wb.SheetNames[0];
      const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
      const rows = grid.filter((r) => r.some((c) => String(c).trim() !== ''));
      if (rows.length < 2) { setParseError('No data rows found — first row must be headers.'); return; }
      const headers = rows[0].map(String);
      setFile({ name: f.name, sheetName, headers, rows: rows.slice(1).map((r) => r.map(String)) });
      setMappings(autoMap(headers, dataset.targets));
    } catch {
      setParseError('Could not parse this file. Use .xlsx or .csv.');
    }
  };

  const runValidation = () => {
    if (!file) return;
    setValidating(true);
    setStep(4);
    setTimeout(() => {
      setValidated(validate(dataset.key, file.rows, mappings));
      setValidating(false);
    }, 1200);
  };

  const downloadErrorReport = (rows: ValidatedRow[]) => {
    const report = rows.filter((r) => r.issues.length > 0).map((r) => ({
      'Row #': r.idx + 2, Key: r.keyField,
      Level: r.issues.map((i) => i.level).join('; '),
      Issues: r.issues.map((i) => i.text).join('; '),
      ...r.record,
    }));
    exportXlsx(`fbv-import-errors-${dataset.key}-${TODAY}.xlsx`, [{ name: 'Errors', rows: report.length ? report : [{ Note: 'No issues' }] }]);
  };

  const doImport = async () => {
    if (!validated || !file) return;
    setImporting(true);
    setProgress(0);
    const toImport = validated.filter((r) =>
      !r.issues.some((i) => i.level === 'error') &&
      (r.issues.length === 0 || r.resolution === 'import'));
    // batched commit with progress ticks
    const batches = 4;
    for (let b = 0; b < batches; b++) {
      const slice = toImport.slice(Math.floor((b * toImport.length) / batches), Math.floor(((b + 1) * toImport.length) / batches));
      commitRows(dataset.key, slice);
      setProgress((b + 1) / batches);
      await new Promise((r) => setTimeout(r, 220));
    }
    const skipped = validated.length - toImport.length - stats.errors;
    const result = { imported: toImport.length, skipped, errors: stats.errors };
    setDone(result);
    setImporting(false);
    const rec: ImportRec = {
      id: `imp-${Date.now().toString(36)}`,
      file: file.name, dataset: dataset.label, imported: result.imported, total: validated.length,
      errors: result.errors, by: me.name, at: demoNowIso(),
      status: result.imported === validated.length ? 'COMPLETED' : result.imported === 0 ? 'FAILED' : 'PARTIAL',
      issues: validated.flatMap((r) => r.issues.map((i) => ({ row: r.idx + 2, text: `${i.level.toUpperCase()}: ${i.text}` }))),
    };
    const next = [rec, ...history];
    setHistory(next);
    kvSet('importHistory', next);
    logAudit('import', dataset.key, file.name,
      `Bulk-uploaded ${result.imported}/${validated.length} ${dataset.label.toLowerCase()} from ${file.name} (${result.errors} errors, ${result.skipped} skipped)`);
    toast({ title: 'Import complete', body: `${result.imported} ${dataset.label.toLowerCase()} imported · logged to audit trail`, status: result.errors ? 'warn' : 'ok' });
  };

  const reset = () => {
    setStep(1); setFile(null); setMappings([]); setValidated(null); setDone(null); setProgress(0); setParseError('');
  };

  const downloadTemplate = () => {
    const headers = dataset.targets.map((t) => t.label + (t.required ? ' *' : ''));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataset.sampleRows]);
    const guide = XLSX.utils.aoa_to_sheet([
      ['Field', 'Required', 'Format', 'Example'],
      ...dataset.targets.map((t, i) => [t.label, t.required ? 'yes' : 'no', t.key === 'plate' ? 'KXX 000X' : t.key.includes('Expiry') || t.key === 'at' ? 'YYYY-MM-DD' : 'text / number', dataset.sampleRows[0][i] ?? '']),
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.utils.book_append_sheet(wb, guide, 'Column guide');
    XLSX.writeFile(wb, `fbv-${dataset.key}-template.xlsx`);
  };

  const STEPS = ['Choose data', 'Upload', 'Map columns', 'Validate & import'];

  return (
    <PageShell className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Bulk Upload</h1>
        <AdminSubNav active="bulk" />
      </div>

      {/* wizard card */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
        className="mx-auto w-full max-w-[880px] rounded-drawer border border-border bg-white p-6 shadow-card">
        {/* stepper */}
        <div className="mb-6 flex items-center">
          {STEPS.map((label, i) => {
            const n = (i + 1) as Step;
            const complete = step > n || (n === 4 && done);
            return (
              <div key={label} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div className={cn('flex h-8 w-8 items-center justify-center rounded-full border-2 font-mono text-[12px] font-bold transition-colors',
                    complete ? 'border-accent bg-accent text-navy-950' : step === n ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border text-ink-400')}>
                    {complete ? <Check size={14} /> : n}
                  </div>
                  <span className={cn('whitespace-nowrap text-micro font-medium', step >= n ? 'text-ink-900' : 'text-ink-400')}>{label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="relative mx-2 mb-5 h-0.5 flex-1 overflow-hidden rounded bg-border">
                    <motion.div className="absolute inset-y-0 left-0 bg-accent"
                      initial={false} animate={{ width: step > n ? '100%' : '0%' }} transition={{ duration: 0.4, ease: EASE }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={`${step}-${done ? 'done' : 'run'}`}
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.26, ease: EASE }}>

            {/* STEP 1 — choose dataset */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {DATASETS.map((d) => (
                    <button key={d.key} type="button" onClick={() => setDataset(d)}
                      className={cn('flex flex-col items-start gap-2 rounded-card border-2 p-4 text-left transition-all duration-150 hover:-translate-y-0.5',
                        dataset.key === d.key ? 'border-accent bg-accent-soft/40' : 'border-border bg-white hover:border-accent/50')}>
                      <span className="flex w-full items-center justify-between">
                        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', dataset.key === d.key ? 'bg-accent text-navy-950' : 'bg-accent-soft text-accent-strong')}>
                          <d.icon size={17} />
                        </span>
                        {dataset.key === d.key && <CheckCircle2 size={17} className="text-accent-strong" />}
                      </span>
                      <span className="text-[14px] font-semibold text-ink-900">{d.label}</span>
                      <span className="text-micro text-ink-400">{d.blurb}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2">
                  <button type="button" onClick={downloadTemplate} className="flex items-center gap-1.5 text-[13px] font-medium text-accent-strong hover:underline">
                    <Download size={14} /> Download {dataset.label.toLowerCase()} template (.xlsx)
                  </button>
                  <span className="text-micro text-ink-400">First sheet = data, second sheet = column guide.</span>
                </div>
                <div className="flex justify-end">
                  <Btn variant="accent" onClick={() => setStep(2)}>Continue</Btn>
                </div>
              </div>
            )}

            {/* STEP 2 — upload */}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                <FileDropzone onFiles={(fs) => { if (fs[0]) parseFile(fs[0]); }} className="min-h-[220px]" />
                {parseError && (
                  <div className="flex items-center gap-2 rounded-lg bg-alert-soft px-3 py-2 text-[13px] font-medium text-alert-on-soft">
                    <X size={15} /> {parseError}
                  </div>
                )}
                {file && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: EASE }}
                    className="flex flex-col gap-3">
                    <div className="flex items-center gap-3 rounded-card border border-border bg-surface-muted/60 px-4 py-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ok-soft text-ok-on-soft"><FileSpreadsheet size={18} /></span>
                      <div className="flex-1">
                        <div className="font-mono text-[13px] font-semibold text-ink-900">{file.name}</div>
                        <div className="font-mono text-micro text-ink-400">{file.rows.length} rows × {file.headers.length} cols · {file.sheetName}</div>
                      </div>
                      <Btn className="h-7 px-2 text-micro" onClick={() => { setFile(null); setMappings([]); }}>Re-drop</Btn>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full font-mono text-[11px]">
                        <thead>
                          <tr className="border-b border-border bg-surface-muted/70">
                            {file.headers.map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium text-ink-400">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {file.rows.slice(0, 5).map((r, i) => (
                            <tr key={i} className="border-b border-border/50 last:border-0">
                              {r.map((c, ci) => <td key={ci} className="px-2 py-1 text-ink-600">{c}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
                <div className="flex justify-between">
                  <Btn variant="ghost" onClick={() => setStep(1)}><ArrowLeft size={15} /> Back</Btn>
                  <Btn variant="accent" disabled={!file} onClick={() => setStep(3)}>Continue</Btn>
                </div>
              </div>
            )}

            {/* STEP 3 — map columns */}
            {step === 3 && file && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] text-ink-600">Map source columns from <span className="font-mono">{file.name}</span> to {dataset.label.toLowerCase()} fields.</div>
                  {requiredMissing.length > 0 && (
                    <Chip tone="alert">{requiredMissing.length} required field{requiredMissing.length > 1 ? 's' : ''} unmapped</Chip>
                  )}
                </div>
                <ColumnMapper
                  mappings={mappings}
                  targets={dataset.targets}
                  onChange={(m) => {
                    // block duplicate targets
                    const seen = new Set<string>();
                    m.forEach((x) => { if (x.target && seen.has(x.target)) x.target = null; if (x.target) seen.add(x.target); });
                    setMappings([...m]);
                  }}
                />
                <div className="flex flex-col gap-1">
                  {mappings.filter((m) => m.target).slice(0, 3).map((m) => (
                    <span key={m.source} className="text-micro text-ok-on-soft">
                      {m.source} → {dataset.targets.find((t) => t.key === m.target)?.label} ✓
                      {m.target === 'plate' && ' format KXX 000X detected'}
                    </span>
                  ))}
                  {mappings.some((m) => !m.target) && (
                    <span className="text-micro text-ink-400">Unmapped source columns will be ignored.</span>
                  )}
                </div>
                <div className="flex justify-between">
                  <Btn variant="ghost" onClick={() => setStep(2)}><ArrowLeft size={15} /> Back</Btn>
                  <Btn variant="accent" disabled={requiredMissing.length > 0} onClick={runValidation}>Validate rows</Btn>
                </div>
              </div>
            )}

            {/* STEP 4 — validate & import */}
            {step === 4 && !done && (
              <div className="flex flex-col gap-4">
                {validating && (
                  <div className="relative overflow-hidden rounded-card border border-border bg-surface-muted/60 p-10 text-center">
                    <motion.div className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-accent/25 to-transparent"
                      initial={{ left: '-10%' }} animate={{ left: '110%' }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} />
                    <Loader2 size={20} className="mx-auto animate-spin text-accent-strong" />
                    <div className="mt-2 text-[13px] font-medium text-ink-600">Validating rows…</div>
                  </div>
                )}

                {validated && !validating && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 py-2">
                      <Chip tone="ok"><Check size={11} /> {stats.valid} valid</Chip>
                      <Chip tone="warn">⚠ {stats.warnings} warnings</Chip>
                      <Chip tone="alert">✗ {stats.errors} error{stats.errors === 1 ? '' : 's'}</Chip>
                      <span className="ml-auto flex gap-2">
                        <Btn className="h-7 px-2 text-micro" onClick={() => downloadErrorReport(validated)}><Download size={13} /> Error report (.xlsx)</Btn>
                      </span>
                    </div>

                    <div className="max-h-[320px] overflow-y-auto rounded-card border border-border">
                      <table className="w-full text-table">
                        <thead className="sticky top-0">
                          <tr className="border-b border-border bg-surface-muted/70 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
                            <th className="h-8 px-3">Row #</th>
                            <th className="h-8 px-3">Key</th>
                            <th className="h-8 px-3">Status</th>
                            <th className="h-8 px-3">Issue detail</th>
                            <th className="h-8 px-3">Resolution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validated.map((r, i) => {
                            const hasError = r.issues.some((x) => x.level === 'error');
                            const hasWarn = r.issues.length > 0;
                            return (
                              <motion.tr key={r.idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                                className="border-b border-border/60 align-top">
                                <td className="px-3 py-2 font-mono text-[12px]">{r.idx + 2}</td>
                                <td className="px-3 py-2 font-mono text-[12px] font-semibold">{r.keyField}</td>
                                <td className="px-3 py-2">
                                  <StatusPill
                                    status={hasError ? 'alert' : hasWarn ? 'warn' : 'ok'}
                                    label={hasError ? 'error' : hasWarn ? 'warning' : 'valid'} />
                                </td>
                                <td className="px-3 py-2">
                                  {r.issues.length === 0
                                    ? <span className="text-micro text-ink-400">—</span>
                                    : r.issues.map((iss, ii) => (
                                      <div key={ii} className={cn('text-[12px] leading-5', iss.level === 'error' ? 'text-alert-on-soft' : 'text-warn-on-soft')}>
                                        Row {r.idx + 2}: {iss.text}
                                      </div>
                                    ))}
                                </td>
                                <td className="px-3 py-2">
                                  {hasError ? <span className="text-micro text-ink-400">excluded</span>
                                    : hasWarn ? (
                                      <span className="flex gap-2 text-micro">
                                        {(['import', 'skip'] as const).map((opt) => (
                                          <label key={opt} className="flex items-center gap-1">
                                            <input type="radio" name={`res-${r.idx}`} checked={r.resolution === opt}
                                              onChange={() => setValidated((v) => v!.map((x) => x.idx === r.idx ? { ...x, resolution: opt } : x))}
                                              className="h-3 w-3 accent-[#06B6D4]" />
                                            {opt === 'import' ? 'import anyway' : 'skip'}
                                          </label>
                                        ))}
                                      </span>
                                    ) : <span className="text-micro text-ok-on-soft">ready</span>}
                                </td>
                              </motion.tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {importing && (
                      <div className="flex flex-col gap-1.5">
                        <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                          <motion.div className="h-full rounded-full bg-accent" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.2 }} />
                        </div>
                        <span className="font-mono text-micro text-ink-400">Writing batch {Math.min(4, Math.ceil(progress * 4))}/4…</span>
                      </div>
                    )}

                    <div className="flex justify-between">
                      <Btn variant="ghost" onClick={() => setStep(3)} disabled={importing}><ArrowLeft size={15} /> Back</Btn>
                      <Btn variant="accent" disabled={importing || stats.importable === 0} onClick={doImport}>
                        {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                        Import {stats.importable} rows
                      </Btn>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* DONE screen */}
            {done && (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: EASE }}
                className="flex flex-col items-center gap-3 py-6 text-center">
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.5, ease: EASE }}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-soft text-ok-on-soft">
                  <CheckCircle2 size={30} />
                </motion.span>
                <div className="text-[18px] font-bold text-ink-900">
                  {done.imported} {dataset.label.toLowerCase()} imported
                </div>
                <div className="font-mono text-[12px] text-ink-400">
                  {done.skipped} skipped with warnings · {done.errors} error{done.errors === 1 ? '' : 's'} — report available
                </div>
                <div className="mt-2 flex gap-2">
                  <Btn variant="accent" onClick={reset}>Import another file</Btn>
                  {validated && <Btn onClick={() => downloadErrorReport(validated)}><Download size={15} /> Error report</Btn>}
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* import history */}
      <ImportHistory history={history} />

      {/* info cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink-900"><ShieldCheck size={16} className="text-accent-strong" /> How validation works</div>
          <ul className="flex flex-col gap-1 text-[12px] leading-5 text-ink-600">
            <li>· Plate format regex KXX 000X; dedupe on plate / licence no / fuel row hash</li>
            <li>· Licence & PSV expiry must be in the future</li>
            <li>· Odometer must be monotonic vs the vehicle's current reading</li>
            <li>· Litres ≤ tank × 1.1; fuel price sanity band 150–260 KES/L</li>
          </ul>
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-ink-900"><ShieldAlert size={16} className="text-warn" /> Safety</div>
          <ul className="flex flex-col gap-1 text-[12px] leading-5 text-ink-600">
            <li>· Imports are additive — nothing overwrites silently</li>
            <li>· Conflicts surface as warnings with a per-row skip/import choice</li>
            <li>· Failed rows never partially write (row-level atomicity)</li>
            <li>· Every import writes an audit entry with counts</li>
          </ul>
        </Card>
      </div>
    </PageShell>
  );
}

/* ---------------- import history table ---------------- */

function ImportHistory({ history }: { history: ImportRec[] }) {
  const columns: Column<ImportRec>[] = [
    {
      key: 'file', header: 'File', mono: true, render: (r) => (
        <span className="flex items-center gap-2">
          <FileSpreadsheet size={14} className="text-ok" />
          <span className="font-medium">{r.file}</span>
        </span>
      ),
    },
    { key: 'dataset', header: 'Dataset', render: (r) => r.dataset },
    { key: 'rows', header: 'Rows', mono: true, render: (r) => `${r.imported}/${r.total}` },
    { key: 'errors', header: 'Errors', render: (r) => r.errors > 0 ? <Chip tone="alert">{r.errors}</Chip> : <Chip tone="ok">0</Chip> },
    { key: 'by', header: 'By', render: (r) => r.by },
    { key: 'at', header: 'Timestamp', mono: true, render: (r) => fmtDateTimeEAT(r.at) },
    {
      key: 'status', header: 'Status', render: (r) => (
        <StatusPill status={r.status === 'COMPLETED' ? 'ok' : r.status === 'PARTIAL' ? 'warn' : 'alert'} label={r.status} />
      ),
    },
    {
      key: 'report', header: '', render: (r) => (
        <Btn className="h-7 px-2 text-micro" disabled={!r.issues?.length}
          onClick={() => {
            exportXlsx(`fbv-import-log-${r.file.replace(/\.[^.]+$/, '')}.xlsx`, [{
              name: 'Issues',
              rows: (r.issues ?? []).map((i) => ({ Row: i.row, Issue: i.text })),
            }]);
            toast({ title: 'Error report downloaded', body: r.file, status: 'ok' });
          }}>
          <Download size={13} /> Error report
        </Btn>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[15px] font-semibold text-ink-900">Import history</div>
      <DataTable columns={columns} rows={history} pageSize={8} />
    </div>
  );
}
