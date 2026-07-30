// FBV FleetOS — /drivers Driver Roster (drivers.md).
// Ranking strip + roster DataTable + compliance banner + add/assign modals.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Columns3, FileSpreadsheet, MessageSquare,
  Search, Trophy, UserPlus, UserX,
} from 'lucide-react';
import {
  AlertBanner, ConfirmDialog, DataTable, Modal, PlateTag, ScoreRing,
  StatusPill, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { useCollection, useLivePositions, add, nextSequence, update } from '@/lib/store';
import { daysUntil, expiryKey, fmtDateEAT, scoreColor } from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type { Driver } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  Avatar, EASE, PageEnter, PageSection, daysLeftLabel, driverDisplayId,
  exportXlsx, hash01, medalFor, uid, vehicleOf,
} from './helpers';

type DerivedStatus = { key: StatusKey | 'accent'; label: string; pulse?: boolean };

function deriveStatus(driver: Driver, livePlates: Map<string, string>): DerivedStatus {
  if (driver.status === 'on-leave') return { key: 'inactive', label: 'ON LEAVE' };
  if (driver.status === 'off-duty') return { key: 'inactive', label: 'OFF DUTY' };
  // driving: on trip when the assigned vehicle is moving live
  if (livePlates.has(driver.id)) return { key: 'accent', label: 'ON TRIP', pulse: true };
  return { key: 'ok', label: 'ON DUTY' };
}

function DutyPill({ s }: { s: DerivedStatus }) {
  if (s.key === 'accent') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium uppercase tracking-[0.02em] text-accent-strong">
        <span className="relative flex h-1.5 w-1.5">
          {s.pulse && <span className="absolute h-full w-full rounded-full bg-accent animate-pulse-live-ring" />}
          <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        {s.label}
      </span>
    );
  }
  return <StatusPill status={s.key} label={s.label} pulse={s.pulse} />;
}

function TrendArrow({ trend, delta }: { trend?: 'up' | 'down' | 'flat'; delta: string }) {
  if (trend === 'up' || trend === 'down') {
    return (
      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }}
        className={cn('inline-flex items-center font-mono text-micro font-semibold',
          trend === 'up' ? 'text-ok-on-soft' : 'text-alert-on-soft')}>
        {trend === 'up' ? '▲' : '▼'}{delta}
      </motion.span>
    );
  }
  return <span className="text-micro text-ink-400">—</span>;
}

const SCORE_BANDS = [
  { key: 'all', label: 'All scores' },
  { key: '90', label: '90–100' },
  { key: '75', label: '75–89' },
  { key: '60', label: '60–74' },
  { key: '0', label: '< 60' },
] as const;

const OPTIONAL_COLS = [
  { key: 'license', label: 'Licence expiry' },
  { key: 'psv', label: 'PSV badge' },
  { key: 'events', label: 'Events 30d' },
  { key: 'trips', label: 'Trips 30d' },
] as const;

