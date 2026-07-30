// FBV FleetOS — /maintenance/parts (design/maintenance-parts.md).
// Parts inventory (stock control tied to WOs) + preferred vendors directory.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Boxes, Download, History, MapPin, Minus, Package, Phone, Plus,
  Search, Star, Store, Truck,
} from 'lucide-react';
import {
  DataTable, Drawer, KPIStatCard, Modal, Sparkline, StatusPill, Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, update, useCollection } from '@/lib/store';
import { fmtDateEAT, fmtKES } from '@/lib/format';
import type { Part, Vendor } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TODAY } from '@/lib/seed';
import {
  MaintSubNav, auditLog, exportXlsx, partCategory, partStatus, seededRange,
  useLocalKV, vendorStats, woEstimate,
} from './lib';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const CATEGORIES = ['Filters', 'Brakes', 'Tyres', 'Electrical', 'Fluids', 'Body', 'Engine', 'General'];

interface PartMove { at: string; delta: number; reason: string; wo?: string; by: string }

function fitmentOf(p: Part): string {
  const m = p.name.split('—')[1];
  if (m) return m.replace('Isuzu ', '').replace(/\//g, ', ').trim();
  const models = ['FRR', 'NQR', 'FTR', 'Hilux', 'Canter', 'Hiace', 'Ranger', 'BT-50'];
  const n = 1 + (p.sku.length % 3);
  return Array.from({ length: n }, (_, i) => models[(p.sku.charCodeAt(0) + i * 3) % models.length]).join(', ');
}

function used90d(p: Part): number {
  return Math.round(seededRange(`${p.sku}-used`, 2, 26));
}

/* ---------------- adjust stock modal ---------------- */

function AdjustStockModal({ part, moves, setMoves, onClose }: {
  part: Part | null;
  moves: Record<string, PartMove[]>;
  setMoves: (m: Record<string, PartMove[]>) => void;
  onClose: () => void;
}) {
  if (!part) return null;
  return <AdjustStockForm key={part.id} part={part} moves={moves} setMoves={setMoves} onClose={onClose} />;
}

function AdjustStockForm({ part, moves, setMoves, onClose }: {
  part: Part;
  moves: Record<string, PartMove[]>;
  setMoves: (m: Record<string, PartMove[]>) => void;
  onClose: () => void;
}) {
  const [delta, setDelta] = useState(0);
  const [reason, setReason] = useState('Received');
  const newQty = part.qty + delta;
  const save = () => {
    update('parts', part.id, { qty: Math.max(0, newQty) });
    const entry: PartMove = {
      at: new Date(`${TODAY}T08:30:00Z`).toISOString(),
      delta, reason, by: 'Wanjiru Maina',
    };
    setMoves({ ...moves, [part.id]: [...(moves[part.id] ?? []), entry] });
    auditLog('update', 'parts', part.id, `Stock ${delta >= 0 ? '+' : ''}${delta} ${part.sku} (${reason}) → ${Math.max(0, newQty)}`);
    toast({ title: 'Stock adjusted', body: `${part.sku}: ${part.qty} → ${Math.max(0, newQty)}`, status: newQty < 0 ? 'warn' : 'ok' });
    onClose();
  };
  return (
    <Modal open={!!part} onClose={onClose} title={`Adjust stock — ${part.sku}`}
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={delta === 0 || newQty < 0} onClick={save}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">
            Apply adjustment
          </button>
        </>
      }>
      <div className="flex flex-col gap-4">
        <div className="text-[13px] text-ink-600">{part.name} · on hand <b className="font-mono text-ink-900">{part.qty}</b></div>
        <div className="flex items-center justify-center gap-4">
          <button type="button" onClick={() => setDelta(delta - 1)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-ink-600 hover:bg-surface-muted active:scale-95">
            <Minus size={16} />
          </button>
          <motion.span key={delta} initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.12 }}
            className={cn('w-20 text-center font-mono text-[24px] font-bold', delta > 0 ? 'text-ok-on-soft' : delta < 0 ? 'text-alert-on-soft' : 'text-ink-900')}>
            {delta > 0 ? `+${delta}` : delta}
          </motion.span>
          <button type="button" onClick={() => setDelta(delta + 1)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-ink-600 hover:bg-surface-muted active:scale-95">
            <Plus size={16} />
          </button>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="h-9 rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent">
            {['Received', 'Used on WO', 'Correction', 'Damaged'].map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        {newQty < 0 && <p className="text-micro font-semibold text-alert-on-soft">Insufficient stock — cannot issue below zero.</p>}
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-[12px] text-ink-600">
          New on-hand: <b className="font-mono">{Math.max(0, newQty)}</b> — the movement is written to stock history and the audit trail.
        </p>
      </div>
    </Modal>
  );
}

/* ---------------- part history drawer ---------------- */

function PartHistoryDrawer({ part, moves, onClose }: {
  part: Part | null; moves: Record<string, PartMove[]>; onClose: () => void;
}) {
  if (!part) return <Drawer open={!!part} onClose={onClose} title="Part history"><div /></Drawer>;
  const log = (moves[part.id] ?? []).slice().reverse();
  const spark = Array.from({ length: 8 }, (_, i) => Math.round(seededRange(`${part.sku}-wk${i}`, 0, 9)));
  return (
    <Drawer open={!!part} onClose={onClose}
      title={<span className="flex items-center gap-2 font-mono">{part.sku}<span className="font-sans text-ink-400">{part.name}</span></span>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">On hand</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{part.qty}</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Reorder @</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{part.reorderLevel}</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Used 90d</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{used90d(part)}</div>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Usage — 8 weeks</div>
          <Sparkline data={spark} height={48} />
        </div>
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Movement log</div>
          {log.length === 0 && <p className="text-[12px] text-ink-400">No movements recorded yet — adjustments and WO issues appear here.</p>}
          <div className="flex flex-col gap-1.5">
            {log.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <span className={cn('w-12 text-right font-mono text-[13px] font-bold', m.delta >= 0 ? 'text-ok-on-soft' : 'text-alert-on-soft')}>
                  {m.delta >= 0 ? `+${m.delta}` : m.delta}
                </span>
                <span className="flex-1 text-[12px] text-ink-900">{m.reason}{m.wo ? ` · ${m.wo}` : ''}</span>
                <span className="font-mono text-micro text-ink-400">{fmtDateEAT(m.at)} · {m.by}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/* ---------------- parts inventory tab ---------------- */

function PartsTab() {
  const parts = useCollection('parts');
  const [moves, setMoves] = useLocalKV<Record<string, PartMove[]>>('partMoves', {});
  const [onOrder, setOnOrder] = useLocalKV<Record<string, number>>('partOnOrder', {});
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | string>('all');
  const [statusF, setStatusF] = useState<'all' | 'OK' | 'LOW' | 'OUT'>('all');
  const [adjust, setAdjust] = useState<Part | null>(null);
  const [history, setHistory] = useState<Part | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const kpis = useMemo(() => ({
    skus: parts.length,
    value: parts.reduce((s, p) => s + p.qty * p.unitCostKes, 0),
    low: parts.filter((p) => partStatus(p).label === 'LOW').length,
    out: parts.filter((p) => partStatus(p).label === 'OUT').length,
  }), [parts]);

  const rows = parts.filter((p) => {
    if (cat !== 'all' && partCategory(p) !== cat) return false;
    if (statusF !== 'all' && partStatus(p).label !== statusF) return false;
    if (q.trim()) {
      const hay = `${p.sku} ${p.name}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const columns: Column<Part>[] = [
    { key: 'sku', header: 'SKU', render: (p) => <span className="rounded-md bg-navy-50 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-navy-800">{p.sku}</span> },
    { key: 'name', header: 'Part name', render: (p) => <span className="font-medium">{p.name}</span> },
    { key: 'cat', header: 'Category', render: (p) => <span className="rounded-full bg-inactive-soft px-2 py-0.5 text-micro font-semibold text-inactive-on-soft">{partCategory(p)}</span> },
    { key: 'fit', header: 'Fitment', render: (p) => <span className="font-mono text-micro text-ink-400">{fitmentOf(p)}</span> },
    {
      key: 'hand', header: 'On hand', render: (p) => {
        const max = Math.max(p.reorderLevel * 2, p.qty, 1);
        return (
          <span className="flex min-w-[130px] flex-col gap-1">
            <span className="font-mono text-[13px] font-bold text-ink-900">
              {p.qty}
              {(onOrder[p.id] ?? 0) > 0 && <span className="ml-1 text-[10px] font-semibold text-info-on-soft">+{onOrder[p.id]} on order</span>}
            </span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <motion.span initial={{ width: 0 }} animate={{ width: `${(p.qty / max) * 100}%` }} transition={{ duration: 0.6, ease: EASE }}
                className={cn('absolute inset-y-0 left-0 rounded-full', partStatus(p).label === 'OUT' ? 'bg-alert' : partStatus(p).label === 'LOW' ? 'bg-warn animate-pulse' : 'bg-accent')} />
              <span className="absolute inset-y-0 w-0.5 bg-warn" style={{ left: `${(p.reorderLevel / max) * 100}%` }} />
            </span>
          </span>
        );
      },
    },
    { key: 'reorder', header: 'Reorder @', mono: true, align: 'right', render: (p) => p.reorderLevel },
    { key: 'status', header: 'Status', render: (p) => <StatusPill status={partStatus(p).key} label={partStatus(p).label} /> },
    { key: 'cost', header: 'Unit cost', mono: true, align: 'right', render: (p) => fmtKES(p.unitCostKes) },
    { key: 'value', header: 'Stock value', mono: true, align: 'right', render: (p) => fmtKES(p.qty * p.unitCostKes) },
    { key: 'used', header: 'Used 90d', mono: true, align: 'right', render: (p) => used90d(p) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPIStatCard label="SKUs" value={kpis.skus} icon={Boxes} spark={[34, 35, 36, 36, 37, 38, kpis.skus]} />
        <KPIStatCard label="Stock value" value={kpis.value} icon={Package} format={(v) => fmtKES(v, { compact: true })} sparkColor="#0F2540" spark={[380, 410, 402, 430, 455, 470, kpis.value / 1000]} />
        <KPIStatCard label="Low stock" value={kpis.low} icon={Minus} delta="at/below reorder" deltaGood={false} sparkColor="#F59E0B" spark={[2, 2, 3, 3, 4, 4, kpis.low]} />
        <KPIStatCard label="Out of stock" value={kpis.out} icon={History} delta={kpis.out > 0 ? 'blocking WOs' : undefined} deltaGood={false} sparkColor="#DC2626" spark={[0, 1, 0, 1, 1, 1, kpis.out]} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU or part…"
            className="h-9 w-60 rounded-lg border border-border bg-white pl-8 pr-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-3 text-[13px] outline-none focus:border-accent">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        {(['all', 'OK', 'LOW', 'OUT'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatusF(s)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', statusF === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {s === 'all' ? 'Any status' : s}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <button type="button"
            onClick={() => exportXlsx('parts-inventory.xlsx', rows.map((p) => ({
              SKU: p.sku, Name: p.name, Category: partCategory(p), 'On hand': p.qty,
              'Reorder @': p.reorderLevel, Status: partStatus(p).label,
              'Unit cost (KES)': p.unitCostKes, 'Stock value (KES)': p.qty * p.unitCostKes,
            })), 'Parts')}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={15} /> Export Excel
          </button>
          <button type="button" onClick={() => setNewOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
            <Plus size={15} /> New part
          </button>
        </span>
      </div>

      <DataTable<Part> columns={columns} rows={rows} pageSize={12}
        className="[&_tr:has(.bg-alert)]:bg-alert-soft/30"
        rowActions={(p) => [
          { label: 'Adjust stock', icon: Plus, onClick: () => setAdjust(p) },
          {
            label: 'Reorder', icon: Truck, onClick: () => {
              setOnOrder({ ...onOrder, [p.id]: (onOrder[p.id] ?? 0) + p.reorderLevel });
              auditLog('update', 'parts', p.id, `Reorder noted for ${p.sku} (×${p.reorderLevel})`);
              toast({ title: 'Reorder noted', body: `${p.sku} ×${p.reorderLevel} marked on order — purchase flow stub`, status: 'info' });
            },
          },
          { label: 'History', icon: History, onClick: () => setHistory(p) },
        ]} />

      <AdjustStockModal part={adjust} moves={moves} setMoves={setMoves} onClose={() => setAdjust(null)} />
      <PartHistoryDrawer part={history} moves={moves} onClose={() => setHistory(null)} />
      <NewPartModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function NewPartModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('0');
  const [reorder, setReorder] = useState('4');
  const [cost, setCost] = useState('');
  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  return (
    <Modal open={open} onClose={onClose} title="New part"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!sku.trim() || !name.trim()}
            onClick={() => {
              const rec = add('parts', {
                id: `part-${Date.now().toString(36)}`, sku: sku.trim().toUpperCase(), name: name.trim(),
                qty: Number(qty) || 0, reorderLevel: Number(reorder) || 0, unitCostKes: Number(cost) || 0,
              });
              auditLog('create', 'parts', rec.id, `Added part ${rec.sku}`);
              toast({ title: 'Part added', body: rec.sku, status: 'ok' });
              onClose();
              setSku(''); setName(''); setQty('0'); setReorder('4'); setCost('');
            }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Add part</button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">SKU</span>
          <input value={sku} onChange={(e) => setSku(e.target.value.toUpperCase())} placeholder="FLT-AIR-FRR" className={cn(input, 'font-mono uppercase')} /></label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Unit cost (KES)</span>
          <input value={cost} onChange={(e) => setCost(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
        <label className="col-span-2 flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Part name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Air filter — Isuzu FRR" className={input} /></label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Opening qty</span>
          <input value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Reorder @</span>
          <input value={reorder} onChange={(e) => setReorder(e.target.value.replace(/\D/g, ''))} className={cn(input, 'font-mono')} /></label>
      </div>
    </Modal>
  );
}

/* ---------------- vendors tab ---------------- */

function ratingOf(v: Vendor): number {
  return Number(seededRange(`${v.id}-rating`, 3.4, 5).toFixed(1));
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} className={i <= Math.round(rating) ? 'fill-warn text-warn' : 'text-border'} />
      ))}
      <span className="ml-1 font-mono text-micro text-ink-400">{rating}</span>
    </span>
  );
}

function VendorDrawer({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const navigate = useNavigate();
  const workOrders = useCollection('workOrders');
  const vehicles = useCollection('vehicles');
  if (!vendor) return <Drawer open={!!vendor} onClose={onClose} title="Vendor"><div /></Drawer>;
  const stats = vendorStats(vendor.id, workOrders);
  const open = stats.wos.filter((w) => w.status !== 'done' && w.status !== 'cancelled');
  const trend = Array.from({ length: 6 }, (_, i) => Math.round(seededRange(`${vendor.id}-sp${i}`, 40, 320)));
  return (
    <Drawer open={!!vendor} onClose={onClose} width={480}
      title={
        <span className="flex items-center gap-2">
          {vendor.name}
          {vendor.preferred && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-bold text-accent-strong">PREFERRED</span>}
        </span>
      }>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5 text-[13px] text-ink-600">
          <span className="flex items-center gap-2"><Store size={14} className="text-ink-400" />{vendor.specialty}</span>
          <span className="flex items-center gap-2 font-mono"><Phone size={14} className="text-ink-400" />{vendor.phone}</span>
          <span className="flex items-center gap-2"><MapPin size={14} className="text-ink-400" />{vendor.location}, Kenya</span>
          <Stars rating={ratingOf(vendor)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">WOs</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{stats.count}</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Avg turnaround</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{stats.turnaroundDays} d</div>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <div className="text-micro uppercase tracking-[0.06em] text-ink-400">Spend YTD</div>
            <div className="font-mono text-[16px] font-bold text-ink-900">{fmtKES(stats.spend, { compact: true })}</div>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Spend trend — 6 mo (KES K)</div>
          <Sparkline data={trend} height={52} />
        </div>
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Open work orders</div>
          {open.length === 0 && <p className="text-[12px] text-ink-400">No open work orders with this vendor.</p>}
          {open.map((w) => (
            <button key={w.id} type="button" onClick={() => navigate('/maintenance')}
              className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left hover:bg-surface-muted">
              <span className="font-mono text-[12px] font-semibold text-accent-strong">{w.number}</span>
              <span className="flex-1 truncate text-[12px] text-ink-900">{w.title}</span>
              <span className="font-mono text-micro text-ink-400">
                {vehicles.find((x) => x.id === w.vehicleId)?.plate} · {fmtKES(woEstimate(w), { compact: true })}
              </span>
            </button>
          ))}
        </div>
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-[12px] text-ink-600">
          Price-list notes — labour {fmtKES(Math.round(seededRange(`${vendor.id}-lab`, 1800, 3500)))}/hr, parts at {vendor.preferred ? 'fleet-negotiated' : 'retail'} rates.
        </p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => navigate('/maintenance', { state: { newWo: { source: 'manual' as const, vendorId: vendor.id } } })}
            className="h-9 flex-1 rounded-lg bg-accent text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
            Create WO with this vendor
          </button>
          <button type="button"
            onClick={() => {
              update('vendors', vendor.id, { preferred: !vendor.preferred });
              auditLog('update', 'vendors', vendor.id, `${vendor.name} ${vendor.preferred ? 'removed from' : 'set as'} preferred`);
              toast({ title: vendor.preferred ? 'Removed from preferred' : 'Set as preferred', body: vendor.name, status: 'ok' });
            }}
            className="h-9 flex-1 rounded-lg border border-border text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            {vendor.preferred ? 'Unset preferred' : 'Set preferred'}
          </button>
        </div>
      </div>
    </Drawer>
  );
}

function VendorsTab() {
  const vendors = useCollection('vendors');
  const workOrders = useCollection('workOrders');
  const [sel, setSel] = useState<Vendor | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-ink-400">Preferred garages & parts vendors — linked to work orders.</p>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => exportXlsx('vendors.xlsx', vendors.map((v) => {
              const s = vendorStats(v.id, workOrders);
              return {
                Name: v.name, Specialty: v.specialty, Phone: v.phone, Location: v.location,
                Preferred: v.preferred ? 'yes' : 'no', WOs: s.count, 'Spend YTD (KES)': s.spend,
              };
            }), 'Vendors')}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={15} /> Export
          </button>
          <button type="button" onClick={() => setAddOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
            <Plus size={15} /> Add vendor
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {vendors.map((v, i) => {
          const s = vendorStats(v.id, workOrders);
          return (
            <motion.button key={v.id} type="button"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
              onClick={() => setSel(v)}
              className="flex flex-col gap-2.5 rounded-card border border-border bg-white p-5 text-left shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-pop">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[15px] font-bold text-ink-900">{v.name}</span>
                {v.preferred && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-micro font-bold text-accent-strong">PREFERRED</span>}
              </div>
              <div className="text-micro uppercase tracking-[0.04em] text-ink-400">{v.specialty}</div>
              <div className="flex flex-col gap-1 font-mono text-[12px] text-ink-600">
                <span className="flex items-center gap-1.5"><Phone size={12} className="text-ink-400" />{v.phone}</span>
                <span className="flex items-center gap-1.5"><MapPin size={12} className="text-ink-400" />{v.location}</span>
              </div>
              <Stars rating={ratingOf(v)} />
              <div className="border-t border-border pt-2 font-mono text-[12px] text-ink-600">
                WOs {s.count} · Avg turnaround {s.turnaroundDays} d · Spend YTD {fmtKES(s.spend, { compact: true })}
              </div>
            </motion.button>
          );
        })}
      </div>
      <VendorDrawer vendor={sel} onClose={() => setSel(null)} />
      <AddVendorModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function AddVendorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('+254 ');
  const [location, setLocation] = useState('');
  const [preferred, setPreferred] = useState(false);
  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  return (
    <Modal open={open} onClose={onClose} title="Add vendor"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!name.trim() || !phone.trim()}
            onClick={() => {
              const rec = add('vendors', {
                id: `ven-${Date.now().toString(36)}`, name: name.trim(),
                specialty: specialty.trim() || 'General repairs', phone: phone.trim(),
                location: location.trim() || 'Nairobi', preferred,
              });
              auditLog('create', 'vendors', rec.id, `Added vendor ${rec.name}`);
              toast({ title: 'Vendor added', body: rec.name, status: 'ok' });
              onClose();
              setName(''); setSpecialty(''); setPhone('+254 '); setLocation(''); setPreferred(false);
            }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Add vendor</button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Garage / vendor name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="AutoXpress — Karen" className={input} /></label>
        <label className="col-span-2 flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Categories</span>
          <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Full service · Tyres · Alignment" className={input} /></label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={cn(input, 'font-mono')} /></label>
        <label className="flex flex-col gap-1"><span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Mombasa Rd" className={input} /></label>
        <label className="col-span-2 flex cursor-pointer items-center gap-2 text-[13px] text-ink-900">
          <input type="checkbox" checked={preferred} onChange={(e) => setPreferred(e.target.checked)} className="h-4 w-4 accent-[#06B6D4]" />
          Preferred vendor (priority on work orders)
        </label>
      </div>
    </Modal>
  );
}

/* ---------------- page ---------------- */

export default function Parts() {
  const [tab, setTab] = useState('parts');
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="mx-auto flex max-w-[1520px] flex-col gap-5 p-6">
      <div>
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Parts & Vendors</h1>
        <div className="mt-1"><MaintSubNav active="parts" /></div>
      </div>
      <Tabs tabs={[{ key: 'parts', label: 'Parts inventory' }, { key: 'vendors', label: 'Vendors' }]}
        active={tab} onChange={setTab} />
      {tab === 'parts' ? <PartsTab /> : <VendorsTab />}
    </motion.div>
  );
}
