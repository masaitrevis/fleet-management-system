// /settings — Company Profile, Numbering, Backup & Danger Zone (design/settings.md)

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2, Check, DatabaseBackup, Download, FileDigit, Loader2, Lock,
  Bell, Pause, Play, RotateCcw, Settings2, ShieldCheck, TriangleAlert,
  Upload,
} from 'lucide-react';
import { ConfirmDialog, Modal, toast } from '@/components/shared';
import {
  clearAllData, exportJSON, importJSON, kvGet, kvSet, resetToSeed,
  useCollection, useFleetStore, useKV, useLiveStore,
} from '@/lib/store';
import { startSim, stopSim } from '@/lib/sim';
import type { AlertType } from '@/lib/types';
import { fmtDateTimeEAT, fmtNum } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  Btn, Card, Chip, EASE, PageShell, SectionTitle, currentUser, demoNowIso,
  downloadText, inputCls, logAudit,
} from './common';

/* ---------------- settings nav ---------------- */

const SECTIONS = [
  { id: 'company', label: 'Company profile', icon: Building2 },
  { id: 'preferences', label: 'Preferences', icon: Settings2 },
  { id: 'numbering', label: 'Document numbering', icon: FileDigit },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'backup', label: 'Data & backup', icon: DatabaseBackup },
  { id: 'danger', label: 'Danger zone', icon: TriangleAlert },
] as const;

const ALERT_TYPES: { key: AlertType; label: string }[] = [
  { key: 'speeding', label: 'Speeding' },
  { key: 'geofence', label: 'Geofence' },
  { key: 'harsh_event', label: 'Harsh event' },
  { key: 'fuel_anomaly', label: 'Fuel anomaly' },
  { key: 'document_expiry', label: 'Document expiring' },
  { key: 'maintenance_due', label: 'Maintenance due' },
  { key: 'dtc', label: 'Fault code (DTC)' },
  { key: 'device_offline', label: 'Device offline' },
  { key: 'shift_violation', label: 'Shift violation' },
];

const SEQ_META = [
  { kind: 'wo' as const, entity: 'Work order', prefix: 'FBV-WO-' },
  { kind: 'job' as const, entity: 'Job', prefix: 'FBV-JOB-' },
  { kind: 'driver' as const, entity: 'Driver', prefix: 'FBV-DRV-' },
  { kind: 'vehicle' as const, entity: 'Vehicle', prefix: 'FBV-VEH-' },
];

