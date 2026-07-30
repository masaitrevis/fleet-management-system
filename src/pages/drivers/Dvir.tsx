// FBV FleetOS — /dvir Digital Vehicle Inspection (dvir.md).
// <768px: driver mobile wizard (start → checklist → review/sign → success).
// ≥768px: supervisor log view with KPIs, DataTable, detail drawer, defects queue.

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck, Camera, Check, ChevronLeft, ChevronRight, ClipboardCheck,
  FileDown, FileSpreadsheet, Mic, OctagonAlert, PenLine, ShieldAlert,
  TriangleAlert, Wrench,
} from 'lucide-react';
import jsPDF from 'jspdf';
import {
  ChecklistItem, DataTable, Drawer, EmptyState, KPIStatCard, Modal, PlateTag,
  SignaturePad, StatusPill, Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { useCollection, useKV, kvSet, add, nextSequence, update } from '@/lib/store';
import { fmtDateTimeEAT, fmtNum } from '@/lib/format';
import type { DvirItem, Inspection } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, EASE, exportXlsx, hash01, nowIso, uid, useMedia, useReducedMotion } from './helpers';

const CHECKLIST: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: 'Exterior',
    items: [
      { key: 'lights', label: 'Lights & indicators' },
      { key: 'tyres', label: 'Tyres & wheel nuts' },
      { key: 'mirrors', label: 'Mirrors & glass' },
      { key: 'body', label: 'Body / doors' },
      { key: 'leaks', label: 'Leaks under vehicle' },
    ],
  },
  {
    group: 'Interior',
    items: [
      { key: 'seatbelts', label: 'Seatbelts' },
      { key: 'horn', label: 'Horn' },
      { key: 'wipers', label: 'Wipers & washers' },
      { key: 'dashlights', label: 'Dashboard warning lights' },
    ],
  },
  {
    group: 'Engine',
    items: [
      { key: 'oil', label: 'Engine oil level' },
      { key: 'coolant', label: 'Coolant level' },
      { key: 'brakefluid', label: 'Brake fluid' },
    ],
  },
  {
    group: 'Safety kit',
    items: [
      { key: 'extinguisher', label: 'Fire extinguisher' },
      { key: 'firstaid', label: 'First-aid kit & triangles' },
    ],
  },
];
const ALL_ITEMS = CHECKLIST.flatMap((g) => g.items);

type Answer = 'ok' | 'defect' | 'na';
type Step = 'start' | 'checklist' | 'review' | 'success';

export default function Dvir() {
  const isDesktop = useMedia('(min-width: 768px)');
  return isDesktop ? <SupervisorView /> : <Wizard />;
}

/* ================================================================== */
/* A. Driver mobile wizard                                             */
/* ================================================================== */

