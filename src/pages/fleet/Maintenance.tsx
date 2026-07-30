// FBV FleetOS — /maintenance Work Orders (design/maintenance.md).
// Kanban lifecycle: create → approve → in-progress → done with cost capture.

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BadgeCheck, Check, Clock, Download, GripVertical, Info, Plus, Search,
  Table as TableIcon, KanbanSquare, Wrench, X,
} from 'lucide-react';
import {
  AlertBanner, DataTable, Drawer, KPIStatCard, Modal, PlateTag, StatusPill,
  toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { useAuth } from '@/hooks/useAuth';
import { add, nextSequence, update, useCollection } from '@/lib/store';
import { fmtDateEAT, fmtKES, fmtNum } from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type { Part, Vehicle, Vendor, WorkOrder, WorkOrderItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Avatar, MaintSubNav, auditLog, demoDaysAgo,
  driverById, exportXlsx, isMtd, isWoOverdue, nowIsoEAT,
  useLocalKV, vendorById, woEstimate,
} from './lib';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const MECHANIC = 'Kevin Onyango';

const SOURCE_CHIP: Record<WorkOrder['source'], { label: string; cls: string }> = {
  dvir: { label: 'DVIR', cls: 'bg-accent-soft text-accent-strong' },
  dtc: { label: 'DTC', cls: 'bg-alert-soft text-alert-on-soft' },
  schedule: { label: 'SCHEDULE', cls: 'bg-navy-900 text-white' },
  manual: { label: 'MANUAL', cls: 'bg-inactive-soft text-inactive-on-soft' },
};

const STATUS_META: Record<WorkOrder['status'], { key: StatusKey; label: string }> = {
  open: { key: 'info', label: 'AWAITING APPROVAL' },
  approved: { key: 'warn', label: 'APPROVED' },
  'in-progress': { key: 'info', label: 'IN PROGRESS' },
  done: { key: 'ok', label: 'DONE' },
  cancelled: { key: 'inactive', label: 'CANCELLED' },
};

const PRIORITY_DOT: Record<WorkOrder['priority'], string> = {
  high: 'bg-alert', medium: 'bg-warn', low: 'bg-inactive',
};

interface WoNote { at: string; by: string; text: string }
interface WoActual { actual: number; invoice: string; method: string }

/* ---------------- cost capture modal ---------------- */

function CostCaptureModal({ wo, vehicle, onClose, onDone }: {
  wo: WorkOrder | null; vehicle?: Vehicle;
  onClose: () => void; onDone: (actual: WoActual) => void;
}) {
  if (!wo) return null;
  return <CostCaptureForm key={wo.id} wo={wo} vehicle={vehicle} onClose={onClose} onDone={onDone} />;
}

function CostCaptureForm({ wo, vehicle, onClose, onDone }: {
  wo: WorkOrder; vehicle?: Vehicle;
  onClose: () => void; onDone: (actual: WoActual) => void;
}) {
  const est = woEstimate(wo);
  const [actual, setActual] = useState(String(est));
  const [invoice, setInvoice] = useState('');
  const [method, setMethod] = useState('Bank transfer');
  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  return (
    <Modal open={!!wo} onClose={onClose} title={`Complete ${wo?.number ?? ''} — cost capture`}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!invoice.trim() || Number(actual) <= 0}
            onClick={() => onDone({ actual: Number(actual), invoice: invoice.trim(), method })}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
            Log cost & mark done
          </button>
        </>
      }>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-[13px]">
          <span className="text-ink-600">Estimate</span>
          <span className="font-mono font-semibold text-ink-900">{fmtKES(est)}</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Actual cost (KES)</span>
          <input value={actual} onChange={(e) => setActual(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} />
          {Number(actual) !== est && est > 0 && (
            <span className={cn('text-micro font-semibold', Number(actual) > est ? 'text-alert-on-soft' : 'text-ok-on-soft')}>
              {Number(actual) > est ? '+' : '−'}{fmtKES(Math.abs(Number(actual) - est))} vs estimate
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Invoice no.</span>
          <input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="INV-2026-…" className={cn(input, 'font-mono')} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Payment method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
            {['Bank transfer', 'M-Pesa Till', 'Corporate card', 'Cash'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <p className="rounded-lg bg-accent-soft/50 px-3 py-2 text-[12px] text-ink-600">
          Parts on this work order are deducted from inventory, and the cost is logged to {vehicle?.plate ?? 'the vehicle'} TCO.
        </p>
      </div>
    </Modal>
  );
}

/* ---------------- WO detail drawer ---------------- */

const STEPS = ['Create', 'Approve', 'In progress', 'Done'];

function WoStepper({ status }: { status: WorkOrder['status'] }) {
  const idx = status === 'open' ? 0 : status === 'approved' ? 1 : status === 'in-progress' ? 2 : 3;
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s} className="flex flex-1 flex-col gap-1">
          <div className="h-1 overflow-hidden rounded-full bg-surface-muted">
            <motion.div initial={{ width: 0 }} animate={{ width: i <= idx ? '100%' : '0%' }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className={cn('h-full rounded-full', i < idx ? 'bg-ok' : i === idx ? 'bg-accent' : '')} />
          </div>
          <span className={cn('text-[10px] font-semibold', i <= idx ? 'text-ink-900' : 'text-ink-400')}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function WoDrawer({ woId, vehicles, vendors, parts, role, onClose, onStatus, onComplete }: {
  woId: string | null; vehicles: Vehicle[]; vendors: Vendor[]; parts: Part[];
  role: string; onClose: () => void;
  onStatus: (wo: WorkOrder, s: WorkOrder['status']) => void;
  onComplete: (wo: WorkOrder) => void;
}) {
  const workOrders = useCollection('workOrders');
  const drivers = useCollection('drivers');
  const wo = workOrders.find((w) => w.id === woId) ?? null;
  const [notes, setNotes] = useLocalKV<Record<string, WoNote[]>>('woNotes', {});
  const [noteText, setNoteText] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [partSel, setPartSel] = useState('');
  const [partQty, setPartQty] = useState('1');

  if (!wo) return <Drawer open={!!woId} onClose={onClose} title="Work order"><div /></Drawer>;

  const vehicle = vehicles.find((x) => x.id === wo.vehicleId);
  const woNotes = notes[wo.id] ?? [];
  const est = woEstimate(wo);
  const canApprove = role === 'Admin' || role === 'Fleet Manager';
  const dtcMatch = wo.source === 'dtc' ? wo.title.match(/([PU]\d{4})/) : null;

  const pushNote = (text: string, by = 'Wanjiru Maina') => {
    setNotes({ ...notes, [wo.id]: [...woNotes, { at: nowIsoEAT(11, 45), by, text }] });
  };

  const approve = () => {
    if (!canApprove) {
      toast({ title: 'Needs Fleet Manager approval', body: 'Your role cannot approve work orders.', status: 'warn' });
      return;
    }
    onStatus(wo, 'approved');
    auditLog('update', 'workOrders', wo.id, `WO ${wo.number} approved (${fmtKES(est)})`);
    toast({ title: 'Work order approved', body: `${wo.number} · ${fmtKES(est)}`, status: 'ok' });
  };

  const reject = () => {
    if (!rejectReason.trim()) return;
    pushNote(`Rejected — ${rejectReason.trim()}`);
    auditLog('update', 'workOrders', wo.id, `WO ${wo.number} rejected: ${rejectReason.trim()}`);
    toast({ title: 'Work order rejected', body: 'Returned to New with your reason noted.', status: 'warn' });
    setRejectOpen(false);
    setRejectReason('');
  };

  const addLine = () => {
    const part = parts.find((p) => p.id === partSel);
    if (!part) return;
    const qty = Math.max(1, Number(partQty) || 1);
    const item: WorkOrderItem = { description: part.name, qty, unitCostKes: part.unitCostKes, partId: part.id };
    update('workOrders', wo.id, { items: [...wo.items, item] });
    setPartSel('');
    setPartQty('1');
  };

  return (
    <Drawer open={!!woId} onClose={onClose} width={520}
      title={
        <div className="flex items-center gap-2">
          <span className="font-mono">{wo.number}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold', SOURCE_CHIP[wo.source].cls)}>{SOURCE_CHIP[wo.source].label}</span>
        </div>
      }>
      <div className="flex flex-col gap-5">
        <WoStepper status={wo.status} />

        {/* vehicle block */}
        {vehicle && (
          <div className="flex items-center gap-3 rounded-card border border-border p-3">
            <PlateTag plate={vehicle.plate} />
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-ink-900">{vehicle.model} · {vehicle.year}</div>
              <div className="font-mono text-micro text-ink-400">odometer at report {fmtNum(Math.max(0, vehicle.odometerKm - demoDaysAgo(wo.openedAt) * 180))} km</div>
            </div>
            {wo.source === 'dvir' && (
              <span className="text-micro text-ink-400">reported by {driverById(drivers, vehicle.assignedDriverId)?.name ?? 'driver'}</span>
            )}
            {dtcMatch && (
              <span className="rounded-md bg-navy-900 px-2 py-1 font-mono text-[11px] font-semibold text-white" title="Brake switch circuit A">
                {dtcMatch[1]}
              </span>
            )}
          </div>
        )}

        <div>
          <div className="text-[13px] font-semibold text-ink-900">{wo.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-micro text-ink-400">
            <span>opened {fmtDateEAT(wo.openedAt)}</span>
            {wo.dueAt && (
              <span className={cn('font-mono font-semibold', isWoOverdue(wo) ? 'text-alert-on-soft' : '')}>
                · due {fmtDateEAT(wo.dueAt)}{isWoOverdue(wo) && ' — OVERDUE'}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-micro uppercase tracking-[0.06em] text-ink-400">Priority</span>
            {(['low', 'medium', 'high'] as const).map((p) => (
              <button key={p} type="button"
                onClick={() => update('workOrders', wo.id, { priority: p })}
                className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-semibold',
                  wo.priority === p ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border text-ink-400 hover:bg-surface-muted')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_DOT[p])} /> {p}
              </button>
            ))}
          </div>
        </div>

        {/* line items */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Line items</div>
          <table className="w-full text-table">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-400">
                <th className="pb-1">Description</th><th className="pb-1 text-right">Qty</th>
                <th className="pb-1 text-right">Unit</th><th className="pb-1 text-right">Total</th><th />
              </tr>
            </thead>
            <tbody>
              {wo.items.map((it, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="py-1.5">
                    {it.description}
                    {it.partId && <span className="ml-1.5 font-mono text-micro text-accent-strong">{parts.find((p) => p.id === it.partId)?.sku}</span>}
                  </td>
                  <td className="py-1.5 text-right font-mono">{it.qty}</td>
                  <td className="py-1.5 text-right font-mono">{fmtKES(it.unitCostKes)}</td>
                  <td className="py-1.5 text-right font-mono">{fmtKES(it.qty * it.unitCostKes)}</td>
                  <td className="py-1.5 text-right">
                    {wo.status !== 'done' && (
                      <button type="button" title="Remove line"
                        onClick={() => update('workOrders', wo.id, { items: wo.items.filter((_, k) => k !== i) })}
                        className="text-ink-400 hover:text-alert"><X size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-border/60">
                <td className="py-1.5 text-ink-600">Labour</td>
                <td className="py-1.5 text-right font-mono">—</td><td />
                <td className="py-1.5 text-right font-mono">{fmtKES(wo.laborCostKes)}</td>
                <td />
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td className="py-2 text-[13px] font-semibold" colSpan={3}>Running total</td>
                <td className="py-2 text-right font-mono text-[14px] font-bold text-ink-900">{fmtKES(est)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {wo.status !== 'done' && (
            <div className="mt-2 flex items-center gap-2">
              <select value={partSel} onChange={(e) => setPartSel(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-border px-2 text-[12px] outline-none focus:border-accent">
                <option value="">+ add part from inventory…</option>
                {parts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name} ({p.qty} in stock)</option>)}
              </select>
              <input value={partQty} onChange={(e) => setPartQty(e.target.value.replace(/\D/g, ''))}
                className="h-8 w-14 rounded-lg border border-border px-2 text-center font-mono text-[12px] outline-none focus:border-accent" />
              <button type="button" disabled={!partSel} onClick={addLine}
                className="h-8 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white hover:bg-navy-800 disabled:opacity-40">Add</button>
            </div>
          )}
        </div>

        {/* vendor */}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Vendor / garage</span>
          <select value={wo.vendorId ?? ''} onChange={(e) => update('workOrders', wo.id, { vendorId: e.target.value || null })}
            className="h-9 rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent">
            <option value="">— in-house —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.location}</option>)}
          </select>
        </label>

        {/* approval strip */}
        {wo.status === 'open' && (
          <div className="rounded-card border border-info/30 bg-info-soft/50 p-3">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span className="font-semibold text-ink-900">Awaiting approval</span>
              <span className="font-mono font-semibold">{fmtKES(est)}</span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={approve} title={canApprove ? '' : 'Manager approval required'}
                className={cn('h-9 flex-1 rounded-lg text-[13px] font-semibold transition-colors',
                  canApprove ? 'bg-accent text-navy-950 hover:bg-accent-strong' : 'cursor-not-allowed bg-inactive-soft text-inactive-on-soft')}>
                Approve
              </button>
              <button type="button" onClick={() => setRejectOpen(true)}
                className="h-9 flex-1 rounded-lg border border-alert text-[13px] font-semibold text-alert hover:bg-alert-soft">
                Reject
              </button>
            </div>
            {!canApprove && <p className="mt-1.5 text-micro text-ink-600">Manager approval required — your role ({role}) can view but not approve.</p>}
          </div>
        )}

        {(wo.status === 'approved' || wo.status === 'in-progress') && (
          <div className="flex gap-2">
            {wo.status === 'approved' && (
              <button type="button" onClick={() => { onStatus(wo, 'in-progress'); toast({ title: 'Work started', body: wo.number, status: 'info' }); }}
                className="h-9 flex-1 rounded-lg bg-navy-900 text-[13px] font-semibold text-white hover:bg-navy-800">
                Start work
              </button>
            )}
            <button type="button" onClick={() => onComplete(wo)}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
              <Check size={15} /> Mark done
            </button>
          </div>
        )}

        {/* notes thread */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Notes</div>
          <div className="flex flex-col gap-2">
            {woNotes.length === 0 && <p className="text-[12px] text-ink-400">No notes yet.</p>}
            {woNotes.map((n, i) => (
              <div key={i} className="rounded-lg bg-surface-muted px-3 py-2">
                <div className="text-[12px] text-ink-900">{n.text}</div>
                <div className="mt-0.5 font-mono text-micro text-ink-400">{n.by} · {fmtDateEAT(n.at)}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note…"
              className="h-8 flex-1 rounded-lg border border-border px-3 text-[12px] outline-none focus:border-accent" />
            <button type="button" disabled={!noteText.trim()}
              onClick={() => { pushNote(noteText.trim()); setNoteText(''); }}
              className="h-8 rounded-lg border border-border px-3 text-[12px] font-semibold text-ink-600 hover:bg-surface-muted disabled:opacity-40">
              Post
            </button>
          </div>
        </div>

        <p className="text-micro text-ink-400">Attachments — invoice photo attaches here once captured at the garage.</p>
      </div>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title={`Reject ${wo.number}`}
        footer={
          <>
            <button type="button" onClick={() => setRejectOpen(false)}
              className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
            <button type="button" disabled={!rejectReason.trim()} onClick={reject}
              className="h-9 rounded-lg bg-alert px-4 text-[13px] font-semibold text-white hover:bg-alert-on-soft disabled:opacity-40">Reject WO</button>
          </>
        }>
        <label className="flex flex-col gap-1 text-[13px] text-ink-600">
          Reason (required — added to the notes thread)
          <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
            className="rounded-lg border border-border px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </label>
      </Modal>
    </Drawer>
  );
}

/* ---------------- WO card ---------------- */

function WoCard({ wo, vehicle, vendor, index, onOpen }: {
  wo: WorkOrder; vehicle?: Vehicle; vendor?: Vendor; index: number; onOpen: () => void;
}) {
  const overdue = isWoOverdue(wo);
  return (
    <motion.button
      type="button"
      draggable
      onDragStart={(e) => {
        const dt = (e as unknown as React.DragEvent<HTMLButtonElement>).dataTransfer;
        dt.setData('text/wo-id', wo.id);
        dt.effectAllowed = 'move';
      }}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: EASE }}
      onClick={onOpen}
      className={cn(
        'group flex w-full cursor-grab flex-col gap-2 rounded-card border border-border bg-white p-3.5 text-left shadow-card',
        'transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop active:cursor-grabbing',
        overdue && 'border-l-4 border-l-alert',
      )}
    >
      <div className="flex items-center gap-2">
        <GripVertical size={13} className="text-ink-400/50" />
        <span className="font-mono text-[12px] font-semibold text-ink-900">{wo.number}</span>
        <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-[0.04em]', SOURCE_CHIP[wo.source].cls)}>
          {SOURCE_CHIP[wo.source].label}
        </span>
        <span className={cn('ml-auto h-2 w-2 rounded-full', PRIORITY_DOT[wo.priority])} title={`${wo.priority} priority`} />
      </div>
      <div className="text-[14px] font-semibold leading-5 text-ink-900">{wo.title}</div>
      <div className="flex flex-wrap items-center gap-2 text-micro text-ink-400">
        {vehicle && <PlateTag plate={vehicle.plate} />}
        {vehicle && <span className="text-ink-600">{vehicle.make}</span>}
        {vendor && <span>· {vendor.name}</span>}
        {wo.dueAt && (
          <span className={cn('font-mono font-semibold', overdue ? 'text-alert-on-soft' : 'text-ink-600')}>
            Due {fmtDateEAT(wo.dueAt).replace(' 2026', '')}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="font-mono text-[12px] font-semibold text-ink-900">{fmtKES(woEstimate(wo))}</span>
        <span className="text-micro text-ink-400">{demoDaysAgo(wo.openedAt)} d open</span>
        <span className="flex items-center gap-1 text-micro text-ink-400">
          <Avatar name={MECHANIC} size={18} /> {MECHANIC.split(' ')[0]}
        </span>
      </div>
    </motion.button>
  );
}

/* ---------------- new WO modal ---------------- */

function NewWoModal({ open, prefill, vehicles, vendors, parts, onClose, onCreated }: {
  open: boolean;
  prefill?: { vehicleId?: string; source?: WorkOrder['source']; title?: string; vendorId?: string } | null;
  vehicles: Vehicle[]; vendors: Vendor[]; parts: Part[];
  onClose: () => void; onCreated: (wo: WorkOrder) => void;
}) {
  if (!open) return null;
  return <NewWoForm key={JSON.stringify(prefill ?? {})} prefill={prefill} vehicles={vehicles}
    vendors={vendors} parts={parts} onClose={onClose} onCreated={onCreated} />;
}

function NewWoForm({ prefill, vehicles, vendors, parts, onClose, onCreated }: {
  prefill?: { vehicleId?: string; source?: WorkOrder['source']; title?: string; vendorId?: string } | null;
  vehicles: Vehicle[]; vendors: Vendor[]; parts: Part[];
  onClose: () => void; onCreated: (wo: WorkOrder) => void;
}) {
  const [vehicleId, setVehicleId] = useState(prefill?.vehicleId ?? '');
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [priority, setPriority] = useState<WorkOrder['priority']>('medium');
  const [vendorId, setVendorId] = useState(prefill?.vendorId ?? '');
  const [due, setDue] = useState('');
  const [labor, setLabor] = useState('5000');
  const [lines, setLines] = useState<WorkOrderItem[]>([]);
  const [partSel, setPartSel] = useState('');
  const [partQty, setPartQty] = useState('1');
  const [saving, setSaving] = useState(false);

  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const label = 'text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400';
  const total = lines.reduce((s, l) => s + l.qty * l.unitCostKes, 0) + (Number(labor) || 0);

  const save = async () => {
    setSaving(true);
    const number = await nextSequence('wo');
    const wo = add('workOrders', {
      id: `wo-${number.slice(-6)}`,
      number, vehicleId,
      source: prefill?.source ?? 'manual',
      status: 'open', priority, title: title.trim(),
      items: lines, laborCostKes: Number(labor) || 0,
      vendorId: vendorId || null,
      openedAt: nowIsoEAT(10, 30),
      dueAt: due || null, completedAt: null,
    });
    auditLog('create', 'workOrders', wo.id, `Created WO ${number} — ${title.trim()}`);
    toast({ title: 'Work order created', body: `${number} · awaiting approval`, status: 'ok' });
    setSaving(false);
    onCreated(wo);
    onClose();
  };

  return (
    <Modal open onClose={onClose} wide title="New work order"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={saving || !vehicleId || !title.trim()} onClick={save}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
            {saving ? 'Creating…' : `Create · ${fmtKES(total)}`}
          </button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1"><span className={label}>Vehicle</span>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={input}>
            <option value="">— select vehicle —</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.model}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span className={label}>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as WorkOrder['priority'])} className={input}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select></label>
        <label className="col-span-2 flex flex-col gap-1"><span className={label}>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Front brake pads + discs" className={input} /></label>
        <label className="flex flex-col gap-1"><span className={label}>Vendor / garage</span>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={input}>
            <option value="">— in-house —</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span className={label}>Due date</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cn(input, 'font-mono')} /></label>

        <div className="col-span-2">
          <span className={label}>Line items</span>
          {lines.length > 0 && (
            <table className="mt-1 w-full text-table">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="py-1">{l.description}</td>
                    <td className="py-1 text-right font-mono">{l.qty}</td>
                    <td className="py-1 text-right font-mono">{fmtKES(l.qty * l.unitCostKes)}</td>
                    <td className="py-1 text-right">
                      <button type="button" onClick={() => setLines(lines.filter((_, k) => k !== i))}
                        className="text-ink-400 hover:text-alert"><X size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            <select value={partSel} onChange={(e) => setPartSel(e.target.value)}
              className="h-8 flex-1 rounded-lg border border-border px-2 text-[12px] outline-none focus:border-accent">
              <option value="">+ add part from inventory…</option>
              {parts.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
            <input value={partQty} onChange={(e) => setPartQty(e.target.value.replace(/\D/g, ''))}
              className="h-8 w-14 rounded-lg border border-border px-2 text-center font-mono text-[12px] outline-none focus:border-accent" />
            <button type="button" disabled={!partSel}
              onClick={() => {
                const p = parts.find((x) => x.id === partSel);
                if (!p) return;
                setLines([...lines, { description: p.name, qty: Math.max(1, Number(partQty) || 1), unitCostKes: p.unitCostKes, partId: p.id }]);
                setPartSel(''); setPartQty('1');
              }}
              className="h-8 rounded-lg bg-navy-900 px-3 text-[12px] font-semibold text-white hover:bg-navy-800 disabled:opacity-40">Add</button>
          </div>
        </div>

        <label className="flex flex-col gap-1"><span className={label}>Labour (KES)</span>
          <input value={labor} onChange={(e) => setLabor(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
        <div className="flex items-end justify-end">
          <span className="text-[13px] text-ink-600">Estimate <b className="font-mono text-ink-900">{fmtKES(total)}</b></span>
        </div>
        <p className="col-span-2 rounded-lg bg-surface-muted px-3 py-2 text-[12px] text-ink-600">
          Source: {SOURCE_CHIP[prefill?.source ?? 'manual'].label} · WO number is assigned atomically on save (FBV-WO sequence).
        </p>
      </div>
    </Modal>
  );
}

/* ---------------- main page ---------------- */

const COLUMNS: { status: WorkOrder['status']; title: string }[] = [
  { status: 'open', title: 'New / Awaiting approval' },
  { status: 'approved', title: 'Approved' },
  { status: 'in-progress', title: 'In progress' },
  { status: 'done', title: 'Done — last 30 days' },
];

export default function Maintenance() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? 'Fleet Manager';

  const vehicles = useCollection('vehicles');
  const vendors = useCollection('vendors');
  const parts = useCollection('parts');
  const workOrders = useCollection('workOrders');
  const [actuals, setActuals] = useLocalKV<Record<string, WoActual>>('woActuals', {});

  const [view, setView] = useState<'kanban' | 'table'>('kanban');
  const [drawerWo, setDrawerWo] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ vehicleId?: string; source?: WorkOrder['source']; title?: string; vendorId?: string } | null>(null);
  const [completeWo, setCompleteWo] = useState<WorkOrder | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [dragOver, setDragOver] = useState<WorkOrder['status'] | null>(null);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState<'all' | WorkOrder['status']>('all');
  const [fSource, setFSource] = useState<'all' | WorkOrder['source']>('all');

  // deep-link: /maintenance with state {newWo:{...}} from schedules/parts/vehicle pages
  const navNewWo = (location.state as {
    newWo?: { vehicleId?: string; source?: WorkOrder['source']; title?: string; vendorId?: string };
  } | null)?.newWo;
  const [seenNav, setSeenNav] = useState<typeof navNewWo>(undefined);
  if (navNewWo && navNewWo !== seenNav) {
    setSeenNav(navNewWo);
    setPrefill(navNewWo);
    setNewOpen(true);
  }
  useEffect(() => {
    if (navNewWo) navigate(location.pathname, { replace: true, state: null });
  }, [navNewWo, location.pathname, navigate]);

  const kpis = useMemo(() => {
    const open = workOrders.filter((w) => w.status !== 'done' && w.status !== 'cancelled');
    const spend = workOrders
      .filter((w) => w.status === 'done' && w.completedAt && isMtd(w.completedAt))
      .reduce((s, w) => s + (actuals[w.id]?.actual ?? woEstimate(w)), 0);
    return {
      open: open.length,
      awaiting: workOrders.filter((w) => w.status === 'open').length,
      inProgress: workOrders.filter((w) => w.status === 'in-progress').length,
      overdue: open.filter(isWoOverdue).length,
      spend,
    };
  }, [workOrders, actuals]);

  const filtered = useMemo(() => workOrders.filter((w) => {
    if (fStatus !== 'all' && w.status !== fStatus) return false;
    if (fSource !== 'all' && w.source !== fSource) return false;
    if (q.trim()) {
      const v = vehicles.find((x) => x.id === w.vehicleId);
      const hay = `${w.number} ${w.title} ${v?.plate ?? ''} ${v?.model ?? ''}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [workOrders, fStatus, fSource, q, vehicles]);

  const byStatus = (s: WorkOrder['status']) =>
    filtered.filter((w) => w.status === s)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .filter((w) => s !== 'done' || (w.completedAt && demoDaysAgo(w.completedAt) <= 30));

  const canApprove = role === 'Admin' || role === 'Fleet Manager';

  const setStatus = (wo: WorkOrder, s: WorkOrder['status']) => {
    update('workOrders', wo.id, { status: s });
    auditLog('update', 'workOrders', wo.id, `WO ${wo.number} → ${s}`);
  };

  const handleDrop = (woId: string, target: WorkOrder['status']) => {
    const wo = workOrders.find((w) => w.id === woId);
    if (!wo || wo.status === target) return;
    if (target === 'approved' && !canApprove) {
      toast({ title: 'Needs Fleet Manager approval', body: `Your role (${role}) cannot approve work orders.`, status: 'warn' });
      return;
    }
    if (target === 'done') {
      setCompleteWo(wo);
      return;
    }
    setStatus(wo, target);
    toast({ title: 'Work order moved', body: `${wo.number} → ${STATUS_META[target].label.toLowerCase()}`, status: 'info' });
  };

  const completeWithCost = (a: WoActual) => {
    const wo = completeWo;
    if (!wo) return;
    update('workOrders', wo.id, { status: 'done', completedAt: nowIsoEAT(16, 0) });
    setActuals({ ...actuals, [wo.id]: a });
    // decrement parts stock for linked lines
    for (const it of wo.items) {
      if (it.partId) {
        const p = parts.find((x) => x.id === it.partId);
        if (p) update('parts', p.id, { qty: Math.max(0, p.qty - it.qty) });
      }
    }
    const plate = vehicles.find((x) => x.id === wo.vehicleId)?.plate ?? '';
    auditLog('update', 'workOrders', wo.id, `WO ${wo.number} done — ${fmtKES(a.actual)} (invoice ${a.invoice}, ${a.method})`);
    toast({ title: 'WO done', body: `${fmtKES(a.actual)} logged to ${plate} TCO`, status: 'ok' });
    setCompleteWo(null);
  };

  const columns: Column<WorkOrder>[] = [
    { key: 'num', header: 'WO #', mono: true, render: (w) => <span className="font-semibold">{w.number}</span> },
    { key: 'status', header: 'Status', render: (w) => <StatusPill status={STATUS_META[w.status].key} label={STATUS_META[w.status].label} /> },
    { key: 'source', header: 'Source', render: (w) => <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', SOURCE_CHIP[w.source].cls)}>{SOURCE_CHIP[w.source].label}</span> },
    { key: 'prio', header: 'Priority', render: (w) => <span className="flex items-center gap-1.5 capitalize"><span className={cn('h-2 w-2 rounded-full', PRIORITY_DOT[w.priority])} />{w.priority}</span> },
    { key: 'veh', header: 'Vehicle', render: (w) => { const v = vehicles.find((x) => x.id === w.vehicleId); return v ? <PlateTag plate={v.plate} /> : '—'; } },
    { key: 'title', header: 'Title', render: (w) => <span className="font-medium">{w.title}</span> },
    { key: 'vendor', header: 'Vendor', render: (w) => vendorById(vendors, w.vendorId)?.name ?? 'In-house' },
    { key: 'est', header: 'Est. cost', mono: true, align: 'right', render: (w) => fmtKES(woEstimate(w)) },
    { key: 'act', header: 'Actual', mono: true, align: 'right', render: (w) => actuals[w.id] ? fmtKES(actuals[w.id].actual) : '—' },
    { key: 'opened', header: 'Opened', mono: true, render: (w) => fmtDateEAT(w.openedAt) },
    {
      key: 'due', header: 'Due', mono: true, render: (w) => w.dueAt
        ? <span className={isWoOverdue(w) ? 'font-semibold text-alert-on-soft' : ''}>{fmtDateEAT(w.dueAt)}</span> : '—',
    },
    { key: 'age', header: 'Age', mono: true, align: 'right', render: (w) => `${demoDaysAgo(w.openedAt)} d` },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="mx-auto flex max-w-[1520px] flex-col gap-5 p-6">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Maintenance</h1>
          <div className="mt-1"><MaintSubNav active="wo" /></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border bg-white">
            <button type="button" onClick={() => setView('kanban')}
              className={cn('flex h-9 items-center gap-1.5 px-3 text-[12px] font-semibold', view === 'kanban' ? 'bg-accent-soft text-accent-strong' : 'text-ink-600 hover:bg-surface-muted')}>
              <KanbanSquare size={14} /> Kanban
            </button>
            <button type="button" onClick={() => setView('table')}
              className={cn('flex h-9 items-center gap-1.5 px-3 text-[12px] font-semibold', view === 'table' ? 'bg-accent-soft text-accent-strong' : 'text-ink-600 hover:bg-surface-muted')}>
              <TableIcon size={14} /> Table
            </button>
          </div>
          <button type="button"
            onClick={() => exportXlsx('work-orders-jul-2026.xlsx', filtered.map((w) => ({
              'WO #': w.number, Status: w.status, Source: w.source, Priority: w.priority,
              Vehicle: vehicles.find((x) => x.id === w.vehicleId)?.plate ?? '',
              Title: w.title, Vendor: vendorById(vendors, w.vendorId)?.name ?? 'In-house',
              'Estimate (KES)': woEstimate(w), 'Actual (KES)': actuals[w.id]?.actual ?? '',
              Opened: fmtDateEAT(w.openedAt), Due: w.dueAt ? fmtDateEAT(w.dueAt) : '',
            })), 'Work orders')}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={15} /> Export
          </button>
          <button type="button" onClick={() => { setPrefill(null); setNewOpen(true); }}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
            <Plus size={15} /> New work order
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KPIStatCard label="Open" value={kpis.open} icon={Wrench} sparkColor="#F59E0B" spark={[3, 4, 4, 5, 5, 5, kpis.open]} />
        <KPIStatCard label="Awaiting approval" value={kpis.awaiting} icon={Clock} sparkColor="#2563EB" spark={[1, 2, 2, 3, 2, 2, kpis.awaiting]} />
        <KPIStatCard label="In progress" value={kpis.inProgress} icon={GripVertical} spark={[1, 1, 2, 2, 1, 2, kpis.inProgress]} />
        <KPIStatCard label="Overdue" value={kpis.overdue} icon={Info} delta="past due date" deltaGood={false} sparkColor="#DC2626" spark={[0, 0, 1, 0, 1, 1, kpis.overdue]} />
        <KPIStatCard label="Spend this month" value={kpis.spend} icon={BadgeCheck} format={(v) => fmtKES(v, { compact: true })} sparkColor="#0F2540" spark={[120, 180, 150, 260, 310, 380, kpis.spend / 1000]} />
      </div>

      <AlertBanner severity="warn" className="rounded-card"
        message="DVIR defects and DTC faults open work orders automatically. Schedules create reminder WOs 500 km / 7 days before due."
        actionLabel="Schedules & DTC →" onAction={() => navigate('/maintenance/schedules')} />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WO #, title or plate…"
            className="h-9 w-64 rounded-lg border border-border bg-white pl-8 pr-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </div>
        {(['all', 'open', 'approved', 'in-progress', 'done'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setFStatus(s)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', fStatus === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {s === 'all' ? 'Any status' : STATUS_META[s].label.toLowerCase()}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {(['all', 'manual', 'dvir', 'dtc', 'schedule'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setFSource(s)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', fSource === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {s === 'all' ? 'Any source' : SOURCE_CHIP[s].label}
          </button>
        ))}
      </div>

      {view === 'kanban' ? (
        <div className="grid grid-cols-1 gap-4 overflow-x-auto md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col, ci) => {
            const rows = byStatus(col.status);
            const collapsed = col.status === 'done' && !doneOpen;
            return (
              <motion.section key={col.status}
                initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: ci * 0.08, ease: EASE }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.status); }}
                onDragLeave={() => setDragOver((d) => (d === col.status ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(null);
                  const id = e.dataTransfer.getData('text/wo-id');
                  if (id) handleDrop(id, col.status);
                }}
                className={cn('flex min-w-[260px] flex-col gap-2 rounded-card border p-2.5 transition-colors',
                  dragOver === col.status ? 'border-accent bg-accent-soft/40' : 'border-border/70 bg-surface-muted/60')}>
                <header className="flex items-center justify-between px-1.5 py-1">
                  <h2 className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-600">{col.title}</h2>
                  <span className="rounded-full bg-white px-2 py-0.5 font-mono text-micro font-semibold text-ink-600 shadow-card">{rows.length}</span>
                </header>
                {(collapsed ? rows.slice(0, 2) : rows).map((w, i) => (
                  <WoCard key={w.id} wo={w} index={i}
                    vehicle={vehicles.find((x) => x.id === w.vehicleId)}
                    vendor={vendorById(vendors, w.vendorId)}
                    onOpen={() => setDrawerWo(w.id)} />
                ))}
                {rows.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-micro text-ink-400">
                    Drop cards here
                  </div>
                )}
                {col.status === 'done' && rows.length > 2 && (
                  <button type="button" onClick={() => setDoneOpen(!doneOpen)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-600 hover:bg-surface-muted">
                    {doneOpen ? 'Collapse' : `Show all ${rows.length}`}
                  </button>
                )}
              </motion.section>
            );
          })}
        </div>
      ) : (
        <DataTable<WorkOrder> columns={columns} rows={filtered} pageSize={12}
          onRowClick={(w) => setDrawerWo(w.id)}
          rowActions={(w) => [
            { label: 'Open detail', icon: Wrench, onClick: () => setDrawerWo(w.id) },
            ...(w.status === 'open' && canApprove ? [{ label: 'Approve', icon: Check, onClick: () => { setStatus(w, 'approved'); toast({ title: 'Approved', body: w.number, status: 'ok' }); } }] : []),
            ...(w.status === 'approved' || w.status === 'in-progress' ? [{ label: 'Mark done', icon: BadgeCheck, onClick: () => setCompleteWo(w) }] : []),
            { label: 'Cancel WO', icon: X, danger: true, onClick: () => { setStatus(w, 'cancelled'); toast({ title: 'Work order cancelled', body: w.number, status: 'warn' }); } },
          ]} />
      )}

      {/* role gating hint */}
      <p className="text-micro text-ink-400">
        Signed in as <b>{role}</b> — {canApprove ? 'you can approve work orders.' : 'approval actions are hidden (Manager approval required).'}
        {' '}All transitions are audit-logged with user + timestamp.
      </p>

      <WoDrawer woId={drawerWo} vehicles={vehicles} vendors={vendors} parts={parts} role={role}
        onClose={() => setDrawerWo(null)}
        onStatus={(wo, s) => setStatus(wo, s)}
        onComplete={(wo) => setCompleteWo(wo)} />
      <NewWoModal open={newOpen} prefill={prefill} vehicles={vehicles} vendors={vendors} parts={parts}
        onClose={() => setNewOpen(false)} onCreated={(wo) => setDrawerWo(wo.id)} />
      <CostCaptureModal wo={completeWo} vehicle={vehicles.find((x) => x.id === completeWo?.vehicleId)}
        onClose={() => setCompleteWo(null)} onDone={completeWithCost} />
    </motion.div>
  );
}