export default function SettingsPage() {
  const profile = useKV('profile');
  const settings = useKV('settings');
  const collections = useFleetStore((s) => s.collections);
  const simRunning = useLiveStore((s) => s.running);
  const vehicles = useCollection('vehicles');
  const workOrders = useCollection('workOrders');
  const trips = useCollection('trips');
  const me = currentUser();
  const isAdmin = me.role === 'Admin';

  const [active, setActive] = useState<string>('company');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const obs = new IntersectionObserver(
      (ents) => {
        ents.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [isAdmin]);

  /* ----- company profile form ----- */
  const extras = (kvGet('companyExtras') as { tradeName?: string; kraPin?: string } | undefined) ?? {};
  const [form, setForm] = useState({
    name: profile.name, tradeName: extras.tradeName ?? 'FBV Logistics',
    kraPin: extras.kraPin ?? 'P051XXXXXXZ', address: profile.address,
    phone: profile.phone, email: profile.email,
  });
  const [savedFlash, setSavedFlash] = useState(false);

  const saveProfile = () => {
    kvSet('profile', { ...profile, name: form.name, address: form.address, phone: form.phone, email: form.email });
    kvSet('companyExtras', { tradeName: form.tradeName, kraPin: form.kraPin });
    logAudit('update', 'settings', 'profile', `Updated company profile (${form.name})`, [
      { field: 'name', before: profile.name, after: form.name },
      { field: 'phone', before: profile.phone, after: form.phone },
    ]);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 900);
    toast({ title: 'Profile saved', body: 'Company profile updated · logged to audit trail', status: 'ok' });
  };

  /* ----- preferences ----- */
  const [dateFormat, setDateFormat] = useState<string>((kvGet('dateFormat') as string | undefined) ?? 'dmy-text');
  const [landing, setLanding] = useState<string>((kvGet('landingPage') as string | undefined) ?? 'dashboard');
  const [tickRate, setTickRate] = useState<number>((kvGet('simTickRate') as number | undefined) ?? 2);
  const [speedMult, setSpeedMult] = useState<number>((kvGet('simSpeedMult') as number | undefined) ?? 2);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const doReset = async () => {
    setResetting(true);
    await resetToSeed();
    setResetting(false);
    logAudit('import', 'backup', 'reset-seed', 'Reset demo data to factory seed');
    toast({ title: 'Demo data reset', body: 'Everything re-seeded to 28 Jul 2026 state.', status: 'ok' });
  };

  /* ----- numbering ----- */
  const [seqs, setSeqs] = useState({ ...settings.sequences });
  const saveSeqs = () => {
    kvSet('settings', { ...settings, sequences: { ...seqs } });
    logAudit('update', 'settings', 'sequences', 'Updated document numbering', SEQ_META.map((m) => ({
      field: `${m.entity} next`, before: settings.sequences[m.kind], after: seqs[m.kind],
    })));
    toast({ title: 'Numbering saved', body: 'Next document numbers updated.', status: 'ok' });
  };

  /* ----- notifications ----- */
  const [notif, setNotif] = useState<Record<string, { inApp: boolean; email: boolean }>>(() => {
    const stored = kvGet('notifDefaults') as Record<string, { inApp: boolean; email: boolean }> | undefined;
    if (stored) return stored;
    const init: Record<string, { inApp: boolean; email: boolean }> = {};
    ALERT_TYPES.forEach((t) => {
      init[t.key] = { inApp: settings.alertPrefs[t.key] ?? true, email: ['speeding', 'fuel_anomaly', 'device_offline', 'shift_violation'].includes(t.key) };
    });
    return init;
  });
  const [quiet, setQuiet] = useState((kvGet('quietHours') as { from: string; to: string } | undefined) ?? { from: '22:00', to: '05:30' });

  const saveNotif = () => {
    kvSet('notifDefaults', notif);
    kvSet('quietHours', quiet);
    kvSet('settings', { ...settings, alertPrefs: Object.fromEntries(ALERT_TYPES.map((t) => [t.key, notif[t.key]?.inApp ?? true])) });
    logAudit('update', 'settings', 'alert-defaults', 'Updated fleet-default notification matrix');
    toast({ title: 'Notification defaults saved', body: 'Applies to new alert rules.', status: 'ok' });
  };

  /* ----- backup ----- */
  const entityCount = useMemo(
    () => Object.values(collections).reduce((s, c) => s + (c as unknown[]).length, 0),
    [collections],
  );
  const [lastBackup, setLastBackup] = useState<string>(
    (kvGet('lastBackupAt') as string | undefined) ?? '2026-07-21T06:12:00.000Z');
  const [autoBackup, setAutoBackup] = useState<boolean>((kvGet('autoBackup') as boolean | undefined) ?? true);
  const [exporting, setExporting] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<{ text: string; counts: { name: string; current: number; backup: number }[]; version: number | null } | null>(null);
  const [restoreError, setRestoreError] = useState<string[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doBackup = async () => {
    setExporting(true);
    try {
      const json = await exportJSON();
      downloadText(`fbv-backup-${TODAY}.json`, json);
      setLastBackup(demoNowIso());
      kvSet('lastBackupAt', demoNowIso());
      logAudit('export', 'backup', `fbv-backup-${TODAY}.json`, `Exported full JSON backup (${fmtNum(entityCount)} entities)`);
      toast({ title: 'Backup exported', body: `fbv-backup-${TODAY}.json · ${fmtNum(entityCount)} entities`, status: 'ok' });
    } catch {
      toast({ title: 'Backup failed', body: 'Could not reach the server export endpoint.', status: 'alert' });
    } finally {
      setExporting(false);
    }
  };

  const onRestoreFile = async (f: File) => {
    setRestoreError([]);
    try {
      const text = await f.text();
      const parsed = JSON.parse(text) as { version?: number; entities?: Record<string, unknown[]>; collections?: Record<string, unknown[]> };
      const entities = parsed.entities ?? parsed.collections ?? {};
      const names = Object.keys(collections) as (keyof typeof collections)[];
      const counts = names.map((n) => ({
        name: String(n),
        current: (collections[n] as unknown[]).length,
        backup: Array.isArray(entities[n as string]) ? (entities[n as string] as unknown[]).length : 0,
      }));
      const problems: string[] = [];
      if (parsed.version !== 1) problems.push(`version chip mismatch — file is v${parsed.version ?? '?'}, demo requires v1`);
      if (Object.keys(entities).length === 0) problems.push('no entities/collections found in file');
      setRestoreError(problems);
      setRestoreCandidate({ text, counts, version: parsed.version ?? null });
    } catch {
      setRestoreError(['File is not valid JSON.']);
      setRestoreCandidate(null);
    }
  };

  const doRestore = async () => {
    if (!restoreCandidate) return;
    setRestoring('Validating…');
    await new Promise((r) => setTimeout(r, 400));
    setRestoring('Restoring collections…');
    try {
      await importJSON(restoreCandidate.text);
      setRestoring('Done');
      logAudit('import', 'backup', 'restore', `Restored workspace from JSON backup (${fmtNum(entityCount)} entities)`);
      toast({ title: 'Backup restored', body: 'Workspace reverted to the backup snapshot.', status: 'ok' });
      setTimeout(() => { setRestoring(null); setRestoreCandidate(null); }, 500);
    } catch {
      setRestoring(null);
      toast({ title: 'Restore failed', body: 'The backup file was rejected.', status: 'alert' });
    }
  };

  /* ----- danger zone ----- */
  const [clearOpen, setClearOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [shake, setShake] = useState(false);
  const [includeProfile, setIncludeProfile] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [cleared, setCleared] = useState(false);

  const wrongAttempt = () => {
    setShake(true);
    setTimeout(() => setShake(false), 350);
  };

  const doClear = async () => {
    if (typed !== 'DELETE') { wrongAttempt(); return; }
    setWiping(true);
    try {
      await clearAllData({ includeProfile });
      logAudit('delete', 'backup', 'clear-all', `Workspace cleared by ${me.name}${includeProfile ? ' (incl. profile)' : ''}`);
    } catch { /* server marker best-effort */ }
    setWiping(false);
    setClearOpen(false);
    setTyped('');
    setCleared(true);
  };

  const loadSeed = async () => {
    await resetToSeed();
    setCleared(false);
    toast({ title: 'Demo seed loaded', body: 'Workspace repopulated with the 28 Jul 2026 dataset.', status: 'ok' });
  };

  /* ---------- cleared full-screen state ---------- */
  if (cleared) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-navy-50 text-navy-800">
          <DatabaseBackup size={26} />
        </span>
        <div className="text-[24px] font-bold tracking-[-0.015em] text-ink-900">Workspace cleared.</div>
        <div className="max-w-sm text-[14px] text-ink-400">
          All collections are empty. The wipe itself is retained as the single entry in the fresh audit log.
        </div>
        <div className="flex gap-2">
          <Btn variant="accent" onClick={loadSeed}>Load demo seed</Btn>
          <Btn onClick={() => setCleared(false)}>Start empty</Btn>
        </div>
      </motion.div>
    );
  }

  const scrollTo = (id: string) => sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <PageShell>
      <div className="flex gap-6">
        {/* left nav */}
        <motion.nav
          initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE }}
          className="sticky top-6 hidden h-fit w-[220px] shrink-0 flex-col gap-0.5 md:flex">
          {SECTIONS.filter((s) => s.id !== 'danger' || isAdmin).map((s) => (
            <button key={s.id} type="button" onClick={() => scrollTo(s.id)}
              className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors',
                active === s.id ? 'bg-accent-soft text-accent-strong' : 'text-ink-600 hover:bg-surface-muted',
                s.id === 'danger' && active !== s.id && 'text-alert-on-soft')}>
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </motion.nav>

        {/* content */}
        <div className="flex w-full max-w-[860px] flex-col gap-6">
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Settings</h1>

          {/* 1. company profile */}
          <section id="company" ref={(el) => { sectionRefs.current.company = el; }}>
            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE }}>
              <Card className={cn('p-5 transition-colors duration-700', savedFlash && 'bg-ok-soft/40')}>
                <SectionTitle className="mb-4">Company profile</SectionTitle>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <img src="/logo.svg" alt="FleetOS logo" className="h-14 w-14 rounded-xl border border-border" />
                    <Btn className="h-8 text-micro" onClick={() => toast({ title: 'Logo replace', body: 'Asset upload is a demo stub — logo.svg is fixed.', status: 'info' })}>Replace</Btn>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600">Company name
                      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></label>
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600">Trade name
                      <input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} className={inputCls} /></label>
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600">KRA PIN
                      <input value={form.kraPin} onChange={(e) => setForm({ ...form, kraPin: e.target.value })} className={cn(inputCls, 'font-mono')} /></label>
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600">Phone
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={cn(inputCls, 'font-mono')} /></label>
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600 sm:col-span-2">Address
                      <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} /></label>
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600">Email
                      <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></label>
                    <label className="flex flex-col gap-1 text-[13px] text-ink-600">Base depot
                      <select className={inputCls} defaultValue="FBV Depot">
                        {['FBV Depot', 'Mombasa Rd Yard', 'Nakuru Depot', 'Kisumu Depot'].map((d) => <option key={d}>{d}</option>)}
                      </select></label>
                  </div>
                  <div className="flex justify-end">
                    <Btn variant="accent" onClick={saveProfile}><Check size={15} /> Save changes</Btn>
                  </div>
                </div>
              </Card>
            </motion.div>
          </section>

          {/* 2. preferences */}
          <section id="preferences" ref={(el) => { sectionRefs.current.preferences = el; }}>
            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE }}>
              <Card className="flex flex-col gap-4 p-5">
                <SectionTitle>Preferences</SectionTitle>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[13px] text-ink-600">Currency
                    <span className={cn(inputCls, 'flex items-center justify-between bg-surface-muted text-ink-400')}>
                      KES — Kenyan Shilling <Lock size={13} />
                    </span>
                    <span className="text-micro text-ink-400">locked for demo</span></label>
                  <label className="flex flex-col gap-1 text-[13px] text-ink-600">Timezone
                    <span className={cn(inputCls, 'flex items-center justify-between bg-surface-muted text-ink-400')}>
                      Africa/Nairobi — EAT (UTC+3) <Lock size={13} />
                    </span>
                    <span className="text-micro text-ink-400">locked for demo</span></label>
                  <div className="flex flex-col gap-1 text-[13px] text-ink-600">Date format
                    <div className="flex gap-3 pt-1.5">
                      {[['dmy-text', '28 Jul 2026'], ['dmy-num', '28/07/2026']].map(([v, label]) => (
                        <label key={v} className="flex items-center gap-1.5">
                          <input type="radio" name="df" checked={dateFormat === v}
                            onChange={() => { setDateFormat(v); kvSet('dateFormat', v); }} className="h-4 w-4 accent-[#06B6D4]" />
                          <span className="font-mono text-[12px]">{label}</span>
                        </label>
                      ))}
                    </div></div>
                  <label className="flex flex-col gap-1 text-[13px] text-ink-600">Units
                    <span className={cn(inputCls, 'flex items-center justify-between bg-surface-muted text-ink-400')}>
                      Metric (km, litres) <Lock size={13} />
                    </span></label>
                  <label className="flex flex-col gap-1 text-[13px] text-ink-600">Default landing page
                    <select value={landing} onChange={(e) => { setLanding(e.target.value); kvSet('landingPage', e.target.value); toast({ title: 'Landing page saved', body: 'Per-user override stored.', status: 'ok' }); }} className={inputCls}>
                      <option value="dashboard">Dashboard</option>
                      <option value="analytics">Analytics</option>
                      <option value="dispatch">Dispatch</option>
                    </select>
                    <span className="text-micro text-ink-400">per-user override</span></label>
                </div>

                {/* simulator controls */}
                <div className="rounded-card border border-border bg-surface-muted/50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-[14px] font-semibold text-ink-900">Simulator controls</div>
                    <Chip tone={simRunning ? 'ok' : 'inactive'} className="font-mono">
                      <span className={cn('h-1.5 w-1.5 rounded-full', simRunning ? 'bg-ok animate-pulse' : 'bg-inactive')} />
                      {simRunning ? `SIM · ${tickRate}s tick · ${vehicles.length} devices` : 'SIM paused'}
                    </Chip>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1.5 text-[13px] text-ink-600">
                      Tick rate
                      {[1, 2, 5].map((t) => (
                        <button key={t} type="button" onClick={() => { setTickRate(t); kvSet('simTickRate', t); }}
                          className={cn('rounded-full px-2.5 py-1 font-mono text-micro font-medium',
                            tickRate === t ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
                          {t}s
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-ink-600">
                      Speed
                      <input type="range" min={0.5} max={4} step={0.5} value={speedMult}
                        onChange={(e) => { const v = Number(e.target.value); setSpeedMult(v); kvSet('simSpeedMult', v); }}
                        className="w-32 accent-[#06B6D4]" />
                      <Chip tone="accent" className="font-mono">{speedMult}×</Chip>
                    </div>
                    <Btn className="h-8 text-micro" variant={simRunning ? 'outline' : 'accent'}
                      onClick={() => { if (simRunning) { stopSim(); } else { startSim(); } }}>
                      {simRunning ? <><Pause size={13} /> Pause simulation</> : <><Play size={13} /> Resume</>}
                    </Btn>
                    <Btn className="h-8 text-micro" onClick={() => setResetOpen(true)} disabled={resetting}>
                      <RotateCcw size={13} /> {resetting ? 'Resetting…' : 'Reset demo data'}
                    </Btn>
                  </div>
                </div>
              </Card>
            </motion.div>
          </section>

          {/* 3. numbering */}
          <section id="numbering" ref={(el) => { sectionRefs.current.numbering = el; }}>
            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE }}>
              <Card className="p-5">
                <SectionTitle className="mb-1">Document numbering</SectionTitle>
                <div className="mb-3 text-micro text-ink-400">Changing next number forward is allowed; reuse is blocked to protect audit integrity.</div>
                <table className="w-full text-table">
                  <thead>
                    <tr className="border-b border-border text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
                      <th className="h-8 pr-3">Entity</th><th className="h-8 pr-3">Prefix</th><th className="h-8 pr-3">Next number</th><th className="h-8">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SEQ_META.map((m) => (
                      <tr key={m.kind} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 text-[13px] text-ink-900">{m.entity}</td>
                        <td className="py-2 pr-3 font-mono text-[12px] text-ink-600">{m.prefix}</td>
                        <td className="py-2 pr-3">
                          <input
                            value={String(seqs[m.kind]).padStart(6, '0')}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(/\D/g, '')) || 0;
                              setSeqs((s) => ({ ...s, [m.kind]: Math.max(n, settings.sequences[m.kind]) }));
                            }}
                            className="h-8 w-28 rounded-lg border border-border px-2 font-mono text-[12px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
                        </td>
                        <td className="py-2">
                          <motion.span key={`${m.kind}-${seqs[m.kind]}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                            className="inline-block rounded-full bg-accent-soft px-2.5 py-0.5 font-mono text-micro font-semibold text-accent-strong">
                            {m.prefix}{String(seqs[m.kind]).padStart(6, '0')}
                          </motion.span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex justify-end"><Btn variant="accent" onClick={saveSeqs}>Save numbering</Btn></div>
              </Card>
            </motion.div>
          </section>

          {/* 4. notifications */}
          <section id="notifications" ref={(el) => { sectionRefs.current.notifications = el; }}>
            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE }}>
              <Card className="p-5">
                <SectionTitle className="mb-1">Notifications — fleet defaults</SectionTitle>
                <div className="mb-3 text-micro text-ink-400">Same engine as Alerts → Rules; these are the fleet-level defaults. Quiet hours suppress Minor alerts.</div>
                <div className="grid grid-cols-[1fr,70px,70px] items-center gap-2 border-b border-border pb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">
                  <span>Alert type</span><span className="text-center">In-app</span><span className="text-center">Email</span>
                </div>
                {ALERT_TYPES.map((t) => (
                  <div key={t.key} className="grid grid-cols-[1fr,70px,70px] items-center gap-2 border-b border-border/60 py-1.5 last:border-0">
                    <span className="text-[13px] text-ink-900">{t.label}</span>
                    <span className="text-center">
                      <input type="checkbox" checked={notif[t.key]?.inApp ?? true}
                        onChange={(e) => setNotif((p) => ({ ...p, [t.key]: { inApp: e.target.checked, email: p[t.key]?.email ?? false } }))}
                        className="h-4 w-4 accent-[#06B6D4]" /></span>
                    <span className="text-center">
                      <input type="checkbox" checked={notif[t.key]?.email ?? false}
                        onChange={(e) => setNotif((p) => ({ ...p, [t.key]: { inApp: p[t.key]?.inApp ?? true, email: e.target.checked } }))}
                        className="h-4 w-4 accent-[#06B6D4]" /></span>
                  </div>
                ))}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-ink-600">
                  Quiet hours
                  <input value={quiet.from} onChange={(e) => setQuiet({ ...quiet, from: e.target.value })} className="h-8 w-20 rounded-lg border border-border px-2 font-mono text-[12px] outline-none focus:border-accent" />
                  –
                  <input value={quiet.to} onChange={(e) => setQuiet({ ...quiet, to: e.target.value })} className="h-8 w-20 rounded-lg border border-border px-2 font-mono text-[12px] outline-none focus:border-accent" />
                  <span className="text-micro text-ink-400">suppresses Minor alerts</span>
                  <Btn variant="accent" className="ml-auto h-8 text-micro" onClick={saveNotif}>Save defaults</Btn>
                </div>
              </Card>
            </motion.div>
          </section>

          {/* 5. data & backup */}
          <section id="backup" ref={(el) => { sectionRefs.current.backup = el; }}>
            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE }}>
              <div className="overflow-hidden rounded-card bg-navy-900 p-5 text-white shadow-card">
                <div className="mb-2 flex items-center gap-2 text-[16px] font-bold">
                  <ShieldCheck size={18} className="text-accent-on-navy" /> Full JSON backup
                </div>
                <div className="mb-4 font-mono text-[12px] text-navy-100">
                  {fmtNum(entityCount)} entities · ~{(entityCount * 0.5 / 1000).toFixed(1)} MB · last backup {fmtDateTimeEAT(lastBackup)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Btn variant="accent" onClick={doBackup} disabled={exporting}>
                    {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Export backup (.json)
                  </Btn>
                  <Btn className="border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => fileRef.current?.click()}>
                    <Upload size={15} /> Restore backup
                  </Btn>
                  <input ref={fileRef} type="file" accept=".json" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onRestoreFile(f); e.target.value = ''; }} />
                  <label className="ml-auto flex items-center gap-2 text-[13px] text-navy-100">
                    <button type="button" onClick={() => { setAutoBackup(!autoBackup); kvSet('autoBackup', !autoBackup); }}
                      className={cn('relative h-5 w-9 rounded-full transition-colors duration-150 ease-snap', autoBackup ? 'bg-accent' : 'bg-navy-700')}>
                      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150', autoBackup ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                    Auto-backup · Weekly Sunday 02:00
                  </label>
                </div>
                {autoBackup && (
                  <div className="mt-2 font-mono text-micro text-navy-100/70">next run in 5 d 11 h</div>
                )}
              </div>
            </motion.div>
          </section>

          {/* 6. danger zone */}
          {isAdmin && (
            <section id="danger" ref={(el) => { sectionRefs.current.danger = el; }}>
              <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE }}>
                <div className="rounded-card border-2 border-alert/60 bg-white p-5">
                  <div className="mb-1 text-[16px] font-bold text-alert">Danger zone</div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="max-w-lg text-[13px] leading-5 text-ink-600">
                      <span className="font-semibold text-ink-900">Clear all data.</span> Permanently deletes all vehicles,
                      drivers, trips, logs and settings. This cannot be undone. The wipe itself is recorded in a fresh audit log.
                    </div>
                    <Btn variant="danger" onClick={() => setClearOpen(true)}><TriangleAlert size={15} /> Clear all data…</Btn>
                  </div>
                </div>
              </motion.div>
            </section>
          )}
        </div>
      </div>

      {/* reset demo data confirm */}
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={doReset}
        title="Reset demo data?"
        body="All collections are wiped and re-seeded to the factory 28 Jul 2026 dataset. Your local edits will be lost."
        confirmLabel="Reset to seed"
        destructive
      />

      {/* restore validation modal */}
      <Modal open={!!restoreCandidate} onClose={() => setRestoreCandidate(null)} title="Restore backup — validation" wide
        footer={
          <>
            <Btn onClick={() => setRestoreCandidate(null)}>Cancel</Btn>
            <Btn variant="accent" disabled={restoreError.length > 0 || restoring !== null} onClick={doRestore}>
              {restoring ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Restore
            </Btn>
          </>
        }>
        {restoreCandidate && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Chip tone={restoreCandidate.version === 1 ? 'ok' : 'alert'} className="font-mono">schema v{restoreCandidate.version ?? '?'}</Chip>
              {restoring && <span className="font-mono text-[12px] text-accent-strong">{restoring}</span>}
            </div>
            {restoreError.length > 0 && (
              <div className="rounded-lg bg-alert-soft px-3 py-2 text-[13px] font-medium text-alert-on-soft">
                {restoreError.map((e) => <div key={e}>· {e}</div>)}
              </div>
            )}
            <div className="max-h-[260px] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0">
                  <tr className="border-b border-border bg-surface-muted/70 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-ink-400">
                    <th className="h-7 px-3">Collection</th><th className="h-7 px-3 text-right">Current</th><th className="h-7 px-3 text-right">Backup</th>
                  </tr>
                </thead>
                <tbody>
                  {restoreCandidate.counts.map((c, i) => (
                    <motion.tr key={c.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                      className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5 text-ink-900">{c.name}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtNum(c.current)}</td>
                      <td className={cn('px-3 py-1.5 text-right font-mono', c.backup !== c.current && 'font-semibold text-warn-on-soft')}>{fmtNum(c.backup)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
            {restoring && (
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <motion.div className="h-full rounded-full bg-accent" initial={{ width: '10%' }} animate={{ width: restoring === 'Done' ? '100%' : '65%' }} transition={{ duration: 0.6 }} />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* extra-guarded clear-all dialog (mirrors ConfirmDialog typed pattern) */}
      <Modal open={clearOpen} onClose={() => { setClearOpen(false); setTyped(''); }}
        title={<span className="flex items-center gap-2 text-alert"><TriangleAlert size={16} /> Permanently delete everything?</span>}>
        <motion.div
          animate={shake ? { x: [0, -6, 6, -6, 6, 0] } : {}}
          transition={{ duration: 0.3 }}
          className="flex flex-col gap-3">
          <div className="rounded-lg border border-alert/40 bg-alert-soft px-3 py-2 text-[13px] font-medium text-alert-on-soft">
            This action cannot be undone.
          </div>
          <ul className="flex flex-col gap-1 font-mono text-[12px] text-ink-600">
            <li>· {fmtNum(vehicles.length)} vehicles will be deleted</li>
            <li>· {fmtNum(workOrders.length)} work orders will be deleted</li>
            <li>· {fmtNum(trips.length)} trips will be deleted</li>
            <li>· all settings, alerts, logs and documents will be deleted</li>
          </ul>
          <label className="flex items-center gap-2 text-[13px] text-ink-600">
            <input type="checkbox" checked={includeProfile} onChange={(e) => setIncludeProfile(e.target.checked)} className="h-4 w-4 accent-[#DC2626]" />
            Also erase company profile & settings
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-600">
            Type <span className="font-mono font-semibold text-ink-900">DELETE</span> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typed !== 'DELETE') wrongAttempt(); }}
              className={cn('h-9 rounded-lg border px-3 font-mono text-[13px] outline-none transition-colors',
                typed === 'DELETE' ? 'border-ok ring-2 ring-ok/30' : 'border-border focus:border-alert focus:ring-2 focus:ring-alert/30')} />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Btn onClick={() => { setClearOpen(false); setTyped(''); }}>Cancel</Btn>
            <motion.div animate={typed === 'DELETE' ? { scale: [1, 1.04, 1] } : {}} transition={{ duration: 0.3 }}>
              <Btn variant="danger" disabled={typed !== 'DELETE' || wiping} onClick={doClear}>
                {wiping ? <Loader2 size={15} className="animate-spin" /> : <TriangleAlert size={15} />}
                Permanently delete everything
              </Btn>
            </motion.div>
          </div>
        </motion.div>
      </Modal>
    </PageShell>
  );
}
