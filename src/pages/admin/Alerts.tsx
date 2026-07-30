// /alerts — Alert Center & Notification Rules (design/alerts.md)

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, Bell, Check, CheckCheck, Clock, Cpu, Download, FileText,
  Fuel, Gauge, Mail, MapPin, MoonStar, Plus, WifiOff, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  ConfirmDialog, DataTable, Drawer, KPIStatCard, Modal, PlateTag,
  StatusPill, Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { getById, kvGet, kvSet, update, useCollection } from '@/lib/store';
import type { AlertRec, AlertType, Role, Severity } from '@/lib/types';
import { nextSequence, add } from '@/lib/store';
import { fmtDateTimeEAT, fmtTimeEAT, SEVERITY_TO_KEY } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  Btn, Card, Chip, EASE, PageShell, currentUser, demoNowIso, exportXlsx,
  inputCls, logAudit, selectCls, withinDemoDays,
} from './common';

/* ---------------- metadata ---------------- */

const TYPE_META: Record<AlertType, { label: string; icon: LucideIcon }> = {
  speeding: { label: 'Speeding', icon: Gauge },
  fuel_anomaly: { label: 'Fuel anomaly', icon: Fuel },
  geofence: { label: 'Geofence', icon: MapPin },
  harsh_event: { label: 'Harsh event', icon: AlertTriangle },
  maintenance_due: { label: 'Maintenance due', icon: Wrench },
  document_expiry: { label: 'Document expiring', icon: FileText },
  dtc: { label: 'Fault code (DTC)', icon: Cpu },
  shift_violation: { label: 'Compliance (shifts)', icon: Clock },
  device_offline: { label: 'Device offline', icon: WifiOff },
};

const SEV_DOT: Record<Severity, string> = {
  critical: 'bg-alert', major: 'bg-warn', minor: 'bg-info', info: 'bg-inactive',
};

const ALL_TYPES = Object.keys(TYPE_META) as AlertType[];
const ROLES: Role[] = ['Admin', 'Fleet Manager', 'Dispatcher', 'Mechanic', 'Driver', 'Read-only'];

/* ---------------- rules ---------------- */

interface RuleItem {
  id: string;
  name: string;
  type: AlertType;
  condition: string;
  scope: string[];
  severity: Severity;
  inApp: boolean;
  email: boolean;
  recipients: Role[];
  active: boolean;
}

const DEFAULT_RULES: RuleItem[] = [
  { id: 'rule-01', name: 'Speeding over posted limit', type: 'speeding', condition: 'speed > posted limit by 10 km/h for 60 s', scope: ['All vehicles'], severity: 'critical', inApp: true, email: true, recipients: ['Admin', 'Fleet Manager'], active: true },
  { id: 'rule-02', name: 'Geofence after-hours movement', type: 'geofence', condition: 'enter/exit between 19:00–06:00', scope: ['Mombasa Port', 'JKIA Cargo'], severity: 'major', inApp: true, email: true, recipients: ['Admin', 'Fleet Manager'], active: true },
  { id: 'rule-03', name: 'Fuel volume anomaly', type: 'fuel_anomaly', condition: 'litres > tank capacity × 1.05', scope: ['All vehicles'], severity: 'major', inApp: true, email: true, recipients: ['Fleet Manager'], active: true },
  { id: 'rule-04', name: 'Document expiry radar', type: 'document_expiry', condition: 'expires ≤ 30 days', scope: ['All vehicles', 'All drivers'], severity: 'major', inApp: true, email: true, recipients: ['Fleet Manager', 'Read-only'], active: true },
  { id: 'rule-05', name: 'Service due soon', type: 'maintenance_due', condition: 'next service ≤ 500 km', scope: ['All vehicles'], severity: 'minor', inApp: true, email: false, recipients: ['Mechanic', 'Fleet Manager'], active: true },
  { id: 'rule-06', name: 'DTC fault codes', type: 'dtc', condition: 'any DTC raised by device', scope: ['All vehicles'], severity: 'minor', inApp: true, email: false, recipients: ['Mechanic'], active: true },
  { id: 'rule-07', name: 'Device offline', type: 'device_offline', condition: 'no heartbeat > 2 h', scope: ['All vehicles'], severity: 'major', inApp: true, email: true, recipients: ['Admin', 'Fleet Manager'], active: true },
  { id: 'rule-08', name: 'Shift rest violation', type: 'shift_violation', condition: 'driving > 9 h or rest < 8 h', scope: ['All drivers'], severity: 'major', inApp: true, email: true, recipients: ['Fleet Manager'], active: true },
];