export default function Drivers() {
  const navigate = useNavigate();
  const drivers = useCollection('drivers');
  const vehicles = useCollection('vehicles');
  const safetyEvents = useCollection('safetyEvents');
  const trips = useCollection('trips');
  const rewards = useCollection('rewards');
  const live = useLivePositions();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [band, setBand] = useState<string>('all');
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [cols, setCols] = useState<string[]>(['license', 'psv', 'events', 'trips']);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<Driver | null>(null);
  const [deactivateFor, setDeactivateFor] = useState<Driver | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // vehicles currently moving live, keyed by driver id (→ ON TRIP)
  const liveDrivers = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of live) {
      if (p.status === 'moving') {
        const v = vehicles.find((x) => x.id === p.vehicleId);
        if (v?.assignedDriverId) m.set(v.assignedDriverId, v.plate);
      }
    }
    return m;
  }, [live, vehicles]);

  const thirtyDaysAgo = useMemo(() => new Date(`${TODAY}T00:00:00Z`).getTime() - 30 * 86400000, []);
  const events30 = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of safetyEvents) {
      if (new Date(e.at).getTime() >= thirtyDaysAgo) m.set(e.driverId, (m.get(e.driverId) ?? 0) + 1);
    }
    return m;
  }, [safetyEvents, thirtyDaysAgo]);
  const trips30 = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trips) {
      if (new Date(t.startAt).getTime() >= thirtyDaysAgo) m.set(t.driverId, (m.get(t.driverId) ?? 0) + 1);
    }
    return m;
  }, [trips, thirtyDaysAgo]);

  const ranked = useMemo(() => [...drivers].sort((a, b) => b.safetyScore - a.safetyScore), [drivers]);
  const rankOf = useMemo(() => new Map(ranked.map((d, i) => [d.id, i + 1])), [ranked]);
  const trendOf = useMemo(() => new Map(rewards.filter((r) => r.month === '2026-07').map((r) => [r.driverId, r.trend])), [rewards]);
  const deltaOf = (id: string) => (0.8 + hash01(`${id}-delta`) * 2.4).toFixed(1);

  const expiringCount = useMemo(
    () => drivers.filter((d) => Math.min(daysUntil(d.licenseExpiry), daysUntil(d.psvExpiry)) <= 30).length,
    [drivers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter((d) => {
      const veh = vehicleOf(vehicles, d.id);
      const st = deriveStatus(d, liveDrivers);
      if (q && !(`${d.name} ${d.phone} ${veh?.plate ?? ''}`.toLowerCase().includes(q))) return false;
      if (statusFilter !== 'all' && st.label !== statusFilter) return false;
      if (band === '90' && d.safetyScore < 90) return false;
      if (band === '75' && (d.safetyScore < 75 || d.safetyScore >= 90)) return false;
      if (band === '60' && (d.safetyScore < 60 || d.safetyScore >= 75)) return false;
      if (band === '0' && d.safetyScore >= 60) return false;
      if (expiringOnly && Math.min(daysUntil(d.licenseExpiry), daysUntil(d.psvExpiry)) > 30) return false;
      return true;
    });
  }, [ranked, query, statusFilter, band, expiringOnly, vehicles, liveDrivers]);

  const maxEvents = Math.max(1, ...drivers.map((d) => events30.get(d.id) ?? 0));

  const expiryCell = (iso: string) => {
    const days = daysUntil(iso);
    const key = expiryKey(days);
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] tracking-[0.02em] text-ink-900">{fmtDateEAT(iso)}</span>
        <StatusPill status={key} label={daysLeftLabel(days)} />
      </div>
    );
  };

  const columns: Column<Driver>[] = [
    {
      key: 'driver', header: 'Driver', width: '240px',
      render: (d) => (
        <div className="flex items-center gap-2.5 py-1">
          <span className="rounded-full transition-shadow group-hover:ring-2 group-hover:ring-accent">
            <Avatar name={d.name} size={32} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-ink-900">{d.name}</div>
            <div className="font-mono text-[11px] tracking-[0.02em] text-ink-400">{d.phone}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'score', header: 'Safety score', width: '110px',
      render: (d) => (
        <div className="flex items-center gap-2">
          <ScoreRing score={d.safetyScore} size={32} stroke={4} />
          <span className="font-mono text-[12px] font-semibold" style={{ color: scoreColor(d.safetyScore) }}>
            {d.safetyScore.toFixed(1)}
          </span>
        </div>
      ),
    },
    {
      key: 'rank', header: 'Rank', width: '72px',
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[12px] font-semibold text-ink-900">#{rankOf.get(d.id)}</span>
          <TrendArrow trend={trendOf.get(d.id)} delta={deltaOf(d.id)} />
        </div>
      ),
    },
    {
      key: 'vehicle', header: 'Assigned vehicle', width: '130px',
      render: (d) => {
        const v = vehicleOf(vehicles, d.id);
        return v ? <PlateTag plate={v.plate} /> : <span className="text-ink-400">—</span>;
      },
    },
    {
      key: 'status', header: 'Status', width: '110px',
      render: (d) => <DutyPill s={deriveStatus(d, liveDrivers)} />,
    },
  ];
  if (cols.includes('license')) columns.push({ key: 'license', header: 'Licence expiry', width: '190px', render: (d) => expiryCell(d.licenseExpiry) });
  if (cols.includes('psv')) columns.push({ key: 'psv', header: 'PSV badge expiry', width: '190px', render: (d) => expiryCell(d.psvExpiry) });
  if (cols.includes('events')) {
    columns.push({
      key: 'events', header: 'Events 30d', width: '110px',
      render: (d) => {
        const n = events30.get(d.id) ?? 0;
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-ink-900">{n}</span>
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-muted">
              <span className="block h-full rounded-full bg-alert" style={{ width: `${(n / maxEvents) * 100}%` }} />
            </span>
          </div>
        );
      },
    });
  }
  if (cols.includes('trips')) {
    columns.push({
      key: 'trips', header: 'Trips 30d', width: '80px', mono: true,
      render: (d) => <span className="font-semibold">{trips30.get(d.id) ?? 0}</span>,
    });
  }

  const doExport = () => {
    exportXlsx(`drivers-${TODAY}.xlsx`, filtered.map((d) => ({
      'Driver ID': driverDisplayId(d),
      Name: d.name,
      Phone: d.phone,
      'Safety score': d.safetyScore.toFixed(1),
      Rank: rankOf.get(d.id),
      Vehicle: vehicleOf(vehicles, d.id)?.plate ?? '',
      Status: deriveStatus(d, liveDrivers).label,
      'Licence no': d.licenseNo,
      'Licence expiry': d.licenseExpiry,
      'PSV expiry': d.psvExpiry,
      'Events 30d': events30.get(d.id) ?? 0,
      'Trips 30d': trips30.get(d.id) ?? 0,
      'Reward points': d.rewardPoints,
    })), 'Drivers');
  };

  return (
    <PageEnter>
      {/* header */}
      <PageSection className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Drivers</h1>
          <p className="text-[13px] text-ink-400">{drivers.length} drivers · ranked by July 2026 safety score</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doExport}
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 shadow-card transition-all hover:bg-surface-muted active:scale-[0.97]">
            <FileSpreadsheet size={15} /> Export Excel
          </button>
          <button type="button" onClick={() => setAddOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
            <UserPlus size={15} /> Add driver
          </button>
        </div>
      </PageSection>

      {/* compliance banner */}
      {expiringCount > 0 && !bannerDismissed && (
        <PageSection>
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
            className="overflow-hidden rounded-card shadow-card">
            <AlertBanner
              severity="warn"
              message={`${expiringCount} driver document${expiringCount === 1 ? '' : 's'} expire within 30 days — review vault`}
              actionLabel="Review vault →"
              onAction={() => navigate('/documents')}
              onDismiss={() => setBannerDismissed(true)}
            />
          </motion.div>
        </PageSection>
      )}

      {/* ranking strip */}
      <PageSection>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {ranked.map((d, i) => {
            const medal = medalFor(i + 1);
            const veh = vehicleOf(vehicles, d.id);
            const ev = events30.get(d.id) ?? 0;
            return (
              <motion.button
                key={d.id}
                type="button"
                onClick={() => navigate(`/drivers/${d.id}`)}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: i * 0.06, ease: EASE }}
                className="group flex w-[220px] shrink-0 flex-col items-center gap-2 rounded-card border border-border bg-white p-4 text-center shadow-card transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop"
              >
                <span className="font-mono text-[26px] font-bold leading-8 tracking-[-0.01em]" style={{ color: medal?.hex ?? '#46586D' }}>
                  #{i + 1}
                </span>
                <span className="rounded-full transition-shadow group-hover:ring-2 group-hover:ring-accent">
                  <Avatar name={d.name} size={44} />
                </span>
                <span className="w-full truncate text-[14px] font-semibold text-ink-900">{d.name}</span>
                <ScoreRing score={d.safetyScore} size={64} stroke={6} />
                <span className="flex items-center gap-2">
                  {veh ? <PlateTag plate={veh.plate} /> : <span className="text-micro text-ink-400">No vehicle</span>}
                  <TrendArrow trend={trendOf.get(d.id)} delta={deltaOf(d.id)} />
                </span>
                <span className={cn('text-micro', ev === 0 ? 'text-ok-on-soft' : 'text-alert-on-soft')}>
                  {ev === 0 ? '0 events this month' : `${ev} harsh events · 30d`}
                </span>
              </motion.button>
            );
          })}
          {/* CTA card */}
          <motion.button
            type="button"
            onClick={() => navigate('/rewards')}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: ranked.length * 0.06, ease: EASE }}
            className="flex w-[220px] shrink-0 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-accent/60 bg-accent-soft/20 p-4 text-center transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent-soft/40"
          >
            <Trophy size={22} className="text-accent-strong" />
            <span className="text-[13px] font-semibold text-accent-strong">View rewards & Driver of the Month →</span>
          </motion.button>
        </div>
      </PageSection>

      {/* table tools */}
      <PageSection className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, plate…"
            className="h-9 w-64 rounded-lg border border-border bg-white pl-9 pr-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-2 text-[13px] text-ink-900 outline-none focus:border-accent">
          <option value="all">All statuses</option>
          <option>ON DUTY</option>
          <option>ON TRIP</option>
          <option>OFF DUTY</option>
          <option>ON LEAVE</option>
        </select>
        <select value={band} onChange={(e) => setBand(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-2 text-[13px] text-ink-900 outline-none focus:border-accent">
          {SCORE_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <button type="button" onClick={() => setExpiringOnly(!expiringOnly)}
          className={cn('h-9 rounded-lg border px-3 text-[13px] font-medium transition-colors',
            expiringOnly ? 'border-warn bg-warn-soft text-warn-on-soft' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
          Expiring docs ≤ 30 d
        </button>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setColPickerOpen(!colPickerOpen)}
              className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">
              <Columns3 size={14} /> Columns
            </button>
            {colPickerOpen && (
              <div className="absolute right-0 top-10 z-30 w-48 rounded-lg border border-border bg-white p-2 shadow-pop"
                onMouseLeave={() => setColPickerOpen(false)}>
                {OPTIONAL_COLS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-900 hover:bg-surface-muted">
                    <input type="checkbox" checked={cols.includes(c.key)}
                      onChange={(e) => setCols(e.target.checked ? [...cols, c.key] : cols.filter((x) => x !== c.key))}
                      className="h-3.5 w-3.5 accent-[#06B6D4]" />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setCompact(!compact)}
            className={cn('h-9 rounded-lg border px-3 text-[13px] font-medium transition-colors',
              compact ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            Compact
          </button>
        </div>
      </PageSection>

      {/* roster table */}
      <PageSection>
        <DataTable
          columns={columns}
          rows={filtered}
          compact={compact}
          pageSize={compact ? 16 : 10}
          onRowClick={(d) => navigate(`/drivers/${d.id}`)}
          rowActions={(d) => [
            { label: 'View 360°', onClick: () => navigate(`/drivers/${d.id}`) },
            { label: 'Assign vehicle', onClick: () => setAssignFor(d) },
            { label: 'Message', icon: MessageSquare, onClick: () => toast({ title: 'Message queued', body: `SMS to ${d.name} (${d.phone})`, status: 'info' }) },
            { label: 'Documents', onClick: () => navigate(`/drivers/${d.id}?tab=documents`) },
            { label: 'Deactivate', icon: UserX, danger: true, onClick: () => setDeactivateFor(d) },
          ]}
          empty={<div className="py-6 text-center text-[13px] text-ink-400">No drivers match these filters.</div>}
        />
      </PageSection>

      <AddDriverModal open={addOpen} onClose={() => setAddOpen(false)} />
      <AssignVehicleModal driver={assignFor} onClose={() => setAssignFor(null)} />
      <ConfirmDialog
        open={!!deactivateFor}
        onClose={() => setDeactivateFor(null)}
        onConfirm={() => {
          if (!deactivateFor) return;
          update('drivers', deactivateFor.id, { status: 'off-duty' });
          toast({ title: 'Driver deactivated', body: `${deactivateFor.name} is now off duty.`, status: 'warn' });
        }}
        title="Deactivate driver"
        body={deactivateFor ? `Deactivate ${deactivateFor.name}? They will lose mobile app access and their vehicle assignment stays in place.` : ''}
        confirmLabel="Deactivate"
        destructive
      />
    </PageEnter>
  );
}

/* ---------------- Add driver modal ---------------- */

function AddDriverModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '+254 7', licenseNo: 'DL-KE-', licenseExpiry: '', psvExpiry: '', pin: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    const errs: Record<string, string> = {};
    if (form.name.trim().split(' ').length < 2) errs.name = 'Enter full name (first & last)';
    if (!/^\+254 7\d{2} \d{3} \d{3}$/.test(form.phone)) errs.phone = 'Format: +254 7XX XXX XXX';
    if (!/^DL-KE-\d{4,}$/.test(form.licenseNo)) errs.licenseNo = 'Format: DL-KE-882114';
    if (!form.licenseExpiry) errs.licenseExpiry = 'Required';
    if (!form.psvExpiry) errs.psvExpiry = 'Required';
    if (!/^\d{4}$/.test(form.pin)) errs.pin = '4-digit PIN for mobile sign-in';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    const seq = await nextSequence('driver');
    const n = Number(seq.split('-').pop());
    add('drivers', {
      id: n > 0 ? `drv-${String(n).padStart(2, '0')}` : uid('drv'),
      name: form.name.trim(),
      phone: form.phone,
      licenseNo: form.licenseNo,
      licenseExpiry: form.licenseExpiry,
      psvExpiry: form.psvExpiry,
      safetyScore: 85,
      status: 'off-duty',
      hiredAt: TODAY,
      rewardPoints: 0,
      badges: [],
    });
    setSaving(false);
    toast({ title: 'Driver added', body: `${form.name} · ${seq}`, status: 'ok' });
    setForm({ name: '', phone: '+254 7', licenseNo: 'DL-KE-', licenseExpiry: '', psvExpiry: '', pin: '' });
    onClose();
  };

  const field = (label: string, key: keyof typeof form, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-600">
      {label}
      <input value={form[key]} onChange={set(key)} {...props}
        className={cn('h-9 rounded-lg border px-3 text-[13px] text-ink-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
          errors[key] ? 'border-alert' : 'border-border', props?.type === 'date' || key === 'licenseNo' || key === 'phone' || key === 'pin' ? 'font-mono' : '')} />
      {errors[key] && <span className="text-micro text-alert-on-soft">{errors[key]}</span>}
    </label>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add driver"
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" onClick={save} disabled={saving}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
            {saving ? 'Saving…' : 'Save driver'}
          </button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {field('Full name', 'name', { placeholder: 'Amani Kilonzo' })}
        {field('Phone', 'phone', { placeholder: '+254 712 345 678' })}
        {field('Licence no', 'licenseNo', { placeholder: 'DL-KE-882114' })}
        {field('Licence expiry', 'licenseExpiry', { type: 'date', min: TODAY })}
        {field('PSV badge expiry', 'psvExpiry', { type: 'date', min: TODAY })}
        {field('Mobile role PIN', 'pin', { placeholder: '4 digits', maxLength: 4, inputMode: 'numeric' })}
      </div>
      <p className="mt-3 text-micro text-ink-400">New drivers start with a provisional 85.0 safety score and appear at the bottom of the July league.</p>
    </Modal>
  );
}

/* ---------------- Assign vehicle modal ---------------- */

function AssignVehicleModal({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const vehicles = useCollection('vehicles');
  const [vehicleId, setVehicleId] = useState('');
  const [effective, setEffective] = useState(TODAY);
  const free = vehicles.filter((v) => !v.assignedDriverId && v.tripStatus === 'active');
  return (
    <Modal open={!!driver} onClose={onClose} title={`Assign vehicle — ${driver?.name ?? ''}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!vehicleId}
            onClick={() => {
              if (!driver || !vehicleId) return;
              const prev = vehicles.find((v) => v.assignedDriverId === driver.id);
              if (prev) update('vehicles', prev.id, { assignedDriverId: null });
              update('vehicles', vehicleId, { assignedDriverId: driver.id });
              const v = vehicles.find((x) => x.id === vehicleId);
              toast({ title: 'Vehicle assigned', body: `${v?.plate} → ${driver.name} from ${fmtDateEAT(effective)}`, status: 'ok' });
              setVehicleId('');
              onClose();
            }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
            Assign
          </button>
        </>
      }>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-600">
          Vehicle (unassigned only)
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
            className="h-9 rounded-lg border border-border bg-white px-2 font-mono text-[13px] uppercase outline-none focus:border-accent">
            <option value="">— select vehicle —</option>
            {free.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.model}</option>)}
          </select>
        </label>
        {free.length === 0 && <p className="text-[12px] text-ink-400">All active vehicles are currently assigned.</p>}
        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-600">
          Effective date
          <input type="date" value={effective} min={TODAY} onChange={(e) => setEffective(e.target.value)}
            className="h-9 rounded-lg border border-border px-3 font-mono text-[13px] outline-none focus:border-accent" />
        </label>
        {driver && vehicleOf(vehicles, driver.id) && (
          <p className="text-[12px] text-warn-on-soft">
            Current vehicle {vehicleOf(vehicles, driver.id)!.plate} will be unassigned.
          </p>
        )}
      </div>
    </Modal>
  );
}
