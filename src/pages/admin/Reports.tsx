// /reports — Report Catalog & Scheduled Reports (design/reports.md)
// Real client-side exports: .xlsx via SheetJS, PDF via jsPDF + autotable.

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, Banknote, CalendarClock, Check, ClipboardCheck, Download,
  FileBarChart2, FileText, Fuel, Loader2, Plus, Route, Shield, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChartCard, DataTable, Drawer, Modal, Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { kvGet, kvSet, useFleetStore } from '@/lib/store';
import { fmtDateTimeEAT, fmtNum } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Btn, Chip, EASE, PageShell, currentUser, demoNowIso, exportPdf,
  exportXlsx, logAudit, selectCls,
} from './common';
import { REPORT_DEFS, buildReport } from './reportData';
import type { BuiltReport, ReportKey } from './reportData';

const REPORT_ICONS: Record<ReportKey, LucideIcon> = {
  utilization: Activity,
  'cost-km': Banknote,
  'safety-league': Shield,
  fuel: Fuel,
  maintenance: Wrench,
  trips: Route,
  compliance: ClipboardCheck,
  executive: FileBarChart2,
};

/* ---------------- kv types ---------------- */

interface ScheduleRec {
  id: string;
  reportKey: ReportKey;
  reportName: string;
  schedule: string;
  formats: ('XLSX' | 'PDF')[];
  recipients: string[];
  lastSent: string;
  nextIn: string;
  active: boolean;
}

interface HistoryRec {
  id: string;
  reportKey: ReportKey;
  report: string;
  period: string;
  format: 'XLSX' | 'PDF';
  by: string;
  scheduled: boolean;
  at: string;
  rows: number;
  sizeKb: number;
  periodDays: number;
  scope: string;
}

const SEED_SCHEDULES: ScheduleRec[] = [
  { id: 'sch-01', reportKey: 'executive', reportName: 'Executive Summary', schedule: 'Monthly · 1st 08:00', formats: ['PDF'], recipients: ['Admin', 'Fleet Manager'], lastSent: '2026-07-01T05:00:00.000Z', nextIn: 'in 4 d 18 h', active: true },
  { id: 'sch-02', reportKey: 'fuel', reportName: 'Fuel Report', schedule: 'Weekly · Mon 07:00', formats: ['XLSX', 'PDF'], recipients: ['Fleet Manager'], lastSent: '2026-07-27T04:00:00.000Z', nextIn: 'in 6 d 21 h', active: true },
  { id: 'sch-03', reportKey: 'compliance', reportName: 'Compliance Report', schedule: 'Monthly · 1st 08:00', formats: ['XLSX'], recipients: ['Fleet Manager', 'Read-only'], lastSent: '2026-07-01T05:00:00.000Z', nextIn: 'in 4 d 18 h', active: true },
];

const SEED_HISTORY: HistoryRec[] = [
  { id: 'hist-01', reportKey: 'fuel', report: 'Fuel Report', period: 'Last 7 days', format: 'XLSX', by: 'SCHEDULED', scheduled: true, at: '2026-07-27T04:00:00.000Z', rows: 14, sizeKb: 96, periodDays: 7, scope: 'all' },
  { id: 'hist-02', reportKey: 'utilization', report: 'Fleet Utilization', period: 'Last 30 days', format: 'PDF', by: 'Wanjiru Maina', scheduled: false, at: '2026-07-25T11:20:00.000Z', rows: 14, sizeKb: 214, periodDays: 30, scope: 'all' },
  { id: 'hist-03', reportKey: 'safety-league', report: 'Driver Safety League', period: 'Last 30 days', format: 'XLSX', by: 'Admin User', scheduled: false, at: '2026-07-22T09:44:00.000Z', rows: 10, sizeKb: 61, periodDays: 30, scope: 'all' },
  { id: 'hist-04', reportKey: 'executive', report: 'Executive Summary', period: 'Last 30 days', format: 'PDF', by: 'SCHEDULED', scheduled: true, at: '2026-07-01T05:00:00.000Z', rows: 8, sizeKb: 187, periodDays: 30, scope: 'all' },
];

/* ---------------- page ---------------- */

interface CardCfg { periodDays: number; scope: string; custom: boolean }

