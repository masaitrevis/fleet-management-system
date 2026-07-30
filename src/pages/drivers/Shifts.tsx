// FBV FleetOS — /shifts Driving Hours & Shift Logs (shifts.md).
// Desktop: Today Board + Log & Compliance tabs. Mobile: "My shifts" clock-in view.
// Kenyan rules: 8h driving limit · 45 min break per 5h · 11h daily rest.

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlarmClock, Bell, Clock, Coffee, FileSpreadsheet, Info, MoonStar,
  Pencil, Play, Square, TriangleAlert,
} from 'lucide-react';
import {
  DataTable, DonutChartCard, EmptyState, KPIStatCard, Modal, StatusPill,
  Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { useCollection, useKV, kvSet, add } from '@/lib/store';
import { fmtDateEAT, fmtTimeEAT } from '@/lib/format';
import type { Driver, Shift } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, EASE, exportXlsx, fmtMin, hash01, nowIso, uid, useMedia, useTick } from './helpers';

interface ShiftRules { driveLimitMin: number; breakMin: number; restMin: number }
const DEFAULT_RULES: ShiftRules = { driveLimitMin: 480, breakMin: 45, restMin: 660 };

interface TodayState {
  mode: 'driving' | 'break' | 'off';
  drivingMin: number;
  breakTakenMin: number;
  continuousMin: number;
  restEndedAgoMin: number;
  warn: 'amber' | 'red' | null;
  warnText: string | null;
}

function deriveToday(d: Driver, rules: ShiftRules, tickMin: number): TodayState {
  const h = hash01(`${d.id}-today`);
  if (d.status !== 'driving') {
    return {
      mode: 'off', drivingMin: 0, breakTakenMin: 0, continuousMin: 0,
      restEndedAgoMin: Math.round(660 + h * 300), warn: null, warnText: null,
    };
  }
  // Seeded warning scenarios (shifts.md): Peter Otieno near limit, Daniel Ouma break overdue.
  if (d.id === 'drv-03') {
    const driving = 461 + tickMin;
    return {
      mode: 'driving', drivingMin: driving, breakTakenMin: 30, continuousMin: 200 + tickMin,
      restEndedAgoMin: 684, warn: 'amber', warnText: `${Math.max(0, rules.driveLimitMin - driving)} min to limit`,
    };
  }
  if (d.id === 'drv-09') {
    return {
      mode: 'driving', drivingMin: 330 + tickMin, breakTakenMin: 0, continuousMin: 330 + tickMin,
      restEndedAgoMin: 690, warn: 'red', warnText: `Break overdue: ${fmtMin(330 + tickMin)} continuous driving`,
    };
  }
  const onBreak = h > 0.78;
  const driving = Math.round(120 + h * 300) + (onBreak ? 0 : tickMin);
  const continuous = onBreak ? 0 : Math.round(60 + h * 160) + tickMin;
  return {
    mode: onBreak ? 'break' : 'driving',
    drivingMin: driving,
    breakTakenMin: onBreak ? Math.round(15 + h * 30) : Math.round(h * 30),
    continuousMin: continuous,
    restEndedAgoMin: Math.round(640 + h * 160),
    warn: null,
    warnText: null,
  };
}

/** 24h mini-gantt segments derived from today's state. */
function ganttSegments(s: TodayState): { from: number; to: number; kind: 'drive' | 'break' | 'off' }[] {
  if (s.mode === 'off') return [{ from: 0, to: 24, kind: 'off' }];
  const nowH = 14.6; // demo "now" mid-afternoon EAT
  const startH = Math.max(0, nowH - (s.drivingMin + s.breakTakenMin) / 60 - 1);
  const segs: { from: number; to: number; kind: 'drive' | 'break' | 'off' }[] = [{ from: 0, to: startH, kind: 'off' }];
  const driveH = s.drivingMin / 60;
  if (s.mode === 'break') {
    segs.push({ from: startH, to: startH + driveH, kind: 'drive' });
    segs.push({ from: startH + driveH, to: nowH, kind: 'break' });
  } else {
    const breakH = s.breakTakenMin / 60;
    const mid = startH + driveH * 0.55;
    segs.push({ from: startH, to: mid, kind: 'drive' });
    if (breakH > 0.15) segs.push({ from: mid, to: mid + breakH, kind: 'break' });
    segs.push({ from: mid + breakH, to: nowH, kind: 'drive' });
  }
  segs.push({ from: nowH, to: 24, kind: 'off' });
  return segs;
}