function useRules(): [RuleItem[], (r: RuleItem[]) => void] {
  const stored = kvGet('alertRules') as RuleItem[] | undefined;
  const [rules, setRules] = useState<RuleItem[]>(stored ?? DEFAULT_RULES);
  const save = (r: RuleItem[]) => { setRules(r); kvSet('alertRules', r); };
  return [rules, save];
}

/** Rough backtest: how often a rule of this type fired in the last 30 days. */
function backtestCount(type: AlertType, alerts: AlertRec[], safetyCount: number): number {
  const a = alerts.filter((x) => x.type === type && withinDemoDays(x.at, 30)).length;
  if (type === 'speeding' || type === 'harsh_event') return a + safetyCount;
  return Math.max(a, 1);
}

/* ---------------- page ---------------- */

export default function AlertsPage() {
  const alerts = useCollection('alerts');
  const safetyEvents = useCollection('safetyEvents');
  const [rules] = useRules();
  const [tab, setTab] = useState('inbox');
  const [markAllOpen, setMarkAllOpen] = useState(false);
  const [selected, setSelected] = useState<AlertRec | null>(null);
  const [snoozed, setSnoozed] = useState<Record<string, string>>({});

  // filters
  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<AlertType>>(new Set());
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read' | 'acknowledged'>('all');
  const [range, setRange] = useState<7 | 30 | 9999>(30);

  const unread = alerts.filter((a) => !a.read).length;
  const criticalToday = alerts.filter((a) => a.severity === 'critical' && a.at.slice(0, 10) === TODAY).length;
  const activeRules = rules.filter((r) => r.active).length;

  const filtered = useMemo(() => {
    const out = alerts.filter((a) => {
      if (sevFilter.size && !sevFilter.has(a.severity)) return false;
      if (typeFilter.size && !typeFilter.has(a.type)) return false;
      if (statusFilter === 'unread' && a.read) return false;
      if (statusFilter === 'read' && !a.read) return false;
      if (statusFilter === 'acknowledged' && !a.acknowledged) return false;
      if (range !== 9999 && !withinDemoDays(a.at, range)) return false;
      return true;
    });
    return out.sort((x, y) => {
      const sx = snoozed[x.id] ? 1 : 0;
      const sy = snoozed[y.id] ? 1 : 0;
      if (sx !== sy) return sy - sx; // snoozed pinned to top
      return y.at.localeCompare(x.at);
    });
  }, [alerts, sevFilter, typeFilter, statusFilter, range, snoozed]);

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    apply(next);
  };

  const acknowledge = (a: AlertRec, note?: string) => {
    update('alerts', a.id, { acknowledged: true, read: true });
    logAudit('update', 'alerts', a.id, `Acknowledged alert — ${a.message}${note ? ` (note: ${note})` : ''}`,
      [{ field: 'acknowledged', before: false, after: true }]);
    toast({ title: 'Alert acknowledged', body: a.entityRef.label, status: 'ok' });
  };

  const snooze = (a: AlertRec) => {
    setSnoozed((s) => ({ ...s, [a.id]: demoNowIso() }));
    toast({ title: 'Snoozed for 1 h', body: 'The alert returns to the top when it re-fires.', status: 'inactive' });
  };

  const markAllRead = () => {
    alerts.filter((a) => !a.read).forEach((a) => update('alerts', a.id, { read: true }));
    logAudit('update', 'alerts', 'bulk', `Marked ${unread} alerts as read`);
    toast({ title: 'Inbox cleared', body: `${unread} alerts marked as read.`, status: 'ok' });
  };

  const exportInbox = () => {
    const rows = filtered.map((a) => ({
      Severity: a.severity.toUpperCase(),
      Type: TYPE_META[a.type].label,
      Message: a.message,
      Entity: a.entityRef.label,
      'Time (EAT)': fmtDateTimeEAT(a.at),
      Status: a.acknowledged ? 'ACKNOWLEDGED' : a.read ? 'READ' : 'UNREAD',
    }));
    const n = exportXlsx('alerts-jul-2026.xlsx', [{ name: 'Alerts', rows }]);
    logAudit('export', 'alerts', 'inbox', `Exported alert inbox (${n} rows, Excel)`);
    toast({ title: 'Export ready', body: `alerts-jul-2026.xlsx · ${n} rows`, status: 'ok' });
  };

  return (
    <PageShell className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Alert Center</h1>
        <div className="flex items-center gap-2">
          <Btn onClick={() => setMarkAllOpen(true)} disabled={unread === 0}>
            <CheckCheck size={15} /> Mark all read
          </Btn>
          <Btn variant="navy" onClick={exportInbox}><Download size={15} /> Export</Btn>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPIStatCard label="Unread" value={unread} icon={Bell} delta={unread > 0 ? 'needs attention' : 'inbox zero'} deltaGood={unread === 0} />
        <KPIStatCard label="Critical today" value={criticalToday} icon={AlertTriangle} delta={criticalToday > 0 ? 'act now' : 'none'} deltaGood={criticalToday === 0} />
        <KPIStatCard label="Avg acknowledge time" value={22} format={(v) => `${Math.round(v)} min`} icon={Clock} delta="▼ 6 min vs Jun" deltaGood />
        <KPIStatCard label="Rules active" value={activeRules} icon={Wrench} />
      </div>

      <Tabs
        tabs={[
          { key: 'inbox', label: 'Inbox', count: unread },
          { key: 'rules', label: 'Rules', count: activeRules },
          { key: 'log', label: 'Notification log' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          {tab === 'inbox' && (
            <div className="flex gap-4">
              {/* filter rail */}
              <motion.aside
                initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE }}
                className="hidden w-60 shrink-0 flex-col gap-4 md:flex"
              >
                <Card className="p-3">
                  <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Severity</div>
                  {(['critical', 'major', 'minor', 'info'] as Severity[]).map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] capitalize text-ink-900 hover:bg-surface-muted">
                      <input type="checkbox" checked={sevFilter.has(s)} onChange={() => toggle(sevFilter, s, setSevFilter)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
                      <span className={cn('h-2 w-2 rounded-full', SEV_DOT[s])} />
                      {s}
                      <span className="ml-auto font-mono text-micro text-ink-400">{alerts.filter((a) => a.severity === s).length}</span>
                    </label>
                  ))}
                </Card>
                <Card className="p-3">
                  <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Type</div>
                  {ALL_TYPES.map((t) => {
                    const M = TYPE_META[t];
                    return (
                      <label key={t} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink-900 hover:bg-surface-muted">
                        <input type="checkbox" checked={typeFilter.has(t)} onChange={() => toggle(typeFilter, t, setTypeFilter)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
                        <M.icon size={14} className="text-ink-400" />
                        {M.label}
                        <span className="ml-auto font-mono text-micro text-ink-400">{alerts.filter((a) => a.type === t).length}</span>
                      </label>
                    );
                  })}
                </Card>
                <Card className="p-3">
                  <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Status</div>
                  {(['all', 'unread', 'read', 'acknowledged'] as const).map((s) => (
                    <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] capitalize text-ink-900 hover:bg-surface-muted">
                      <input type="radio" name="alert-status" checked={statusFilter === s} onChange={() => setStatusFilter(s)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
                      {s}
                    </label>
                  ))}
                  <div className="mt-3 mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Date range</div>
                  <div className="flex gap-1">
                    {([['24 h', 7], ['7 d', 7], ['30 d', 30], ['All', 9999]] as [string, 7 | 30 | 9999][]).slice(1).map(([label, v]) => (
                      <button key={label} type="button" onClick={() => setRange(v)}
                        className={cn('rounded-full px-2.5 py-1 text-micro font-medium', range === v ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft hover:opacity-80')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </Card>
              </motion.aside>

              {/* alert list */}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {filtered.length === 0 && (
                  <Card className="p-10 text-center text-[13px] text-ink-400">No alerts match these filters.</Card>
                )}
                {filtered.map((a, i) => {
                  const M = TYPE_META[a.type];
                  const vehicle = a.entityRef.kind === 'vehicle' ? getById('vehicles', a.entityRef.id) : undefined;
                  const driver = vehicle?.assignedDriverId ? getById('drivers', vehicle.assignedDriverId) : undefined;
                  const isLive = a.id.startsWith('al-live');
                  return (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: Math.min(i * 0.025, 0.4), ease: EASE }}
                      onClick={() => setSelected(a)}
                      className={cn(
                        'group relative flex h-16 cursor-pointer items-center gap-3 overflow-hidden rounded-card border border-border px-3 shadow-card transition-colors',
                        a.read ? 'bg-surface-muted/60 text-ink-600' : 'bg-white',
                        isLive && 'animate-alert-flash',
                      )}
                    >
                      {!a.read && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV_DOT[a.severity], a.severity === 'critical' && !a.read && 'animate-pulse')} />
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                        <M.icon size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={cn('truncate text-[13px] leading-5', !a.read ? 'font-semibold text-ink-900' : 'text-ink-600')}>
                          {a.message}
                        </div>
                        <div className="flex items-center gap-2 text-micro text-ink-400">
                          {vehicle && <PlateTag plate={vehicle.plate} />}
                          {driver && <span>{driver.name}</span>}
                          {snoozed[a.id] && <Chip tone="warn">snoozed</Chip>}
                          <span className="hidden items-center gap-1 sm:inline-flex"><Check size={11} /> SENT in-app ✓ · email ✓</span>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[12px] text-ink-400">
                        {a.at.slice(0, 10) === TODAY ? fmtTimeEAT(a.at) : fmtDateTimeEAT(a.at).split(',')[0]}
                      </span>
                      <div
                        className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!a.acknowledged && (
                          <Btn className="h-7 px-2 text-micro" variant="accent" onClick={() => acknowledge(a)}><Check size={13} /> Acknowledge</Btn>
                        )}
                        {!snoozed[a.id] && (
                          <Btn className="h-7 px-2 text-micro" onClick={() => snooze(a)}><MoonStar size={13} /> Snooze 1 h</Btn>
                        )}
                        <Btn className="h-7 px-2 text-micro" variant="ghost" onClick={() => setSelected(a)}>Open context →</Btn>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'rules' && <RulesTab alerts={alerts} safetyCount30={safetyEvents.filter((e) => (e.type === 'speeding' || e.type === 'harsh_braking') && withinDemoDays(e.at, 30)).length} />}
          {tab === 'log' && <NotifLogTab alerts={alerts} onOpen={setSelected} />}
        </motion.div>
      </AnimatePresence>

      <AlertDrawer
        alert={selected}
        onClose={() => setSelected(null)}
        onAcknowledge={acknowledge}
        onSnooze={snooze}
      />

      <ConfirmDialog
        open={markAllOpen}
        onClose={() => setMarkAllOpen(false)}
        onConfirm={markAllRead}
        title="Mark all alerts as read?"
        body={`${unread} unread alerts will be marked read. Critical alerts remain visible until acknowledged.`}
        confirmLabel="Mark all read"
      />
    </PageShell>
  );
}

/* ---------------- alert detail drawer ---------------- */

function AlertDrawer({ alert, onClose, onAcknowledge, onSnooze }: {
  alert: AlertRec | null;
  onClose: () => void;
  onAcknowledge: (a: AlertRec, note?: string) => void;
  onSnooze: (a: AlertRec) => void;
}) {
  const auditTrail = useCollection('audit');
  const [note, setNote] = useState('');
  const [creatingWo, setCreatingWo] = useState(false);
  const closeAndReset = () => { setNote(''); onClose(); };
  if (!alert) return <Drawer open={false} onClose={onClose}>{null}</Drawer>;

  const M = TYPE_META[alert.type];
  const vehicle = alert.entityRef.kind === 'vehicle' ? getById('vehicles', alert.entityRef.id) : undefined;
  const driver = vehicle?.assignedDriverId ? getById('drivers', vehicle.assignedDriverId)
    : alert.entityRef.kind === 'driver' ? getById('drivers', alert.entityRef.id) : undefined;
  const auditLines = auditTrail.filter((e) => e.collection === 'alerts' && e.recordId === alert.id);
  const canCreateWo = alert.type === 'maintenance_due' || alert.type === 'fuel_anomaly' || alert.type === 'dtc';

  const createWo = async () => {
    if (!vehicle) return;
    setCreatingWo(true);
    try {
      const number = await nextSequence('wo');
      const wo = add('workOrders', {
        id: `wo-${Date.now().toString(36)}`,
        number,
        vehicleId: vehicle.id,
        source: alert.type === 'dtc' ? 'dtc' : 'manual',
        status: 'open',
        priority: alert.severity === 'critical' ? 'high' : 'medium',
        title: `${TYPE_META[alert.type].label} — ${alert.entityRef.label}`,
        items: [],
        laborCostKes: 0,
        vendorId: null,
        openedAt: demoNowIso(),
        dueAt: null,
        completedAt: null,
        notes: `Created from alert: ${alert.message}`,
      });
      logAudit('create', 'workOrders', wo.id, `Created WO ${number} from alert (${alert.entityRef.label})`);
      toast({ title: 'Work order created', body: `${number} · ${vehicle.plate}`, status: 'ok' });
      onClose();
    } finally {
      setCreatingWo(false);
    }
  };

  return (
    <Drawer
      open={!!alert}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><M.icon size={16} className="text-accent-strong" /> {M.label}</span>}
      footer={
        <div className="flex flex-col gap-2">
          {!alert.acknowledged && (
            <>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Acknowledge note (optional)…"
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
              <div className="flex gap-2">
                <Btn variant="accent" className="flex-1" onClick={() => { onAcknowledge(alert, note || undefined); closeAndReset(); }}>
                  <Check size={15} /> Acknowledge
                </Btn>
                <Btn onClick={() => { onSnooze(alert); closeAndReset(); }}><MoonStar size={15} /> Snooze 1 h</Btn>
              </div>
            </>
          )}
          {canCreateWo && vehicle && (
            <Btn variant="navy" onClick={createWo} disabled={creatingWo}>
              <Wrench size={15} /> {creatingWo ? 'Creating…' : 'Create work order'}
            </Btn>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <div className={cn('text-[15px] font-semibold leading-[22px]', alert.read ? 'text-ink-600' : 'text-ink-900')}>{alert.message}</div>
          <div className="mt-1 font-mono text-[12px] text-ink-400">{fmtDateTimeEAT(alert.at, true)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={SEVERITY_TO_KEY[alert.severity]} label={alert.severity} pulse={alert.severity === 'critical' && !alert.read} />
          <StatusPill status={alert.acknowledged ? 'ok' : alert.read ? 'inactive' : 'warn'} label={alert.acknowledged ? 'acknowledged' : alert.read ? 'read' : 'unread'} />
        </div>

        <Card className="flex flex-col gap-2 p-3">
          <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Linked entities</div>
          <div className="flex flex-wrap gap-2">
            {vehicle && (
              <Link to={`/vehicles/${vehicle.id}`} className="transition-transform hover:-translate-y-px"><PlateTag plate={vehicle.plate} /></Link>
            )}
            {driver && (
              <Link to={`/drivers/${driver.id}`} className="rounded-full bg-accent-soft px-2.5 py-1 text-micro font-medium text-accent-strong hover:opacity-80">
                {driver.name} →
              </Link>
            )}
            {alert.entityRef.kind === 'driver' && (
              <Chip tone="accent">{alert.entityRef.label}</Chip>
            )}
          </div>
          {vehicle && (
            <div className="grid grid-cols-2 gap-2 pt-1 text-[12px] text-ink-600">
              <span>Odometer</span><span className="text-right font-mono">{vehicle.odometerKm.toLocaleString('en-KE')} km</span>
              <span>Status</span><span className="text-right font-mono uppercase">{vehicle.status}</span>
              <span>Depot</span><span className="text-right">{vehicle.depot}</span>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-1.5 p-3">
          <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Delivery</div>
          <div className="flex items-center gap-2 text-[13px] text-ink-600"><Check size={14} className="text-ok" /> in-app — sent</div>
          <div className="flex items-center gap-2 text-[13px] text-ink-600"><Mail size={14} className="text-ok" /> email — logged (simulated)</div>
        </Card>

        {auditLines.length > 0 && (
          <Card className="flex flex-col gap-1.5 p-3">
            <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Audit</div>
            {auditLines.map((e) => (
              <div key={e.id} className="text-[12px] text-ink-600">
                <span className="font-medium">{e.userName}</span> — {e.summary}
                <span className="block font-mono text-micro text-ink-400">{fmtDateTimeEAT(e.at)}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </Drawer>
  );
}

/* ---------------- rules tab ---------------- */

function RulesTab({ alerts, safetyCount30 }: { alerts: AlertRec[]; safetyCount30: number }) {
  const [rules, saveRules] = useRules();
  const [newOpen, setNewOpen] = useState(false);
  const me = currentUser();

  const prefsKey = 'alertPrefsUser';
  const [prefs, setPrefs] = useState<Record<string, { inApp: boolean; email: boolean }>>(() => {
    const stored = kvGet(prefsKey) as Record<string, { inApp: boolean; email: boolean }> | undefined;
    if (stored) return stored;
    const init: Record<string, { inApp: boolean; email: boolean }> = {};
    ALL_TYPES.forEach((t) => { init[t] = { inApp: true, email: t === 'speeding' || t === 'device_offline' || t === 'fuel_anomaly' }; });
    return init;
  });

  const toggleRule = (id: string, patch: Partial<RuleItem>) => {
    const next = rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    saveRules(next);
    const r = rules.find((x) => x.id === id)!;
    logAudit('update', 'alerts', id, `Rule "${r.name}" ${patch.active !== undefined ? (patch.active ? 'activated' : 'deactivated') : 'channels updated'}`);
  };

  const savePrefs = () => {
    kvSet(prefsKey, prefs);
    logAudit('update', 'alerts', 'prefs', `${me.name} updated personal notification preferences`);
    toast({ title: 'Preferences saved', body: 'Your notification matrix was updated.', status: 'ok' });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] text-ink-600">Fleet-wide rules — evaluated for every vehicle, logged to the notification log.</div>
        <Btn variant="accent" onClick={() => setNewOpen(true)}><Plus size={15} /> New rule</Btn>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full border-collapse text-table">
          <thead>
            <tr className="border-b border-border bg-surface-muted/70 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
              <th className="h-9 px-3">Rule</th>
              <th className="h-9 px-3">Condition</th>
              <th className="h-9 px-3">Scope</th>
              <th className="h-9 px-3">Severity</th>
              <th className="h-9 px-3">Channels</th>
              <th className="h-9 px-3">Recipients</th>
              <th className="h-9 px-3 text-center">Active</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const M = TYPE_META[r.type];
              return (
                <motion.tr key={r.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, delay: i * 0.03, ease: EASE }}
                  className="border-b border-border/60 transition-colors hover:bg-surface-muted">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent-strong"><M.icon size={14} /></span>
                      <span className="font-medium text-ink-900">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-ink-600">{r.condition}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">{r.scope.map((s) => <Chip key={s} tone="navy" className="bg-navy-50 text-navy-800">{s}</Chip>)}</div>
                  </td>
                  <td className="px-3 py-2.5"><StatusPill status={SEVERITY_TO_KEY[r.severity]} label={r.severity} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-2 text-[12px]">
                      <label className="flex items-center gap-1 text-ink-600">
                        <input type="checkbox" checked={r.inApp} onChange={(e) => toggleRule(r.id, { inApp: e.target.checked })} className="h-3.5 w-3.5 accent-[#06B6D4]" /> in-app
                      </label>
                      <label className="flex items-center gap-1 text-ink-600">
                        <input type="checkbox" checked={r.email} onChange={(e) => toggleRule(r.id, { email: e.target.checked })} className="h-3.5 w-3.5 accent-[#06B6D4]" /> email
                      </label>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">{r.recipients.map((x) => <Chip key={x} tone="accent">{x}</Chip>)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button type="button" onClick={() => toggleRule(r.id, { active: !r.active })}
                      className={cn('relative h-5 w-9 rounded-full transition-colors duration-150 ease-snap', r.active ? 'bg-accent' : 'bg-inactive-soft')}>
                      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150', r.active ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* per-user preferences */}
      <Card className="p-4">
        <div className="mb-1 text-[15px] font-semibold text-ink-900">Your notification preferences</div>
        <div className="mb-3 text-[12px] text-ink-400">Admins see fleet-wide rules above. This matrix is saved for {me.name} only.</div>
        <div className="grid grid-cols-[1fr,70px,70px] items-center gap-2 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
          <span>Alert type</span><span className="text-center">In-app</span><span className="text-center">Email</span>
        </div>
        {ALL_TYPES.map((t) => {
          const M = TYPE_META[t];
          return (
            <div key={t} className="grid grid-cols-[1fr,70px,70px] items-center gap-2 border-b border-border/60 py-2 last:border-0">
              <span className="flex items-center gap-2 text-[13px] text-ink-900"><M.icon size={14} className="text-ink-400" /> {M.label}</span>
              <span className="text-center">
                <input type="checkbox" checked={prefs[t]?.inApp ?? true}
                  onChange={(e) => setPrefs((p) => ({ ...p, [t]: { ...p[t], inApp: e.target.checked } }))}
                  className="h-4 w-4 accent-[#06B6D4]" />
              </span>
              <span className="text-center">
                <input type="checkbox" checked={prefs[t]?.email ?? false}
                  onChange={(e) => setPrefs((p) => ({ ...p, [t]: { inApp: p[t]?.inApp ?? true, email: e.target.checked } }))}
                  className="h-4 w-4 accent-[#06B6D4]" />
              </span>
            </div>
          );
        })}
        <div className="mt-3 flex justify-end"><Btn variant="accent" onClick={savePrefs}>Save preferences</Btn></div>
      </Card>

      <NewRuleModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        backtest={(t) => backtestCount(t, alerts, safetyCount30)}
        onCreate={(rule) => {
          saveRules([...rules, rule]);
          logAudit('create', 'alerts', rule.id, `Created alert rule "${rule.name}" (${rule.condition})`);
          toast({ title: 'Rule created', body: rule.name, status: 'ok' });
        }}
      />
    </div>
  );
}

function NewRuleModal({ open, onClose, onCreate, backtest }: {
  open: boolean;
  onClose: () => void;
  onCreate: (r: RuleItem) => void;
  backtest: (t: AlertType) => number;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AlertType>('speeding');
  const [threshold, setThreshold] = useState('10');
  const [duration, setDuration] = useState('60');
  const [afterHours, setAfterHours] = useState(false);
  const [severity, setSeverity] = useState<Severity>('major');
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(true);
  const [recipients, setRecipients] = useState<Role[]>(['Fleet Manager']);

  const condition = type === 'geofence'
    ? `enter/exit${afterHours ? ' between 19:00–06:00' : ''}`
    : type === 'speeding'
      ? `speed > posted limit by ${threshold} km/h for ${duration} s`
      : TYPE_META[type].label.toLowerCase();

  const fired = backtest(type);

  const create = () => {
    onCreate({
      id: `rule-${Date.now().toString(36)}`,
      name: name || `${TYPE_META[type].label} rule`,
      type, condition, scope: ['All vehicles'], severity, inApp, email, recipients, active: true,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New alert rule" wide
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="accent" onClick={create}>Create rule</Btn>
        </>
      }>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-ink-600">
          Rule name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${TYPE_META[type].label} rule`} className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-ink-600">
            Type
            <select value={type} onChange={(e) => setType(e.target.value as AlertType)} className={selectCls}>
              {ALL_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-600">
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} className={selectCls}>
              {(['critical', 'major', 'minor', 'info'] as Severity[]).map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </label>
        </div>

        {type === 'speeding' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] text-ink-600">
              Over limit by (km/h)
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="numeric" className={cn(inputCls, 'font-mono')} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] text-ink-600">
              For duration (s)
              <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" className={cn(inputCls, 'font-mono')} />
            </label>
          </div>
        )}
        {type === 'geofence' && (
          <label className="flex items-center gap-2 text-[13px] text-ink-600">
            <input type="checkbox" checked={afterHours} onChange={(e) => setAfterHours(e.target.checked)} className="h-4 w-4 accent-[#06B6D4]" />
            After hours only (19:00–06:00)
          </label>
        )}

        <div className="rounded-lg bg-surface-muted px-3 py-2 font-mono text-[12px] text-ink-600">{condition}</div>

        <div className="flex items-center gap-4 text-[13px] text-ink-600">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Channels</span>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} className="h-4 w-4 accent-[#06B6D4]" /> in-app</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="h-4 w-4 accent-[#06B6D4]" /> email-log</label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Recipients</span>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map((r) => (
              <button key={r} type="button"
                onClick={() => setRecipients((cur) => cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r])}
                className={cn('rounded-full px-2.5 py-1 text-micro font-medium transition-colors',
                  recipients.includes(r) ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft hover:opacity-80')}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <motion.div
          key={`${type}-${fired}`}
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25, ease: EASE }}
          className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-[13px] font-medium text-accent-strong"
        >
          <Gauge size={15} /> Would have fired {fired}× in the last 30 days
        </motion.div>
      </div>
    </Modal>
  );
}

/* ---------------- notification log tab ---------------- */

interface NotifRow {
  id: string;
  to: string;
  subject: string;
  type: AlertType | 'report';
  sentAt: string;
  delivered: boolean;
  alertId?: string;
}

function NotifLogTab({ alerts, onOpen }: { alerts: AlertRec[]; onOpen: (a: AlertRec) => void }) {
  const rows: NotifRow[] = useMemo(() => {
    const extra = (kvGet('notifLog') as NotifRow[] | undefined) ?? [];
    const derived: NotifRow[] = alerts.map((a) => ({
      id: `nlog-${a.id}`,
      to: a.severity === 'critical' ? 'Admin, Fleet Manager' : 'Fleet Manager',
      subject: `[${a.severity.toUpperCase()}] ${a.message}`,
      type: a.type,
      sentAt: a.at,
      delivered: true,
      alertId: a.id,
    }));
    return [...extra, ...derived].sort((x, y) => y.sentAt.localeCompare(x.sentAt));
  }, [alerts]);

  const columns: Column<NotifRow>[] = [
    { key: 'to', header: 'To', render: (r) => <span className="text-ink-900">{r.to}</span> },
    {
      key: 'subject', header: 'Subject', render: (r) => (
        <span className="flex items-center gap-2">
          <Mail size={13} className="shrink-0 text-ink-400" />
          <span className="truncate font-medium text-ink-900">{r.subject}</span>
        </span>
      ),
    },
    {
      key: 'type', header: 'Type', render: (r) => (
        <Chip tone="accent">{r.type === 'report' ? 'Report' : TYPE_META[r.type as AlertType].label}</Chip>
      ),
    },
    { key: 'sent', header: 'Sent', mono: true, render: (r) => fmtDateTimeEAT(r.sentAt) },
    { key: 'delivery', header: 'Delivery', render: (r) => <StatusPill status={r.delivered ? 'ok' : 'warn'} label={r.delivered ? 'delivered' : 'queued'} /> },
    {
      key: 'related', header: '', render: (r) => r.alertId ? (
        <Btn className="h-7 px-2 text-micro" variant="ghost" onClick={() => {
          const a = alerts.find((x) => x.id === r.alertId);
          if (a) onOpen(a);
        }}>Related alert →</Btn>
      ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-lg bg-info-soft px-3 py-2 text-[13px] font-medium text-info-on-soft">
        <Mail size={15} /> Emails are simulated and logged here (no real SMTP in demo).
      </div>
      <DataTable columns={columns} rows={rows} pageSize={14} />
    </div>
  );
}