export default function ReportsPage() {
  useFleetStore((s) => s.collections); // re-render on data change
  const [tab, setTab] = useState('catalog');
  const [cfgs, setCfgs] = useState<Record<ReportKey, CardCfg>>(() => Object.fromEntries(
    REPORT_DEFS.map((d) => [d.key, { periodDays: 30, scope: 'all', custom: false }]),
  ) as Record<ReportKey, CardCfg>);
  const [preview, setPreview] = useState<BuiltReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryRec[]>(() =>
    (kvGet('reportHistory') as HistoryRec[] | undefined) ?? SEED_HISTORY);

  const me = currentUser();
  const readOnly = me.role === 'Read-only';

  const setCfg = (key: ReportKey, patch: Partial<CardCfg>) =>
    setCfgs((c) => ({ ...c, [key]: { ...c[key], ...patch } }));

  const pushHistory = (rec: HistoryRec) => {
    const next = [rec, ...history];
    setHistory(next);
    kvSet('reportHistory', next);
  };

  const runExport = (built: BuiltReport, format: 'XLSX' | 'PDF', byScheduled = false) => {
    const slug = built.def.key;
    const periodSlug = built.periodLabel.replace(/\D+/g, '') || '30';
    const stamp = `${demoNowIso().slice(0, 10)}`;
    let rows = 0;
    if (format === 'XLSX') {
      rows = exportXlsx(`fbv-${slug}-${periodSlug}d-${stamp}.xlsx`, [
        { name: 'Summary', rows: built.kpis.map((k) => ({ KPI: k.label, Value: k.value })) },
        { name: 'Data', rows: built.rows },
      ]);
    } else {
      exportPdf({
        filename: `fbv-${slug}-${periodSlug}d-${stamp}.pdf`,
        title: built.def.name,
        subtitle: `${built.periodLabel} · ${built.scopeLabel} · Generated ${fmtDateTimeEAT(demoNowIso())}`,
        head: built.columns.map((c) => c.label),
        rows: built.rows.map((r) => built.columns.map((c) => r[c.key] ?? '—')),
        landscape: built.columns.length > 5,
      });
      rows = built.rows.length;
    }
    const rec: HistoryRec = {
      id: `hist-${Date.now().toString(36)}`,
      reportKey: built.def.key, report: built.def.name, period: built.periodLabel,
      format, by: byScheduled ? 'SCHEDULED' : me.name, scheduled: byScheduled,
      at: demoNowIso(), rows, sizeKb: Math.max(24, Math.round(rows * (format === 'PDF' ? 9 : 4))),
      periodDays: Number(periodSlug) || 30, scope: built.scopeLabel === 'All vehicles' ? 'all' : built.scopeLabel === 'City fleet' ? 'city' : 'long-haul',
    };
    pushHistory(rec);
    logAudit('export', 'reports', built.def.key, `Exported ${built.def.name} (${format}, ${built.periodLabel}, ${rows} rows)`);
    toast({ title: `${format} export ready`, body: `${rec.report} · ${rows} rows · ${format === 'PDF' ? 'PDF' : 'Excel'}`, status: 'ok' });
  };

  const exportFromCard = (key: ReportKey, format: 'XLSX' | 'PDF') => {
    const token = `${key}-${format}`;
    setBusy(token);
    // progress shimmer, then generate
    setTimeout(() => {
      const cfg = cfgs[key];
      runExport(buildReport(key, cfg.periodDays, cfg.scope), format);
      setBusy(null);
    }, 700);
  };

  const recent = history.slice(0, 3);

  return (
    <PageShell className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Reports</h1>
        <div className="flex items-center gap-2">
          {recent.map((r) => (
            <Chip key={r.id} tone="inactive" className="hidden md:inline-flex">
              <FileText size={11} /> {r.report} · {r.format}
            </Chip>
          ))}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'catalog', label: 'Catalog', count: REPORT_DEFS.length },
          { key: 'scheduled', label: 'Scheduled', count: (kvGet('reportSchedules') as ScheduleRec[] | undefined ?? SEED_SCHEDULES).filter((s) => s.active).length },
          { key: 'history', label: 'History', count: history.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          {tab === 'catalog' && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {REPORT_DEFS.map((def, i) => {
                const Icon = REPORT_ICONS[def.key];
                const cfg = cfgs[def.key];
                return (
                  <motion.div
                    key={def.key}
                    initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3, delay: i * 0.06, ease: EASE }}
                    className="flex flex-col gap-3 rounded-drawer border border-border bg-white p-5 shadow-card transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop"
                  >
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                        <Icon size={18} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[15px] font-bold text-ink-900">{def.name}</div>
                        <div className="line-clamp-2 text-[13px] leading-5 text-ink-600">{def.description}</div>
                      </div>
                    </div>
                    <div className="font-mono text-micro uppercase tracking-[0.02em] text-ink-400">{def.meta}</div>

                    {/* config row */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[7, 30, 90].map((d) => (
                        <button key={d} type="button"
                          onClick={() => setCfg(def.key, { periodDays: d, custom: false })}
                          className={cn('rounded-full px-2.5 py-1 text-micro font-medium transition-colors',
                            !cfg.custom && cfg.periodDays === d ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft hover:opacity-80')}>
                          {d}d
                        </button>
                      ))}
                      <button type="button"
                        onClick={() => setCfg(def.key, { custom: true, periodDays: 45 })}
                        className={cn('rounded-full px-2.5 py-1 text-micro font-medium transition-colors',
                          cfg.custom ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft hover:opacity-80')}>
                        Custom
                      </button>
                      <select value={cfg.scope} onChange={(e) => setCfg(def.key, { scope: e.target.value })}
                        className="ml-auto h-7 rounded-lg border border-border bg-white px-2 text-micro text-ink-900 outline-none focus:border-accent">
                        <option value="all">All vehicles</option>
                        <option value="long-haul">Long-haul group</option>
                        <option value="city">City fleet</option>
                      </select>
                    </div>
                    {cfg.custom && (
                      <div className="flex items-center gap-2 text-micro text-ink-400">
                        <input type="number" min={1} max={90} value={cfg.periodDays}
                          onChange={(e) => setCfg(def.key, { periodDays: Math.max(1, Math.min(90, Number(e.target.value) || 30)) })}
                          className="h-7 w-20 rounded-lg border border-border px-2 font-mono text-micro outline-none focus:border-accent" />
                        days (demo history spans 60 d)
                      </div>
                    )}

                    {/* actions */}
                    <div className="mt-auto flex items-center gap-2 pt-1">
                      <Btn variant="outline" className="border-info/40 text-info-on-soft hover:bg-info-soft"
                        onClick={() => setPreview(buildReport(def.key, cfg.periodDays, cfg.scope))}>
                        Preview
                      </Btn>
                      <Btn variant="accent" disabled={busy !== null} onClick={() => exportFromCard(def.key, 'XLSX')}>
                        {busy === `${def.key}-XLSX` ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Excel
                      </Btn>
                      <Btn variant="navy" disabled={busy !== null} onClick={() => exportFromCard(def.key, 'PDF')}>
                        {busy === `${def.key}-PDF` ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} PDF
                      </Btn>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {tab === 'scheduled' && <ScheduledTab readOnly={readOnly} />}
          {tab === 'history' && (
            <HistoryTab
              history={history}
              onRedownload={(rec) => runExport(buildReport(rec.reportKey, rec.periodDays, rec.scope), rec.format)}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* preview drawer */}
      <Drawer open={!!preview} onClose={() => setPreview(null)} width={560}
        title={preview ? `Preview — ${preview.def.name}` : ''}
        footer={preview && (
          <div className="flex justify-end gap-2">
            <Btn variant="accent" onClick={() => { runExport(preview, 'XLSX'); }}><Download size={15} /> Excel</Btn>
            <Btn variant="navy" onClick={() => { runExport(preview, 'PDF'); }}><Download size={15} /> PDF</Btn>
          </div>
        )}>
        {preview && <PreviewBody built={preview} />}
      </Drawer>
    </PageShell>
  );
}

/* ---------------- preview body ---------------- */

function PreviewBody({ built }: { built: BuiltReport }) {
  const chartRows = built.rows.slice(0, 8).map((r) => {
    const labelKey = built.columns[0].key;
    const numCol = built.columns.find((c) => c.key !== labelKey && !Number.isNaN(Number(String(r[c.key]).replace(/,/g, ''))));
    return { label: String(r[labelKey]), value: numCol ? Number(String(r[numCol.key]).replace(/,/g, '')) : 0 };
  });
  const numColLabel = built.columns.find((c) => c.key !== built.columns[0].key && !Number.isNaN(Number(String(built.rows[0]?.[c.key] ?? '').replace(/,/g, ''))))?.label ?? 'Value';

  return (
    <div className="flex flex-col gap-4">
      {/* branded header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
        className="overflow-hidden rounded-card">
        <div className="flex items-center gap-3 bg-navy-900 px-4 py-3">
          <img src="/logo.svg" alt="" className="h-8 w-8" />
          <div>
            <div className="text-[14px] font-bold text-white">FBV FleetOS · {built.def.name}</div>
            <div className="text-micro text-navy-100">{built.periodLabel} · {built.scopeLabel}</div>
          </div>
        </div>
        <div className="h-[3px] bg-accent" />
        <div className="bg-surface-muted px-4 py-1.5 font-mono text-micro text-ink-400">
          Generated {fmtDateTimeEAT(demoNowIso())}
        </div>
      </motion.div>

      {/* KPI band */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05, ease: EASE }}
        className="grid grid-cols-3 gap-2">
        {built.kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-white p-3">
            <div className="text-micro font-medium uppercase tracking-[0.06em] text-ink-400">{k.label}</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{k.value}</div>
          </div>
        ))}
      </motion.div>

      {/* chart */}
      {chartRows.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1, ease: EASE }}>
          <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">{numColLabel} — top {chartRows.length}</div>
          <BarChartCard data={chartRows} xKey="label" series={[{ key: 'value', name: numColLabel }]} height={180} />
        </motion.div>
      )}

      {/* data excerpt */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15, ease: EASE }}
        className="overflow-hidden rounded-card border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border bg-surface-muted/70">
              {built.columns.slice(0, 5).map((c) => (
                <th key={c.key} className="h-8 px-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-ink-400">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {built.rows.slice(0, 10).map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {built.columns.slice(0, 5).map((c) => (
                  <td key={c.key} className={cn('px-2.5 py-1.5 text-ink-900', c.mono && 'font-mono')}>{r[c.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {built.rows.length > 10 && (
          <div className="border-t border-border bg-surface-muted/60 px-3 py-1.5 text-center font-mono text-micro text-ink-400">
            …+{fmtNum(built.rows.length - 10)} more rows in the export
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ---------------- scheduled tab ---------------- */

function ScheduledTab({ readOnly }: { readOnly: boolean }) {
  const [schedules, setSchedules] = useState<ScheduleRec[]>(() =>
    (kvGet('reportSchedules') as ScheduleRec[] | undefined) ?? SEED_SCHEDULES);
  const [modalOpen, setModalOpen] = useState(false);

  const save = (next: ScheduleRec[]) => { setSchedules(next); kvSet('reportSchedules', next); };

  const toggle = (id: string) => {
    const next = schedules.map((s) => (s.id === id ? { ...s, active: !s.active } : s));
    save(next);
    const s = schedules.find((x) => x.id === id)!;
    logAudit('update', 'reports', id, `Scheduled report "${s.reportName}" ${s.active ? 'paused' : 'activated'}`);
  };

  const columns: Column<ScheduleRec>[] = [
    {
      key: 'report', header: 'Report', render: (s) => (
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
            <CalendarClock size={14} />
          </span>
          <span className="font-medium text-ink-900">{s.reportName}</span>
        </span>
      ),
    },
    { key: 'schedule', header: 'Schedule', mono: true, render: (s) => s.schedule },
    {
      key: 'formats', header: 'Format', render: (s) => (
        <span className="flex gap-1">{s.formats.map((f) => <Chip key={f} tone={f === 'PDF' ? 'navy' : 'accent'}>{f}</Chip>)}</span>
      ),
    },
    {
      key: 'recipients', header: 'Recipients', render: (s) => (
        <span className="flex flex-wrap gap-1">{s.recipients.map((r) => <Chip key={r}>{r}</Chip>)}</span>
      ),
    },
    {
      key: 'last', header: 'Last sent', mono: true, render: (s) => (
        <span className="inline-flex items-center gap-1">{fmtDateTimeEAT(s.lastSent)} <Check size={12} className="text-ok" /></span>
      ),
    },
    { key: 'next', header: 'Next run', mono: true, render: (s) => s.nextIn },
    {
      key: 'active', header: 'Active', align: 'center', render: (s) => (
        <button type="button" disabled={readOnly} onClick={() => toggle(s.id)}
          className={cn('relative h-5 w-9 rounded-full transition-colors duration-150 ease-snap disabled:opacity-40', s.active ? 'bg-accent' : 'bg-inactive-soft')}>
          <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150', s.active ? 'left-[18px]' : 'left-0.5')} />
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-[13px] font-medium text-info-on-soft">
          <CalendarClock size={15} /> Delivery simulated — scheduled runs appear in History and the Notification log.
        </div>
        {!readOnly && <Btn variant="accent" onClick={() => setModalOpen(true)}><Plus size={15} /> Schedule report</Btn>}
      </div>
      <DataTable columns={columns} rows={schedules} pageSize={10} />
      <ScheduleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={(s) => {
          save([...schedules, s]);
          logAudit('create', 'reports', s.id, `Scheduled ${s.reportName} (${s.schedule}) → ${s.recipients.join(', ')}`);
          toast({ title: 'Report scheduled', body: `${s.reportName} · ${s.schedule}`, status: 'ok' });
        }}
      />
    </div>
  );
}

function ScheduleModal({ open, onClose, onCreate }: {
  open: boolean; onClose: () => void; onCreate: (s: ScheduleRec) => void;
}) {
  const [reportKey, setReportKey] = useState<ReportKey>('executive');
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [weekday, setWeekday] = useState('Mon');
  const [monthDay, setMonthDay] = useState('1st');
  const [formats, setFormats] = useState<('XLSX' | 'PDF')[]>(['XLSX', 'PDF']);
  const [recipients, setRecipients] = useState<string[]>(['Fleet Manager']);

  const schedule = freq === 'daily' ? 'Daily · 07:00' : freq === 'weekly' ? `Weekly · ${weekday} 07:00` : `Monthly · ${monthDay} 08:00`;

  return (
    <Modal open={open} onClose={onClose} title="Schedule report" wide
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="accent" disabled={formats.length === 0 || recipients.length === 0}
            onClick={() => {
              onCreate({
                id: `sch-${Date.now().toString(36)}`,
                reportKey,
                reportName: REPORT_DEFS.find((d) => d.key === reportKey)!.name,
                schedule, formats, recipients, lastSent: demoNowIso(), nextIn: 'pending first run', active: true,
              });
              onClose();
            }}>
            Save schedule
          </Btn>
        </>
      }>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-ink-600">
          Report
          <select value={reportKey} onChange={(e) => setReportKey(e.target.value as ReportKey)} className={selectCls}>
            {REPORT_DEFS.map((d) => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-2">
          {(['daily', 'weekly', 'monthly'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFreq(f)}
              className={cn('rounded-full px-3 py-1 text-[12px] font-medium capitalize',
                freq === f ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
              {f}
            </button>
          ))}
          {freq === 'weekly' && (
            <select value={weekday} onChange={(e) => setWeekday(e.target.value)} className={cn(selectCls, 'h-8 w-24')}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <option key={d}>{d}</option>)}
            </select>
          )}
          {freq === 'monthly' && (
            <select value={monthDay} onChange={(e) => setMonthDay(e.target.value)} className={cn(selectCls, 'h-8 w-24')}>
              {['1st', '5th', '15th', '28th'].map((d) => <option key={d}>{d}</option>)}
            </select>
          )}
          <Chip tone="accent" className="ml-auto font-mono">{schedule}</Chip>
        </div>
        <div className="flex items-center gap-4 text-[13px] text-ink-600">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Format</span>
          {(['XLSX', 'PDF'] as const).map((f) => (
            <label key={f} className="flex items-center gap-1.5">
              <input type="checkbox" checked={formats.includes(f)}
                onChange={(e) => setFormats((cur) => e.target.checked ? [...cur, f] : cur.filter((x) => x !== f))}
                className="h-4 w-4 accent-[#06B6D4]" />
              {f === 'XLSX' ? 'Excel attachment' : 'PDF'}
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Recipients</span>
          <div className="flex flex-wrap gap-1.5">
            {['Admin', 'Fleet Manager', 'Dispatcher', 'Mechanic', 'Read-only'].map((r) => (
              <button key={r} type="button"
                onClick={() => setRecipients((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r])}
                className={cn('rounded-full px-2.5 py-1 text-micro font-medium transition-colors',
                  recipients.includes(r) ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- history tab ---------------- */

function HistoryTab({ history, onRedownload }: {
  history: HistoryRec[];
  onRedownload: (rec: HistoryRec) => void;
}) {
  const columns: Column<HistoryRec>[] = [
    { key: 'report', header: 'Report', render: (r) => <span className="font-medium text-ink-900">{r.report}</span> },
    { key: 'period', header: 'Period', render: (r) => r.period },
    { key: 'format', header: 'Format', render: (r) => <Chip tone={r.format === 'PDF' ? 'navy' : 'accent'}>{r.format}</Chip> },
    {
      key: 'by', header: 'Generated by', render: (r) => r.scheduled
        ? <Chip tone="info">SCHEDULED</Chip>
        : <span className="text-ink-900">{r.by}</span>,
    },
    { key: 'at', header: 'Timestamp', mono: true, render: (r) => fmtDateTimeEAT(r.at) },
    { key: 'rows', header: 'Rows', mono: true, align: 'right', render: (r) => fmtNum(r.rows) },
    { key: 'size', header: 'Size', mono: true, align: 'right', render: (r) => `${fmtNum(r.sizeKb)} KB` },
    {
      key: 'dl', header: '', render: (r) => (
        <Btn className="h-7 px-2 text-micro" onClick={() => onRedownload(r)}><Download size={13} /> Re-download</Btn>
      ),
    },
  ];
  return <DataTable columns={columns} rows={history} pageSize={12} />;
}