const GANTT_COLOR = { drive: 'bg-accent', break: 'bg-warn', off: 'bg-border' } as const;

export default function Shifts() {
  const isDesktop = useMedia('(min-width: 768px)');
  return isDesktop ? <DesktopShifts /> : <MobileShifts />;
}

/* ================================================================== */
/* Desktop — Today Board + Log & Compliance                            */
/* ================================================================== */

function DesktopShifts() {
  const drivers = useCollection('drivers');
  const shifts = useCollection('shifts');
  const rules = (useKV('shiftRules') as ShiftRules | undefined) ?? DEFAULT_RULES;
  const [tab, setTab] = useState('today');
  const [rulesOpen, setRulesOpen] = useState(false);
  const tick = useTick(60000);
  const tickMin = tick; // +1 driving minute per minute elapsed (live demo)

  const states = useMemo(
    () => new Map(drivers.map((d) => [d.id, deriveToday(d, rules, tickMin)])),
    [drivers, rules, tickMin],
  );

  const onShift = drivers.filter((d) => states.get(d.id)?.mode !== 'off').length;
  const approaching = drivers.filter((d) => states.get(d.id)?.warn).length;
  const weekAgo = new Date(`${TODAY}T00:00:00Z`).getTime() - 7 * 86400000;
  const violations7d = shifts.filter((s) => s.restWarning && new Date(s.startAt).getTime() >= weekAgo).length;
  const avgShift = shifts.length > 0 ? Math.round(shifts.reduce((s, x) => s + x.drivingMin, 0) / shifts.length) : 0;

  const notify = (d: Driver, s: TodayState) => {
    add('alerts', {
      id: uid('al'),
      type: 'shift_violation',
      severity: s.warn === 'red' ? 'critical' : 'major',
      message: `${s.warnText} — ${d.name}`,
      entityRef: { kind: 'driver', id: d.id, label: d.name },
      at: nowIso(),
      read: false, acknowledged: false,
    });
    add('audit', {
      id: uid('aud'), at: nowIso(),
      userId: 'usr-02', userName: 'Wanjiru Maina', action: 'create',
      collection: 'alerts', recordId: d.id,
      summary: `Rest warning notification sent to ${d.name} (${s.warnText})`,
    });
    toast({ title: 'Driver notified', body: `In-app alert sent to ${d.name}. Logged to audit trail.`, status: 'ok' });
  };

  return (
    <div className="mx-auto flex max-w-[1520px] flex-col gap-4 p-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Shifts & Driving Hours</h1>
          <p className="text-[13px] text-ink-400">Duty time with rest-period warnings · Kenyan labour-rule limits</p>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05, ease: EASE }}
        className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KPIStatCard label="On shift now" value={onShift} icon={Clock} />
        <KPIStatCard label="Approaching limits" value={approaching} icon={TriangleAlert}
          delta={approaching > 0 ? 'action needed' : 'clear'} deltaGood={approaching === 0} />
        <KPIStatCard label="Rest violations 7d" value={violations7d} icon={MoonStar}
          delta="rest < 11 h" deltaGood={violations7d === 0} />
        <KPIStatCard label="Avg shift length" value={avgShift} format={(v) => fmtMin(Math.round(v))} icon={AlarmClock} />
      </motion.div>

      <Tabs tabs={[{ key: 'today', label: 'Today Board' }, { key: 'log', label: 'Log & Compliance' }]}
        active={tab} onChange={setTab} />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}>
          {tab === 'today' ? (
            <div className="grid grid-cols-3 gap-3 max-xl:grid-cols-2 max-md:grid-cols-1">
              {drivers.map((d, i) => {
                const s = states.get(d.id)!;
                const pill = s.warn === 'red'
                  ? <StatusPill status="alert" label="LIMIT NEAR" pulse />
                  : s.mode === 'driving'
                    ? <StatusPill status="ok" label="DRIVING" pulse />
                    : s.mode === 'break'
                      ? <StatusPill status="warn" label="ON BREAK" />
                      : <StatusPill status="inactive" label="OFF DUTY" />;
                const pct = Math.min(1.15, s.drivingMin / rules.driveLimitMin);
                const barColor = pct > 1 ? 'bg-alert' : pct > 0.75 ? 'bg-warn' : 'bg-ok';
                return (
                  <motion.div key={d.id}
                    initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
                    className={cn('relative overflow-hidden rounded-card border border-border bg-white p-4 shadow-card transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop',
                      s.warn && 'pl-5')}>
                    {s.warn && <span className={cn('absolute inset-y-0 left-0 w-1', s.warn === 'red' ? 'bg-alert' : 'bg-warn')} />}
                    <div className="flex items-center gap-2.5">
                      <Avatar name={d.name} size={34} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-ink-900">{d.name}</div>
                        <div className="font-mono text-[11px] text-ink-400">{d.id.toUpperCase()}</div>
                      </div>
                      {pill}
                    </div>

                    {/* 24h mini-gantt */}
                    <div className="mt-3 flex h-3 overflow-hidden rounded-full" title="Today · 24 h timeline">
                      {ganttSegments(s).map((g, k) => (
                        <motion.span key={k}
                          initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                          transition={{ duration: 0.6, delay: 0.2 + k * 0.08 }}
                          className={cn('h-full origin-left', GANTT_COLOR[g.kind])}
                          style={{ width: `${((g.to - g.from) / 24) * 100}%` }} />
                      ))}
                    </div>
                    <div className="mt-0.5 flex justify-between font-mono text-[9px] text-ink-400">
                      <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
                    </div>

                    <div className="mt-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between font-mono text-[12px] text-ink-900">
                        <span>Driving {fmtMin(s.drivingMin)} / {fmtMin(rules.driveLimitMin)}</span>
                        <span className="text-ink-400">{Math.round(pct * 100)}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                        <motion.span className={cn('block h-full rounded-full', barColor)}
                          animate={{ width: `${Math.min(100, pct * 100)}%` }} transition={{ duration: 0.4 }} />
                      </div>
                      <div className="flex items-center justify-between font-mono text-[11px] text-ink-600">
                        <span className="flex items-center gap-1"><Coffee size={11} /> Break {s.breakTakenMin} / {rules.breakMin} min</span>
                        <span className={cn('flex items-center gap-1', s.restEndedAgoMin >= rules.restMin ? 'text-ok-on-soft' : 'text-alert-on-soft')}>
                          <MoonStar size={11} /> Last rest ended {fmtMin(s.restEndedAgoMin)} ago {s.restEndedAgoMin >= rules.restMin ? '✓' : '⚠'}
                        </span>
                      </div>
                    </div>

                    {s.warn && (
                      <div className={cn('mt-3 flex items-center gap-2 rounded-lg px-3 py-2',
                        s.warn === 'red' ? 'bg-alert-soft text-alert-on-soft' : 'bg-warn-soft text-warn-on-soft')}>
                        <TriangleAlert size={14} />
                        <span className="flex-1 text-[12px] font-semibold">{s.warnText}</span>
                        <button type="button" onClick={() => notify(d, s)}
                          className="flex h-7 items-center gap-1 rounded-lg bg-white/80 px-2.5 text-[11px] font-bold text-ink-900 shadow-card hover:bg-white">
                          <Bell size={11} /> Notify driver
                        </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <LogCompliance rules={rules} onEditRules={() => setRulesOpen(true)} />
          )}
        </motion.div>
      </AnimatePresence>

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} rules={rules} />
    </div>
  );
}

/* ---------------- TAB 2 — Log & Compliance ---------------- */

function LogCompliance({ rules, onEditRules }: { rules: ShiftRules; onEditRules: () => void }) {
  const shifts = useCollection('shifts');
  const drivers = useCollection('drivers');
  const [driverFilter, setDriverFilter] = useState('');
  const [flagFilter, setFlagFilter] = useState('');

  type Row = Shift & { flags: string[]; restBeforeMin: number; breakMin2: number; dutyMin: number; source: string };
  const rows = useMemo<Row[]>(() => shifts.map((s) => {
    const h = hash01(s.id);
    const flags: string[] = [];
    const restBeforeMin = s.restWarning ? Math.round(480 + h * 150) : Math.round(660 + h * 240);
    const breakMin2 = Math.round(s.drivingMin * (0.08 + h * 0.08));
    if (s.drivingMin > rules.driveLimitMin) flags.push('OVERTIME');
    if (restBeforeMin < rules.restMin) flags.push('REST <11H');
    if (breakMin2 < rules.breakMin && s.drivingMin > 300) flags.push('BREAK SHORT');
    const start = new Date(s.startAt).getTime();
    const end = s.endAt ? new Date(s.endAt).getTime() : start + s.drivingMin * 60000;
    return {
      ...s, flags, restBeforeMin, breakMin2,
      dutyMin: Math.round((end - start) / 60000),
      source: h > 0.12 ? 'auto-telematics' : 'manual',
    };
  }), [shifts, rules]);

  const filtered = rows.filter((r) =>
    (!driverFilter || r.driverId === driverFilter) &&
    (!flagFilter || r.flags.includes(flagFilter)));

  const flagged = rows.filter((r) => r.flags.length > 0).length;
  const compliantPct = rows.length > 0 ? ((rows.length - flagged) / rows.length) * 100 : 100;
  const repeat = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => r.flags.forEach(() => m.set(r.driverId, (m.get(r.driverId) ?? 0) + 1)));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [rows]);

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', mono: true, width: '100px', render: (r) => fmtDateEAT(r.startAt) },
    {
      key: 'driver', header: 'Driver', render: (r) => {
        const d = drivers.find((x) => x.id === r.driverId);
        return (
          <span className="flex items-center gap-2">
            {d && <Avatar name={d.name} size={26} />}
            <span className="text-[13px] font-medium text-ink-900">{d?.name ?? '—'}</span>
          </span>
        );
      },
    },
    { key: 'start', header: 'Start', mono: true, width: '70px', render: (r) => fmtTimeEAT(r.startAt) },
    { key: 'end', header: 'End', mono: true, width: '70px', render: (r) => (r.endAt ? fmtTimeEAT(r.endAt) : '—') },
    { key: 'drive', header: 'Driving', mono: true, align: 'right', width: '90px', render: (r) => fmtMin(r.drivingMin) },
    { key: 'break', header: 'Break', mono: true, align: 'right', width: '80px', render: (r) => fmtMin(r.breakMin2) },
    { key: 'duty', header: 'Total duty', mono: true, align: 'right', width: '90px', render: (r) => fmtMin(r.dutyMin) },
    {
      key: 'rest', header: 'Rest before', width: '130px',
      render: (r) => (
        <span className={cn('font-mono text-[12px] font-semibold', r.restBeforeMin >= rules.restMin ? 'text-ok-on-soft' : 'text-alert-on-soft')}>
          {fmtMin(r.restBeforeMin)} {r.restBeforeMin >= rules.restMin ? '✓' : '⚠'}
        </span>
      ),
    },
    {
      key: 'flags', header: 'Flags', width: '170px',
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.flags.length === 0 && <span className="text-ink-400">—</span>}
          {r.flags.map((f) => (
            <motion.span key={f} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.16 }}
              className={cn('rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold',
                f === 'REST <11H' ? 'bg-alert-soft text-alert-on-soft'
                  : f === 'BREAK SHORT' ? 'bg-warn-soft text-warn-on-soft'
                    : 'bg-info-soft text-info-on-soft')}>
              {f}
            </motion.span>
          ))}
        </span>
      ),
    },
    { key: 'src', header: 'Source', width: '120px', render: (r) => <span className="font-mono text-[11px] text-ink-400">{r.source}</span> },
  ];

  const exportLog = () => exportXlsx('shift-log-jul-2026.xlsx', filtered.map((r) => ({
    Date: fmtDateEAT(r.startAt),
    Driver: drivers.find((x) => x.id === r.driverId)?.name ?? '',
    Start: fmtTimeEAT(r.startAt),
    End: r.endAt ? fmtTimeEAT(r.endAt) : '',
    'Driving min': r.drivingMin,
    'Break min': r.breakMin2,
    'Duty min': r.dutyMin,
    'Rest before min': r.restBeforeMin,
    Flags: r.flags.join('; '),
    Source: r.source,
  })), 'Shift log');

  return (
    <div className="flex gap-4 max-xl:flex-col">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-white px-2 text-[13px] outline-none focus:border-accent">
            <option value="">All drivers</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-white px-2 text-[13px] outline-none focus:border-accent">
            <option value="">All flags</option>
            <option>OVERTIME</option>
            <option>REST &lt;11H</option>
            <option>BREAK SHORT</option>
          </select>
          <button type="button" onClick={exportLog}
            className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 shadow-card hover:bg-surface-muted">
            <FileSpreadsheet size={15} /> Export Excel
          </button>
        </div>
        <DataTable columns={columns} rows={filtered} pageSize={12} compact
          empty={<EmptyState icon={Clock} title="No shifts" hint="Shift logs are captured automatically from telematics." />} />
      </div>

      {/* right rail */}
      <div className="flex w-80 shrink-0 flex-col gap-3 max-xl:w-full">
        <div className="rounded-card border border-border bg-white p-4 shadow-card">
          <h3 className="text-[15px] font-semibold text-ink-900">July 2026 — rest compliance {compliantPct.toFixed(1)}%</h3>
          <DonutChartCard
            data={[
              { name: 'Compliant', value: rows.length - flagged, color: '#16A34A' },
              { name: 'Flagged', value: flagged, color: '#DC2626' },
            ]}
            height={180}
            className="mt-1"
          />
          <div className="mt-2 border-t border-border/60 pt-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">Repeat flags</div>
            {repeat.length === 0 && <p className="text-[12px] text-ink-400">None — clean month.</p>}
            {repeat.map(([drvId, n]) => {
              const d = drivers.find((x) => x.id === drvId);
              return (
                <div key={drvId} className="flex items-center justify-between py-1 text-[13px]">
                  <span className="text-ink-900">{d?.name ?? drvId}</span>
                  <span className="font-mono text-[12px] text-alert-on-soft">{n} flag{n === 1 ? '' : 's'}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-card border border-border bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-ink-900">Rest rules</h3>
            <button type="button" onClick={onEditRules}
              className="flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-[11px] font-medium text-ink-600 hover:bg-surface-muted">
              <Pencil size={11} /> Edit
            </button>
          </div>
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between"><span className="text-ink-600">Daily driving limit</span><span className="font-mono font-semibold text-ink-900">{fmtMin(rules.driveLimitMin)}</span></div>
            <div className="text-micro text-ink-400">Extendable to 10 h, twice per week</div>
            <div className="flex justify-between"><span className="text-ink-600">Break per 5 h driving</span><span className="font-mono font-semibold text-ink-900">{rules.breakMin} min</span></div>
            <div className="flex justify-between"><span className="text-ink-600">Daily rest</span><span className="font-mono font-semibold text-ink-900">{fmtMin(rules.restMin)}</span></div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-accent-soft/40 px-3 py-2 text-[12px] text-ink-600">
            <Info size={13} className="text-accent-strong" /> Alerts fire in-app + to driver phone.
          </div>
        </div>
      </div>
    </div>
  );
}

function RulesModal({ open, onClose, rules }: { open: boolean; onClose: () => void; rules: ShiftRules }) {
  const [form, setForm] = useState(rules);
  return (
    <Modal open={open} onClose={onClose} title="Edit rest rules"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button"
            onClick={() => {
              kvSet('shiftRules', form);
              add('audit', {
                id: uid('aud'), at: nowIso(),
                userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
                collection: 'settings', recordId: 'shiftRules',
                summary: `Rest rules updated — driving ${fmtMin(form.driveLimitMin)}, break ${form.breakMin} min, rest ${fmtMin(form.restMin)}`,
              });
              toast({ title: 'Rest rules updated', body: 'Logged to audit trail.', status: 'ok' });
              onClose();
            }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
            Save rules
          </button>
        </>
      }>
      <div className="flex flex-col gap-3">
        {([
          ['driveLimitMin', 'Daily driving limit (min)'],
          ['breakMin', 'Break per 5 h driving (min)'],
          ['restMin', 'Daily rest (min)'],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-[13px] font-medium text-ink-600">
            {label}
            <input type="number" min={0} value={form[k]}
              onChange={(e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }))}
              className="h-9 rounded-lg border border-border px-3 font-mono text-[13px] outline-none focus:border-accent" />
          </label>
        ))}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Mobile — "My shifts"                                                */
/* ================================================================== */

interface MyShift { on: boolean; since: string | null; drivingMin: number; breakMin: number; onBreak: boolean }

function MobileShifts() {
  const { user } = useAuth();
  const drivers = useCollection('drivers');
  const shifts = useCollection('shifts');
  const rules = (useKV('shiftRules') as ShiftRules | undefined) ?? DEFAULT_RULES;
  const my = (useKV('myShift') as MyShift | undefined) ?? { on: false, since: null, drivingMin: 0, breakMin: 0, onBreak: false };
  const tick = useTick(30000);
  const me = drivers.find((d) => d.name === user?.name) ?? drivers[0];

  const liveDrive = my.drivingMin + (my.on && !my.onBreak ? tick * 0.5 : 0);
  const liveBreak = my.breakMin + (my.on && my.onBreak ? tick * 0.5 : 0);
  const remaining = Math.max(0, rules.driveLimitMin - liveDrive);

  const myHistory = shifts.filter((s) => s.driverId === me?.id).slice(0, 7);

  const clockIn = () => {
    kvSet('myShift', { on: true, since: nowIso(), drivingMin: 0, breakMin: 0, onBreak: false });
    toast({ title: `Shift started ${fmtTimeEAT(nowIso())} EAT.`, status: 'ok' });
  };
  const clockOut = () => {
    if (me) {
      add('shifts', {
        id: uid('shf'),
        driverId: me.id,
        vehicleId: null,
        startAt: my.since ?? nowIso(),
        endAt: nowIso(),
        drivingMin: Math.round(liveDrive),
        restWarning: liveDrive > rules.driveLimitMin,
      });
      add('audit', {
        id: uid('aud'), at: nowIso(),
        userId: String(user?.id ?? 'usr-05'), userName: user?.name ?? me.name, action: 'create',
        collection: 'shifts', recordId: me.id,
        summary: `Shift ended — ${fmtMin(liveDrive)} driving · ${me.name}`,
      });
    }
    kvSet('myShift', { on: false, since: null, drivingMin: 0, breakMin: 0, onBreak: false });
    toast({ title: `Shift ended ${fmtTimeEAT(nowIso())} EAT.`, body: `${fmtMin(liveDrive)} driving logged.`, status: 'info' });
  };
  const toggleBreak = () => {
    kvSet('myShift', { ...my, drivingMin: Math.round(liveDrive), breakMin: Math.round(liveBreak), onBreak: !my.onBreak });
    toast({ title: my.onBreak ? 'Break ended — back on duty.' : 'Break started.', status: my.onBreak ? 'ok' : 'warn' });
  };

  const since = my.since ? new Date(my.since) : null;
  const startH = since ? since.getUTCHours() + since.getUTCMinutes() / 60 : 0;
  const nowH = Math.min(24, startH + (liveDrive + liveBreak) / 60 + 0.5);

  return (
    <div className="flex flex-col items-center gap-4 px-4 pb-8 pt-6">
      {/* clock-in/out button */}
      <motion.button type="button" whileTap={{ scale: 0.96 }}
        onClick={my.on ? clockOut : clockIn}
        className={cn('relative flex h-40 w-40 flex-col items-center justify-center rounded-full border-8 shadow-pop transition-colors duration-400',
          my.on ? 'border-ok bg-ok-soft text-ok-on-soft' : 'border-accent bg-accent-soft/40 text-accent-strong')}>
        {my.on ? <Square size={26} /> : <Play size={30} className="ml-1" />}
        <span className="mt-1 text-[13px] font-bold">{my.on ? 'CLOCK OUT' : 'CLOCK IN'}</span>
        {my.on && since && <span className="font-mono text-[10px]">since {fmtTimeEAT(my.since!)}</span>}
      </motion.button>

      {/* counters */}
      <div className="grid w-full grid-cols-3 gap-2">
        {[
          { l: 'Driving', v: fmtMin(liveDrive) },
          { l: 'Break', v: fmtMin(liveBreak) },
          { l: 'Remaining', v: fmtMin(remaining) },
        ].map((c) => (
          <div key={c.l} className="rounded-card border border-border bg-white px-3 py-2.5 text-center shadow-card">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">{c.l}</div>
            <AnimatePresence mode="popLayout">
              <motion.div key={c.v} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
                className={cn('font-mono text-[15px] font-bold', c.l === 'Remaining' && remaining < 60 ? 'text-alert-on-soft' : 'text-ink-900')}>
                {c.v}
              </motion.div>
            </AnimatePresence>
          </div>
        ))}
      </div>

      {/* today timeline */}
      <div className="w-full rounded-card border border-border bg-white p-4 shadow-card">
        <div className="mb-1.5 flex justify-between text-[12px] font-medium text-ink-600">
          <span>Today</span>
          <span className="font-mono text-[11px] text-ink-400">{fmtDateEAT(TODAY)}</span>
        </div>
        <div className="relative h-3 overflow-hidden rounded-full bg-surface-muted">
          {my.on && (
            <>
              <motion.span className="absolute inset-y-0 rounded-l-full bg-accent"
                style={{ left: `${(startH / 24) * 100}%`, width: `${Math.max(2, ((nowH - startH - liveBreak / 60) / 24) * 100)}%` }}
                layout transition={{ duration: 0.4 }} />
              {my.onBreak && (
                <span className="absolute inset-y-0 bg-warn"
                  style={{ left: `${(nowH / 24) * 100 - 2}%`, width: '4%' }} />
              )}
            </>
          )}
        </div>
        <div className="mt-0.5 flex justify-between font-mono text-[9px] text-ink-400">
          <span>00:00</span><span>12:00</span><span>24:00</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1 text-micro text-ink-400">
          <MoonStar size={11} /> Last rest ended 11 h 24 m ago ✓ · limit {fmtMin(rules.driveLimitMin)} driving
        </div>
      </div>

      {/* break toggle */}
      {my.on && (
        <button type="button" onClick={toggleBreak}
          className={cn('h-12 w-full rounded-card border-2 text-[14px] font-bold transition-all active:scale-[0.98]',
            my.onBreak ? 'border-ok bg-ok-soft text-ok-on-soft' : 'border-warn bg-warn-soft text-warn-on-soft')}>
          {my.onBreak ? 'End break — back on duty' : 'Start break'}
        </button>
      )}

      {/* history */}
      <div className="w-full rounded-card border border-border bg-white p-4 shadow-card">
        <div className="mb-2 text-[13px] font-semibold text-ink-900">Last 7 days</div>
        {myHistory.length === 0 && <p className="text-[12px] text-ink-400">No shifts logged yet.</p>}
        <div className="flex flex-col">
          {myHistory.map((s) => (
            <div key={s.id} className="flex items-center justify-between border-b border-border/60 py-2 last:border-0">
              <div>
                <div className="text-[13px] font-medium text-ink-900">{fmtDateEAT(s.startAt)}</div>
                <div className="font-mono text-[11px] text-ink-400">
                  {fmtTimeEAT(s.startAt)} – {s.endAt ? fmtTimeEAT(s.endAt) : '…'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-semibold text-ink-900">{fmtMin(s.drivingMin)}</span>
                {s.restWarning
                  ? <StatusPill status="alert" label="REST <11H" />
                  : <StatusPill status="ok" label="OK" />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