function Wizard() {
  const { user } = useAuth();
  const drivers = useCollection('drivers');
  const vehicles = useCollection('vehicles');
  const inspections = useCollection('inspections');
  const doNotDrive = (useKV('doNotDrive') as string[] | undefined) ?? [];
  const reduced = useReducedMotion();

  const me = drivers.find((d) => d.name === user?.name) ?? drivers[0];
  const assigned = vehicles.find((v) => v.assignedDriverId === me?.id) ?? vehicles[0];

  const [step, setStep] = useState<Step>('start');
  const [dir, setDir] = useState(1);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [kind, setKind] = useState<'pre-trip' | 'post-trip'>('pre-trip');
  const [odo, setOdo] = useState<string>('');
  const [odoTouched, setOdoTouched] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [severities, setSeverities] = useState<Record<string, 'minor' | 'major'>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [safeToDrive, setSafeToDrive] = useState(true);
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ dvirNo: string; woNumber?: string; defects: number } | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Exterior: true });

  const vehicle = vehicles.find((v) => v.id === (vehicleId ?? assigned?.id)) ?? vehicles[0];
  const lastOdo = vehicle?.odometerKm ?? 0;
  const odoValue = odoTouched ? odo : String(lastOdo);
  const odoNum = Number(odoValue.replace(/[^\d]/g, ''));
  const odoValid = odoNum >= lastOdo;

  const answered = ALL_ITEMS.filter((it) => answers[it.key] !== undefined).length;
  const remaining = ALL_ITEMS.length - answered;
  const defects = ALL_ITEMS.filter((it) => answers[it.key] === 'defect');
  const hasMajor = defects.some((it) => severities[it.key] === 'major');
  const vehicleFlagged = vehicle ? doNotDrive.includes(vehicle.id) : false;

  const go = (next: Step, d = 1) => { setDir(d); setStep(next); };

  const submit = async () => {
    if (!vehicle || !me || submitting) return;
    setSubmitting(true);
    const dvirNo = `FBV-DVIR-${String(220 + inspections.length + 1).padStart(4, '0')}`;
    const items: DvirItem[] = ALL_ITEMS.map((it) => ({
      key: it.key,
      label: it.label,
      result: answers[it.key] ?? 'na',
      note: answers[it.key] === 'defect' ? notes[it.key] || undefined : undefined,
      photo: answers[it.key] === 'defect' ? photos[it.key] || undefined : undefined,
    }));
    let woId: string | undefined;
    let woNumber: string | undefined;
    if (defects.length > 0) {
      woNumber = await nextSequence('wo');
      woId = uid('wo');
      add('workOrders', {
        id: woId,
        number: woNumber,
        vehicleId: vehicle.id,
        source: 'dvir',
        status: 'open',
        priority: hasMajor ? 'high' : 'medium',
        title: `DVIR defects — ${vehicle.plate} (${defects.length} item${defects.length === 1 ? '' : 's'})`,
        items: defects.map((it) => ({
          description: `${it.label}${notes[it.key] ? ` — ${notes[it.key]}` : ''} (${severities[it.key] === 'major' ? 'Major' : 'Minor'})`,
          qty: 1,
          unitCostKes: 0,
        })),
        laborCostKes: 0,
        vendorId: null,
        openedAt: nowIso(),
        dueAt: null,
        completedAt: null,
        notes: `Auto-created from ${dvirNo} · ${me.name}`,
      });
    }
    const insp: Inspection = {
      id: uid('dvir'),
      vehicleId: vehicle.id,
      driverId: me.id,
      kind,
      at: nowIso(),
      odometerKm: odoNum,
      items,
      result: defects.length > 0 ? 'fail' : 'pass',
      defectsCount: defects.length,
      workOrderId: woId,
    };
    add('inspections', insp);
    update('vehicles', vehicle.id, { odometerKm: odoNum });
    if (hasMajor) {
      kvSet('doNotDrive', [...new Set([...doNotDrive, vehicle.id])]);
      update('vehicles', vehicle.id, { tripStatus: 'maintenance' });
      add('alerts', {
        id: uid('al'),
        type: 'maintenance_due',
        severity: 'critical',
        message: `Major DVIR defect — ${vehicle.plate} flagged DO-NOT-DRIVE pending mechanic review`,
        entityRef: { kind: 'vehicle', id: vehicle.id, label: vehicle.plate },
        at: nowIso(),
        read: false,
        acknowledged: false,
      });
    }
    add('audit', {
      id: uid('aud'),
      at: nowIso(),
      userId: String(user?.id ?? 'usr-05'), userName: user?.name ?? me.name, action: 'create',
      collection: 'inspections', recordId: insp.id,
      summary: `${dvirNo} submitted — ${vehicle.plate} · ${defects.length} defect${defects.length === 1 ? '' : 's'}${woNumber ? ` · WO ${woNumber}` : ''}${hasMajor ? ' · DO-NOT-DRIVE' : ''}`,
    });
    setSubmitting(false);
    setSubmitted({ dvirNo, woNumber, defects: defects.length });
    go('success');
  };

  const reset = () => {
    setAnswers({}); setNotes({}); setSeverities({}); setPhotos({});
    setSafeToDrive(true); setSignature(null); setSubmitted(null);
    setOdo(''); setOdoTouched(false); setKind('pre-trip');
    go('start', -1);
  };

  const variants = {
    enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : 40 * d }),
    center: { opacity: 1, x: 0 },
    exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : -40 * d }),
  };

  return (
    <div className="relative flex min-h-full flex-col">
      {/* progress dots */}
      <div className="sticky top-0 z-10 flex items-center justify-center gap-2 bg-surface-muted/95 py-3 backdrop-blur">
        {(['start', 'checklist', 'review', 'success'] as Step[]).map((s, i) => {
          const cur = ['start', 'checklist', 'review', 'success'].indexOf(step);
          return (
            <motion.span key={s}
              animate={{ scale: i === cur ? 1.35 : 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={cn('h-2 w-2 rounded-full', i <= cur ? 'bg-accent' : 'bg-border')} />
          );
        })}
      </div>

      <AnimatePresence mode="wait" custom={dir}>
        {/* ---------------- STEP 0 — Start ---------------- */}
        {step === 'start' && (
          <motion.div key="start" custom={dir} variants={variants} initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.26, ease: EASE }}
            className="flex flex-col gap-3 px-4 pb-28">
            {vehicleFlagged && (
              <div className="flex items-center gap-2 rounded-card bg-alert-soft px-4 py-3 text-[13px] font-semibold text-alert-on-soft shadow-card">
                <ShieldAlert size={16} /> This vehicle is flagged DO-NOT-DRIVE pending mechanic review.
              </div>
            )}
            {/* vehicle confirm */}
            <div className="rounded-card border border-border bg-white p-5 text-center shadow-card">
              <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Your vehicle</div>
              <div className="mt-2 flex justify-center">
                <PlateTag plate={vehicle?.plate ?? '—'} className="px-3 py-1 text-[20px]" />
              </div>
              <div className="mt-1 text-[14px] font-semibold text-ink-900">{vehicle?.model}</div>
              <button type="button" onClick={() => setPickerOpen(true)}
                className="mt-1 text-[12px] font-medium text-accent-strong hover:underline">
                Not your vehicle?
              </button>
            </div>

            {/* inspection type */}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setKind('pre-trip')}
                className={cn('flex h-14 items-center justify-center rounded-card text-[14px] font-bold transition-all active:scale-[0.97]',
                  kind === 'pre-trip' ? 'bg-accent text-navy-950 shadow-card' : 'border border-border bg-white text-ink-600')}>
                PRE-TRIP
              </button>
              <button type="button" onClick={() => setKind('post-trip')}
                className={cn('flex h-14 items-center justify-center rounded-card text-[14px] font-bold transition-all active:scale-[0.97]',
                  kind === 'post-trip' ? 'bg-navy-900 text-white shadow-card' : 'border border-border bg-white text-ink-600')}>
                POST-TRIP
              </button>
            </div>

            {/* odometer */}
            <label className="rounded-card border border-border bg-white p-4 shadow-card">
              <span className="text-micro uppercase tracking-[0.06em] text-ink-400">Odometer (km)</span>
              <input
                value={odoValue}
                inputMode="numeric"
                onChange={(e) => { setOdoTouched(true); setOdo(e.target.value); }}
                className={cn('mt-1 w-full rounded-lg border px-3 py-2.5 font-mono text-[22px] font-bold tracking-[0.02em] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30',
                  odoValid ? 'border-border' : 'border-alert')}
              />
              {!odoValid && (
                <span className="mt-1 block text-micro text-alert-on-soft">
                  Must be ≥ last known {fmtNum(lastOdo)} km
                </span>
              )}
            </label>

            <p className="text-center text-micro text-ink-400">
              No signal? Inspection saves locally and syncs automatically.
            </p>

            {/* sticky CTA */}
            <div className="fixed inset-x-0 bottom-[57px] z-20 bg-gradient-to-t from-surface-muted via-surface-muted/95 to-transparent px-4 pb-3 pt-6">
              <button type="button" disabled={!odoValid || !vehicle}
                onClick={() => go('checklist')}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-card bg-accent text-[15px] font-bold text-navy-950 shadow-pop transition-all hover:bg-accent-strong active:scale-[0.98] disabled:opacity-40">
                Start inspection <ChevronRight size={17} />
              </button>
            </div>
          </motion.div>
        )}

        {/* ---------------- STEP 1 — Checklist ---------------- */}
        {step === 'checklist' && (
          <motion.div key="checklist" custom={dir} variants={variants} initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.26, ease: EASE }}
            className="flex flex-col gap-3 px-4 pb-28">
            {/* progress header */}
            <div className="sticky top-8 z-10 rounded-card border border-border bg-white px-4 py-3 shadow-card">
              <div className="flex items-center justify-between text-[13px] font-semibold text-ink-900">
                <span>{answered} of {ALL_ITEMS.length} done</span>
                <span className="font-mono text-[11px] text-ink-400">{vehicle?.plate}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <motion.div className="h-full rounded-full bg-accent"
                  animate={{ width: `${(answered / ALL_ITEMS.length) * 100}%` }}
                  transition={{ duration: 0.25 }} />
              </div>
            </div>

            <button type="button" onClick={() => go('start', -1)}
              className="flex items-center gap-1 self-start text-[12px] font-medium text-ink-400 hover:text-ink-900">
              <ChevronLeft size={14} /> Back
            </button>

            {CHECKLIST.map((g) => {
              const open = openGroups[g.group] ?? false;
              const doneInGroup = g.items.filter((it) => answers[it.key] !== undefined).length;
              const defectsInGroup = g.items.filter((it) => answers[it.key] === 'defect').length;
              return (
                <div key={g.group} className="overflow-hidden rounded-card border border-border bg-white shadow-card">
                  <button type="button"
                    onClick={() => setOpenGroups((s) => ({ ...s, [g.group]: !open }))}
                    className="flex w-full items-center justify-between px-4 py-3">
                    <span className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
                      {g.group}
                      {defectsInGroup > 0 && <span className="rounded-full bg-alert-soft px-1.5 py-0.5 text-micro font-bold text-alert-on-soft">{defectsInGroup}</span>}
                    </span>
                    <span className="flex items-center gap-2 text-micro text-ink-400">
                      {doneInGroup}/{g.items.length}
                      <ChevronRight size={15} className={cn('transition-transform', open && 'rotate-90')} />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                        transition={{ duration: 0.22 }} className="overflow-hidden">
                        <div className="flex flex-col gap-2 px-3 pb-3">
                          {g.items.map((it) => (
                            <div key={it.key}>
                              <ChecklistItem
                                label={it.label}
                                value={answers[it.key] ?? ('' as Answer)}
                                note={notes[it.key]}
                                onChange={(v) => setAnswers((a) => ({ ...a, [it.key]: a[it.key] === v ? undefined : v }))}
                                onNote={(n) => setNotes((s) => ({ ...s, [it.key]: n }))}
                              />
                              {answers[it.key] === 'defect' && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                                  className="mt-1.5 flex flex-wrap items-center gap-2 overflow-hidden rounded-lg bg-alert-soft/40 px-3 py-2">
                                  <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[12px] font-medium text-ink-600">
                                    <Camera size={14} /> {photos[it.key] ? 'Photo added ✓' : 'Add photo'}
                                    <input type="file" accept="image/*" capture="environment" className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) setPhotos((s) => ({ ...s, [it.key]: f.name }));
                                      }} />
                                  </label>
                                  <span className="flex h-9 items-center gap-1 rounded-lg border border-border bg-white px-2 text-[12px] text-ink-400">
                                    <Mic size={13} /> voice note
                                  </span>
                                  <span className="ml-auto flex gap-1">
                                    {(['minor', 'major'] as const).map((sev) => (
                                      <button key={sev} type="button"
                                        onClick={() => setSeverities((s) => ({ ...s, [it.key]: sev }))}
                                        className={cn('h-9 rounded-full px-3 text-[12px] font-bold capitalize transition-all active:scale-95',
                                          (severities[it.key] ?? 'minor') === sev
                                            ? sev === 'major' ? 'bg-alert text-white' : 'bg-warn text-white'
                                            : 'border border-border bg-white text-ink-600')}>
                                        {sev}
                                      </button>
                                    ))}
                                  </span>
                                </motion.div>
                              )}
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}

            {/* sticky bottom */}
            <div className="fixed inset-x-0 bottom-[57px] z-20 bg-gradient-to-t from-surface-muted via-surface-muted/95 to-transparent px-4 pb-3 pt-6">
              <button type="button" disabled={remaining > 0}
                onClick={() => go('review')}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-card bg-accent text-[15px] font-bold text-navy-950 shadow-pop transition-all hover:bg-accent-strong active:scale-[0.98] disabled:opacity-40">
                {remaining > 0 ? `${remaining} remaining` : <>Review & submit <ChevronRight size={17} /></>}
              </button>
            </div>
          </motion.div>
        )}

        {/* ---------------- STEP 2 — Review & sign ---------------- */}
        {step === 'review' && (
          <motion.div key="review" custom={dir} variants={variants} initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.26, ease: EASE }}
            className="flex flex-col gap-3 px-4 pb-28">
            <button type="button" onClick={() => go('checklist', -1)}
              className="flex items-center gap-1 self-start text-[12px] font-medium text-ink-400 hover:text-ink-900">
              <ChevronLeft size={14} /> Back to checklist
            </button>

            {/* summary */}
            <div className="rounded-card border border-border bg-white p-4 shadow-card">
              <div className="mb-2 text-[13px] font-semibold text-ink-900">Summary — {vehicle?.plate} · {kind === 'pre-trip' ? 'PRE-TRIP' : 'POST-TRIP'}</div>
              <div className="flex flex-col gap-1.5">
                {ALL_ITEMS.filter((it) => answers[it.key] === 'ok').map((it) => (
                  <div key={it.key} className="flex items-center gap-2 text-[13px] text-ink-600">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok-on-soft"><Check size={11} /></span>
                    {it.label}
                  </div>
                ))}
                {defects.map((it) => (
                  <div key={it.key} className="flex items-start gap-2 text-[13px] text-ink-900">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-alert-soft text-alert-on-soft"><TriangleAlert size={11} /></span>
                    <span>
                      <b>{it.label}</b> — {notes[it.key] || 'defect noted'}
                      <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-micro font-bold',
                        severities[it.key] === 'major' ? 'bg-alert-soft text-alert-on-soft' : 'bg-warn-soft text-warn-on-soft')}>
                        {severities[it.key] === 'major' ? 'Major' : 'Minor'}
                      </span>
                    </span>
                  </div>
                ))}
                {ALL_ITEMS.filter((it) => answers[it.key] === 'na').map((it) => (
                  <div key={it.key} className="flex items-center gap-2 text-[13px] text-ink-400">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-inactive-soft text-inactive-on-soft">—</span>
                    {it.label} (N/A)
                  </div>
                ))}
              </div>
            </div>

            {/* DO-NOT-DRIVE lock */}
            {hasMajor && (
              <motion.div
                animate={{ boxShadow: ['0 0 0 0 rgba(220,38,38,0)', '0 0 18px 2px rgba(220,38,38,.35)', '0 0 0 0 rgba(220,38,38,0)'] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex items-center gap-2 rounded-card bg-alert-soft px-4 py-3 text-[13px] font-semibold text-alert-on-soft">
                <ShieldAlert size={16} /> Major defect reported — vehicle flagged DO-NOT-DRIVE until mechanic review.
              </motion.div>
            )}

            {/* safe-to-drive toggle */}
            <div className={cn('flex items-center justify-between rounded-card border p-4 shadow-card',
              hasMajor ? 'border-alert/40 bg-alert-soft/30' : 'border-border bg-white')}>
              <span className="text-[14px] font-semibold text-ink-900">Vehicle is safe to operate</span>
              <button type="button" disabled={hasMajor}
                onClick={() => setSafeToDrive(!safeToDrive)}
                className={cn('relative h-8 w-14 rounded-full transition-colors disabled:opacity-50',
                  safeToDrive && !hasMajor ? 'bg-ok' : 'bg-inactive')}>
                <motion.span layout transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className={cn('absolute top-1 h-6 w-6 rounded-full bg-white shadow-card',
                    safeToDrive && !hasMajor ? 'right-1' : 'left-1')} />
              </button>
            </div>

            {/* signature */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-ink-900">
                <PenLine size={14} /> Driver signature
              </div>
              <SignaturePad onDone={(url) => setSignature(url)} height={160} />
              {signature && <div className="mt-1 text-micro text-ok-on-soft">Signature captured ✓</div>}
            </div>

            {/* sticky submit */}
            <div className="fixed inset-x-0 bottom-[57px] z-20 bg-gradient-to-t from-surface-muted via-surface-muted/95 to-transparent px-4 pb-3 pt-6">
              <button type="button" disabled={!signature || submitting}
                onClick={submit}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-card bg-accent text-[15px] font-bold text-navy-950 shadow-pop transition-all hover:bg-accent-strong active:scale-[0.98] disabled:opacity-40">
                {submitting ? 'Submitting…' : 'Submit DVIR'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ---------------- STEP 3 — Success ---------------- */}
        {step === 'success' && submitted && (
          <motion.div key="success" custom={dir} variants={variants} initial="enter" animate="center" exit="exit"
            transition={{ duration: 0.26, ease: EASE }}
            className="flex flex-col items-center gap-4 px-4 pt-10 text-center">
            <svg width="96" height="96" viewBox="0 0 96 96">
              <motion.circle cx="48" cy="48" r="42" fill="none" stroke="#16A34A" strokeWidth="5"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5 }} />
              <motion.path d="M 30 49 L 43 62 L 67 36" fill="none" stroke="#16A34A" strokeWidth="6"
                strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.3 }} />
            </svg>
            <div>
              <div className="text-[18px] font-bold text-ink-900">{submitted.dvirNo} submitted</div>
              <div className="mt-0.5 font-mono text-[12px] text-ink-400">{fmtDateTimeEAT(nowIso())}</div>
            </div>
            {submitted.woNumber && (
              <motion.button type="button"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}
                onClick={() => toast({ title: submitted.woNumber!, body: 'Work order is open on the maintenance board.', status: 'info' })}
                className="flex items-center gap-2 rounded-full bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card">
                <Wrench size={14} className="text-accent-on-navy" />
                Work order {submitted.woNumber} opened ({submitted.defects} defect{submitted.defects === 1 ? '' : 's'}) →
              </motion.button>
            )}
            {hasMajor && (
              <div className="flex items-center gap-2 rounded-card bg-alert-soft px-4 py-2.5 text-[12px] font-semibold text-alert-on-soft">
                <ShieldAlert size={14} /> {vehicle?.plate} flagged DO-NOT-DRIVE — mechanic & fleet manager alerted.
              </div>
            )}
            <button type="button" onClick={reset}
              className="mt-2 h-12 w-full max-w-xs rounded-card bg-accent text-[15px] font-bold text-navy-950 shadow-card transition-all hover:bg-accent-strong active:scale-[0.98]">
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* vehicle picker */}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Select vehicle">
        <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {vehicles.filter((v) => v.tripStatus === 'active').map((v) => (
            <button key={v.id} type="button"
              onClick={() => { setVehicleId(v.id); setPickerOpen(false); setOdoTouched(false); }}
              className={cn('flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
                v.id === vehicle?.id ? 'border-accent bg-accent-soft/30' : 'border-border hover:bg-surface-muted')}>
              <span className="flex items-center gap-2">
                <PlateTag plate={v.plate} />
                <span className="text-[13px] text-ink-600">{v.model}</span>
              </span>
              <span className="font-mono text-[11px] text-ink-400">{fmtNum(v.odometerKm)} km</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/* ================================================================== */
/* B. Desktop supervisor view (≥768px)                                 */
/* ================================================================== */

/** Demo-universe "now" for age timers (seed.ts TODAY, mid-afternoon EAT). */
const DEMO_NOW_MS = new Date(`${TODAY}T14:00:00+03:00`).getTime();

function SupervisorView() {
  const inspections = useCollection('inspections');
  const drivers = useCollection('drivers');
  const vehicles = useCollection('vehicles');
  const workOrders = useCollection('workOrders');
  const doNotDrive = (useKV('doNotDrive') as string[] | undefined) ?? [];
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState('log');
  const [detail, setDetail] = useState<Inspection | null>(null);

  const cutoff = useMemo(() => new Date(`${TODAY}T00:00:00Z`).getTime() - days * 86400000, [days]);
  const rows = useMemo(
    () => inspections.filter((i) => days >= 999 || new Date(i.at).getTime() >= cutoff),
    [inspections, cutoff, days],
  );
  const todayCount = inspections.filter((i) => i.at.slice(0, 10) === TODAY).length;
  const cutoff30 = new Date(`${TODAY}T00:00:00Z`).getTime() - 30 * 86400000;
  const last30 = inspections.filter((i) => new Date(i.at).getTime() >= cutoff30);
  const passRate = last30.length > 0 ? Math.round((last30.filter((i) => i.result === 'pass').length / last30.length) * 100) : 100;

  const openDefects = inspections.filter((i) => {
    if (i.defectsCount === 0) return false;
    const wo = i.workOrderId ? workOrders.find((w) => w.id === i.workOrderId) : null;
    return !wo || (wo.status !== 'done' && wo.status !== 'cancelled');
  });

  const dvirNo = (i: Inspection) => `FBV-DVIR-${String(220 + inspections.findIndex((x) => x.id === i.id) + 1).padStart(4, '0')}`;

  const exportLog = () => exportXlsx('dvir-jul-2026.xlsx', rows.map((i) => {
    const d = drivers.find((x) => x.id === i.driverId);
    const v = vehicles.find((x) => x.id === i.vehicleId);
    const wo = i.workOrderId ? workOrders.find((w) => w.id === i.workOrderId) : null;
    return {
      DVIR: dvirNo(i),
      Date: fmtDateTimeEAT(i.at),
      Driver: d?.name ?? '',
      Vehicle: v?.plate ?? '',
      Type: i.kind.toUpperCase(),
      Result: i.result.toUpperCase(),
      Defects: i.defectsCount,
      'Work order': wo?.number ?? '',
      'Odometer km': i.odometerKm,
    };
  }), 'DVIR log');

  const exportPdf = (i: Inspection) => {
    const doc = new jsPDF();
    const d = drivers.find((x) => x.id === i.driverId);
    const v = vehicles.find((x) => x.id === i.vehicleId);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(`FBV FleetOS — ${dvirNo(i)}`, 14, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`${v?.plate ?? ''} · ${v?.model ?? ''} · Driver: ${d?.name ?? ''}`, 14, 25);
    doc.text(`${i.kind.toUpperCase()} · ${fmtDateTimeEAT(i.at)} · Odometer ${fmtNum(i.odometerKm)} km · Result: ${i.result.toUpperCase()}`, 14, 31);
    let y = 40;
    doc.setFont('helvetica', 'bold'); doc.text('Checklist', 14, y); y += 6;
    doc.setFont('helvetica', 'normal');
    i.items.forEach((it) => {
      doc.text(`[${it.result.toUpperCase()}] ${it.label}${it.note ? ` — ${it.note}` : ''}`, 16, y);
      y += 6;
      if (y > 280) { doc.addPage(); y = 20; }
    });
    doc.save(`${dvirNo(i)}.pdf`);
    toast({ title: 'PDF exported', body: `${dvirNo(i)}.pdf`, status: 'ok' });
  };

  const columns: Column<Inspection>[] = [
    { key: 'at', header: 'Date / time', mono: true, width: '150px', render: (i) => fmtDateTimeEAT(i.at) },
    {
      key: 'driver', header: 'Driver', render: (i) => {
        const d = drivers.find((x) => x.id === i.driverId);
        return (
          <span className="flex items-center gap-2">
            {d && <Avatar name={d.name} size={26} />}
            <span className="text-[13px] font-medium text-ink-900">{d?.name ?? '—'}</span>
          </span>
        );
      },
    },
    {
      key: 'veh', header: 'Vehicle', width: '150px', render: (i) => {
        const v = vehicles.find((x) => x.id === i.vehicleId);
        return (
          <span className="flex items-center gap-1.5">
            {v && <PlateTag plate={v.plate} />}
            {v && doNotDrive.includes(v.id) && (
              <span title="DO-NOT-DRIVE"><ShieldAlert size={14} className="text-alert" /></span>
            )}
          </span>
        );
      },
    },
    {
      key: 'type', header: 'Type', width: '90px',
      render: (i) => (
        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
          i.kind === 'pre-trip' ? 'bg-accent-soft text-accent-strong' : 'bg-navy-900 text-white')}>
          {i.kind === 'pre-trip' ? 'PRE' : 'POST'}
        </span>
      ),
    },
    {
      key: 'result', header: 'Result', width: '120px',
      render: (i) => i.result === 'pass'
        ? <StatusPill status="ok" label="PASS" />
        : i.defectsCount <= 1
          ? <StatusPill status="warn" label="PASS W/ MINOR" />
          : <StatusPill status="alert" label="FAIL" />,
    },
    {
      key: 'defects', header: 'Defects', mono: true, align: 'center', width: '70px',
      render: (i) => <span className={cn('font-semibold', i.defectsCount > 0 ? 'text-alert-on-soft' : 'text-ink-400')}>{i.defectsCount}</span>,
    },
    {
      key: 'wo', header: 'Linked WO', mono: true, width: '140px',
      render: (i) => {
        const wo = i.workOrderId ? workOrders.find((w) => w.id === i.workOrderId) : null;
        return wo
          ? <span className="text-[12px] font-semibold text-accent-strong">{wo.number}</span>
          : <span className="text-ink-400">—</span>;
      },
    },
    {
      key: 'sig', header: 'Sig', align: 'center', width: '50px',
      render: () => <Check size={15} className="mx-auto text-ok" />,
    },
  ];

  const detailVehicle = detail ? vehicles.find((v) => v.id === detail.vehicleId) : null;
  const detailWo = detail?.workOrderId ? workOrders.find((w) => w.id === detail.workOrderId) : null;

  return (
    <div className="mx-auto flex max-w-[1520px] flex-col gap-4 p-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
        className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Inspections (DVIR)</h1>
          <p className="text-[13px] text-ink-400">Pre/post-trip digital vehicle inspection reports</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[{ d: 7, l: '7 d' }, { d: 30, l: '30 d' }, { d: 999, l: 'All' }].map((r) => (
              <button key={r.d} type="button" onClick={() => setDays(r.d)}
                className={cn('rounded-full px-2.5 py-1 font-mono text-micro font-semibold transition-colors',
                  days === r.d ? 'bg-accent-soft text-accent-strong' : 'text-ink-400 hover:bg-surface-muted')}>
                {r.l}
              </button>
            ))}
          </div>
          <button type="button" onClick={exportLog}
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 shadow-card hover:bg-surface-muted">
            <FileSpreadsheet size={15} /> Export Excel
          </button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05, ease: EASE }}
        className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KPIStatCard label="Today submitted" value={todayCount} icon={ClipboardCheck} />
        <KPIStatCard label="Pass rate 30d" value={passRate} format={(v) => `${Math.round(v)}%`} icon={BadgeCheck}
          delta="target 90%" deltaGood={passRate >= 78} />
        <KPIStatCard label="Open defects" value={openDefects.reduce((s, i) => s + i.defectsCount, 0)} icon={OctagonAlert}
          delta={`${openDefects.length} inspections`} />
        <KPIStatCard label="Vehicles DO-NOT-DRIVE" value={doNotDrive.length} icon={ShieldAlert}
          delta={doNotDrive.length > 0 ? 'mechanic review' : 'clear'} deltaGood={doNotDrive.length === 0} />
      </motion.div>

      <Tabs tabs={[{ key: 'log', label: 'DVIR log', count: rows.length }, { key: 'defects', label: 'Defects queue', count: openDefects.length }]}
        active={tab} onChange={setTab} />

      {tab === 'log' && (
        <DataTable
          columns={columns}
          rows={rows}
          pageSize={12}
          onRowClick={setDetail}
          rowActions={(i) => [
            { label: 'View', onClick: () => setDetail(i) },
            { label: 'PDF', icon: FileDown, onClick: () => exportPdf(i) },
          ]}
          empty={<EmptyState icon={ClipboardCheck} title="No inspections" hint="Driver DVIR submissions appear here." />}
        />
      )}

      {tab === 'defects' && (
        <div className="flex flex-col gap-2">
          {openDefects.length === 0 && (
            <div className="rounded-card border border-border bg-white shadow-card">
              <EmptyState icon={BadgeCheck} title="No open defects" hint="Defects from failed inspections queue here for a mechanic." />
            </div>
          )}
          {openDefects.map((i) => {
            const v = vehicles.find((x) => x.id === i.vehicleId);
            const d = drivers.find((x) => x.id === i.driverId);
            const ageH = Math.max(1, Math.round((DEMO_NOW_MS - new Date(i.at).getTime()) / 3600000) % 96 + hash01(i.id) * 30);
            const overdue = ageH > 48;
            const wo = i.workOrderId ? workOrders.find((w) => w.id === i.workOrderId) : null;
            return (
              <motion.div key={i.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
                className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-white px-4 py-3 shadow-card">
                <span className={cn('h-10 w-1 rounded-full', overdue ? 'bg-alert' : 'bg-warn')} />
                {v && <PlateTag plate={v.plate} />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink-900">
                    {i.items.filter((it) => it.result === 'defect').map((it) => it.label).join(' · ')}
                  </div>
                  <div className="font-mono text-[11px] text-ink-400">{dvirNo(i)} · {d?.name ?? ''} · {fmtDateTimeEAT(i.at)}</div>
                </div>
                <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11px] font-bold',
                  overdue ? 'bg-alert-soft text-alert-on-soft' : 'bg-warn-soft text-warn-on-soft')}>
                  {Math.floor(ageH / 24)} d {Math.round(ageH % 24)} h open
                </span>
                {wo && <span className="font-mono text-[11px] text-accent-strong">{wo.number}</span>}
                <button type="button"
                  onClick={() => {
                    add('audit', {
                      id: uid('aud'), at: nowIso(),
                      userId: 'usr-02', userName: 'Wanjiru Maina', action: 'update',
                      collection: 'inspections', recordId: i.id,
                      summary: `Defects from ${dvirNo(i)} assigned to Kevin Onyango (Mechanic)`,
                    });
                    toast({ title: 'Assigned to mechanic', body: 'Kevin Onyango notified. Logged to audit trail.', status: 'ok' });
                  }}
                  className="h-8 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white hover:bg-navy-800">
                  Assign to mechanic
                </button>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* detail drawer */}
      <Drawer open={!!detail} onClose={() => setDetail(null)}
        title={detail ? `${dvirNo(detail)} — ${detailVehicle?.plate ?? ''}` : ''}
        footer={detail && (
          <div className="flex gap-2">
            {!detailWo && detail.defectsCount > 0 && (
              <button type="button"
                onClick={async () => {
                  if (!detail || !detailVehicle) return;
                  const number = await nextSequence('wo');
                  const id = uid('wo');
                  add('workOrders', {
                    id, number, vehicleId: detail.vehicleId, source: 'dvir', status: 'open',
                    priority: 'medium',
                    title: `DVIR defects — ${detailVehicle.plate}`,
                    items: detail.items.filter((it) => it.result === 'defect')
                      .map((it) => ({ description: it.label + (it.note ? ` — ${it.note}` : ''), qty: 1, unitCostKes: 0 })),
                    laborCostKes: 0, vendorId: null,
                    openedAt: nowIso(), dueAt: null, completedAt: null,
                  });
                  update('inspections', detail.id, { workOrderId: id });
                  setDetail({ ...detail, workOrderId: id });
                  toast({ title: `Work order ${number} created`, status: 'ok' });
                }}
                className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
                <Wrench size={14} /> Create work order from defects
              </button>
            )}
            {detail.defectsCount > 0 && (
              <button type="button"
                onClick={() => {
                  if (!detail) return;
                  if (detailWo) update('workOrders', detailWo.id, { status: 'done', completedAt: nowIso() });
                  if (detailVehicle) kvSet('doNotDrive', doNotDrive.filter((x) => x !== detailVehicle.id));
                  add('audit', {
                    id: uid('aud'), at: nowIso(),
                    userId: 'usr-04', userName: 'Kevin Onyango', action: 'update',
                    collection: 'inspections', recordId: detail.id,
                    summary: `Defects resolved — ${dvirNo(detail)}${detailVehicle ? ` · ${detailVehicle.plate} cleared to drive` : ''}`,
                  });
                  toast({ title: 'Defects marked resolved', body: detailVehicle ? `${detailVehicle.plate} cleared to drive.` : '', status: 'ok' });
                  setDetail(null);
                }}
                className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">
                Mark defects resolved
              </button>
            )}
          </div>
        )}>
        {detail && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              {[
                { k: 'Driver', v: drivers.find((x) => x.id === detail.driverId)?.name ?? '—' },
                { k: 'Vehicle', v: `${detailVehicle?.plate ?? ''} · ${detailVehicle?.model ?? ''}` },
                { k: 'Type', v: detail.kind.toUpperCase() },
                { k: 'Odometer', v: `${fmtNum(detail.odometerKm)} km` },
                { k: 'Result', v: detail.result.toUpperCase() },
                { k: 'Work order', v: detailWo?.number ?? '—' },
              ].map((f) => (
                <div key={f.k} className="rounded-lg border border-border px-3 py-2">
                  <div className="text-micro uppercase tracking-[0.06em] text-ink-400">{f.k}</div>
                  <div className="font-mono text-[12px] font-semibold text-ink-900">{f.v}</div>
                </div>
              ))}
            </div>

            {detailVehicle && doNotDrive.includes(detailVehicle.id) && (
              <motion.div
                animate={{ boxShadow: ['0 0 0 0 rgba(220,38,38,0)', '0 0 18px 2px rgba(220,38,38,.3)', '0 0 0 0 rgba(220,38,38,0)'] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="flex items-center gap-2 rounded-card bg-alert-soft px-4 py-3 text-[13px] font-semibold text-alert-on-soft">
                <ShieldAlert size={16} /> DO-NOT-DRIVE — awaiting mechanic review.
              </motion.div>
            )}

            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-400">Checklist readout</div>
              <div className="flex flex-col gap-1.5">
                {detail.items.map((it) => (
                  <div key={it.key} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2',
                    it.result === 'defect' ? 'border-alert/30 bg-alert-soft/40' : 'border-border/60')}>
                    {it.result === 'ok' && <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ok-soft text-ok-on-soft"><Check size={10} /></span>}
                    {it.result === 'defect' && <TriangleAlert size={14} className="mt-0.5 text-alert" />}
                    {it.result === 'na' && <span className="mt-0.5 text-ink-400">—</span>}
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-ink-900">{it.label}</div>
                      {it.note && <div className="text-[12px] text-alert-on-soft">{it.note}</div>}
                      {it.photo && <div className="mt-0.5 font-mono text-[10px] text-ink-400">photo: {it.photo}</div>}
                    </div>
                    <span className={cn('font-mono text-[10px] font-bold uppercase',
                      it.result === 'ok' ? 'text-ok-on-soft' : it.result === 'defect' ? 'text-alert-on-soft' : 'text-ink-400')}>
                      {it.result}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/60 pt-2 font-mono text-[11px] text-ink-400">
              Signed by driver · submitted {fmtDateTimeEAT(detail.at)} · audit trail updated
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
