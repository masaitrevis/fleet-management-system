// FBV FleetOS — /assets — non-powered assets & equipment register (assets.md).

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Box, Cable, Check, Download, History, MapPin, Pencil, Plus, Unlink, Wrench,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { add, kvGet, kvSet, update, useCollection, useKV } from '@/lib/store';
import type { Asset } from '@/lib/types';
import { fmtDateEAT, fmtKES, fmtNum } from '@/lib/format';
import { DataTable, Drawer, KPIStatCard, Modal, PlateTag, StatusPill, toast } from '@/components/shared';
import type { Column } from '@/components/shared';
import {
  Btn, Card, DEMO_NOW_ISO, PageHeader, PageShell, downloadSheet, hash01, isoDaysAgo,
} from './ops-shared';

/* ------------------------------------------------------------------ */
/* Asset extras (kv): location, condition, run hours, history          */
/* ------------------------------------------------------------------ */

type Condition = 'good' | 'service-due' | 'repair';
interface AssetExtra {
  locationId?: string;          // geofence id when not attached
  assignedSince?: string;
  condition?: Condition;
  runHours?: number;            // gensets
  lastServiceAt?: string;
  lastMovedAt?: string;
}
interface HistoryEntry { from: string; to: string | null; target: string; by: string; durationH: number | null; kmHauled?: number }

function getExtras(): Record<string, AssetExtra> { return (kvGet('assets-extra' as never) as unknown as Record<string, AssetExtra>) ?? {}; }
function setExtra(id: string, patch: AssetExtra) {
  kvSet('assets-extra' as never, { ...getExtras(), [id]: { ...getExtras()[id], ...patch } } as never);
}
function getHistory(): Record<string, HistoryEntry[]> { return (kvGet('asset-history' as never) as unknown as Record<string, HistoryEntry[]>) ?? {}; }
function pushHistory(assetId: string, entry: HistoryEntry) {
  const h = getHistory();
  kvSet('asset-history' as never, { ...h, [assetId]: [...(h[assetId] ?? []), entry] } as never);
}

const TYPE_PREFIX: Record<Asset['type'], string> = { trailer: 'FBV-TRL', generator: 'FBV-GEN', equipment: 'FBV-EQP' };
const TYPE_PILL: Record<Asset['type'], { label: string; cls: string }> = {
  trailer: { label: 'Trailer', cls: 'bg-navy-800 text-white' },
  generator: { label: 'Generator', cls: 'bg-warn-soft text-warn-on-soft' },
  equipment: { label: 'Equipment', cls: 'bg-info-soft text-info-on-soft' },
};
const CONDITION_PILL: Record<Condition, { status: 'ok' | 'warn' | 'alert'; label: string }> = {
  good: { status: 'ok', label: 'GOOD' },
  'service-due': { status: 'warn', label: 'SERVICE DUE' },
  repair: { status: 'alert', label: 'REPAIR' },
};

function assetCode(a: Asset, all: Asset[]): string {
  const same = all.filter((x) => x.type === a.type);
  return `${TYPE_PREFIX[a.type]}-${String(same.findIndex((x) => x.id === a.id) + 1).padStart(2, '0')}`;
}
function serialOf(a: Asset): string {
  return `SN-202${(a.id.charCodeAt(4) % 6)}-${String(1000 + Math.floor(hash01(a.id) * 8999))}`;
}
function defaultHistory(a: Asset): HistoryEntry[] {
  const h = hash01(a.id);
  return [
    { from: isoDaysAgo(44 + Math.round(h * 10)), to: isoDaysAgo(21), target: 'FBV Depot', by: 'Wanjiru Maina', durationH: 552, kmHauled: a.type === 'trailer' ? Math.round(900 + h * 2400) : undefined },
    { from: isoDaysAgo(21), to: isoDaysAgo(6), target: a.type === 'trailer' ? 'Mombasa Rd Yard' : 'JKIA Cargo', by: 'Brian Kibe', durationH: 360, kmHauled: a.type === 'trailer' ? Math.round(600 + h * 1500) : undefined },
  ];
}
function historyFor(a: Asset): HistoryEntry[] {
  return getHistory()[a.id] ?? defaultHistory(a);
}

/** deterministic 30d utilization series per asset id (0..100) */
function utilSeries(a: Asset, days = 30): number[] {
  const out: number[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const wobble = (hash01(`${a.id}|${d}`) - 0.5) * 46;
    // weekends dip
    const date = new Date(Date.UTC(2026, 6, 28 - d));
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    out.push(Math.max(0, Math.min(100, Math.round(a.utilizationPct + wobble * (weekend ? 1.6 : 1)))));
  }
  return out;
}

const AXIS = { fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#7C8DA2' } as const;

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AssetsPage() {
  const assets = useCollection('assets');
  const vehicles = useCollection('vehicles');
  const geofences = useCollection('geofences');
  const extras = (useKV('assets-extra' as never) as unknown as Record<string, AssetExtra>) ?? {};
  const [typeFilter, setTypeFilter] = useState<'all' | Asset['type']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);

  const vehById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const gfById = useMemo(() => new Map(geofences.map((g) => [g.id, g])), [geofences]);

  const filtered = assets.filter((a) => typeFilter === 'all' || a.type === typeFilter);
  const deployed = assets.filter((a) => a.status === 'assigned').length;
  const inYard = assets.filter((a) => a.status === 'available').length;
  const avgUtil = assets.length ? Math.round(assets.reduce((s, a) => s + a.utilizationPct, 0) / assets.length) : 0;

  const locationOf = (a: Asset) => {
    if (a.assignedVehicleId && vehById.get(a.assignedVehicleId)) return <PlateTag plate={vehById.get(a.assignedVehicleId)!.plate} />;
    const gf = extras[a.id]?.locationId ? gfById.get(extras[a.id].locationId!) : undefined;
    if (gf) return <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-micro font-medium text-accent-strong"><MapPin size={10} />{gf.name}</span>;
    return <span className="text-ink-400">FBV Depot</span>;
  };

  const columns: Column<Asset>[] = [
    {
      key: 'status', header: '', width: '28px', render: (a) => (
        <span className="relative flex h-2 w-2">
          {a.status === 'assigned' && hash01(a.id) > 0.4 && <span className="absolute h-full w-full rounded-full bg-accent animate-pulse-live-ring" />}
          <span className={cn('relative h-2 w-2 rounded-full',
            a.status === 'assigned' ? 'bg-ok' : a.status === 'available' ? 'bg-inactive' : 'bg-warn')} />
        </span>
      ),
    },
    { key: 'code', header: 'Asset ID', render: (a) => <span className="rounded-md bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-900">{assetCode(a, assets)}</span> },
    { key: 'name', header: 'Name', render: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'type', header: 'Type', render: (a) => <span className={cn('rounded-full px-2 py-0.5 text-micro font-semibold', TYPE_PILL[a.type].cls)}>{TYPE_PILL[a.type].label}</span> },
    { key: 'serial', header: 'Serial no', mono: true, render: (a) => serialOf(a) },
    { key: 'loc', header: 'Attached to / Located at', render: locationOf },
    { key: 'since', header: 'Assigned since', mono: true, render: (a) => extras[a.id]?.assignedSince ? fmtDateEAT(extras[a.id].assignedSince!) : '—' },
    {
      key: 'util', header: 'Utilization 30d', render: (a) => (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted">
            <span className={cn('block h-full rounded-full', a.utilizationPct >= 60 ? 'bg-accent' : a.utilizationPct >= 35 ? 'bg-navy-800' : 'bg-inactive')} style={{ width: `${a.utilizationPct}%` }} />
          </span>
          <span className="font-mono text-[11px]">{a.utilizationPct}%</span>
        </span>
      ),
    },
    {
      key: 'moved', header: 'Last moved', mono: true, render: (a) => {
        const tracked = a.type === 'trailer' || (a.type === 'generator' && a.status === 'assigned');
        if (!tracked) return <span className="text-ink-400">manual</span>;
        const h = 1 + Math.floor(hash01(a.id + 'mv') * 26);
        return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
      },
    },
    {
      key: 'cond', header: 'Condition', render: (a) => {
        const c: Condition = extras[a.id]?.condition ?? (a.status === 'maintenance' ? 'service-due' : 'good');
        return <StatusPill status={CONDITION_PILL[c].status} label={CONDITION_PILL[c].label} />;
      },
    },
  ];

  /* fleet utilization chart */
  const fleetUtil = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
    const out: { day: string; util: number; weekend: boolean }[] = [];
    for (let d = 29; d >= 0; d--) {
      const vals = assets.map((a) => utilSeries(a)[29 - d]);
      const date = new Date(Date.UTC(2026, 6, 28 - d));
      out.push({
        day: `${date.getUTCDate()} ${months[date.getUTCMonth()].slice(0, 3)}`,
        util: Math.round(vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length)),
        weekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
      });
    }
    return out;
  }, [assets]);

  const leastUsed = useMemo(() => [...assets].sort((a, b) => a.utilizationPct - b.utilizationPct)[0], [assets]);

  const exportAssets = () => {
    downloadSheet(filtered.map((a) => ({
      AssetID: assetCode(a, assets), Name: a.name, Type: a.type, Serial: serialOf(a),
      Status: a.status, AttachedTo: a.assignedVehicleId ? vehById.get(a.assignedVehicleId)?.plate ?? '' : '',
      Location: extras[a.id]?.locationId ? gfById.get(extras[a.id].locationId!)?.name ?? '' : 'FBV Depot',
      UtilizationPct: a.utilizationPct, Condition: extras[a.id]?.condition ?? 'good',
      PurchaseCostKES: a.purchaseCostKes,
    })), 'assets-2026-07-28.xlsx', 'Assets');
    toast({ title: 'Export started', body: 'assets-2026-07-28.xlsx', status: 'ok' });
  };

  const chips: { key: 'all' | Asset['type']; label: string }[] = [
    { key: 'all', label: `All ${assets.length}` },
    { key: 'trailer', label: `Trailers ${assets.filter((a) => a.type === 'trailer').length}` },
    { key: 'generator', label: `Generators ${assets.filter((a) => a.type === 'generator').length}` },
    { key: 'equipment', label: `Equipment ${assets.filter((a) => a.type === 'equipment').length}` },
  ];

  const selected = selectedId ? assets.find((a) => a.id === selectedId) : undefined;

  return (
    <PageShell>
      <PageHeader title="Assets & Equipment" sub="Trailers, generators and equipment — assignment & utilization"
        actions={<>
          <Btn icon={Plus} onClick={() => setAddOpen(true)}>Add asset</Btn>
          <Btn icon={Download} variant="ghost" onClick={exportAssets}>Export</Btn>
        </>} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KPIStatCard label="Assets" value={assets.length} icon={Box} />
        <KPIStatCard label="Deployed" value={deployed} icon={Cable} delta="on assignment" deltaGood />
        <KPIStatCard label="In yard" value={inYard} icon={MapPin} delta="available" sparkColor="#64748B" />
        <KPIStatCard label="Utilization 30d" value={avgUtil} format={(v) => `${Math.round(v)}%`} icon={Wrench}
          spark={fleetUtil.slice(-14).map((d) => d.util)} />
      </div>

      {/* type filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <motion.button key={c.key} type="button"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.2 }}
            onClick={() => setTypeFilter(c.key)}
            className={cn('rounded-full border px-3 py-1.5 text-[13px] font-medium transition-all hover:-translate-y-px',
              typeFilter === c.key ? 'border-navy-900 bg-navy-900 text-white' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {c.label}
          </motion.button>
        ))}
      </div>

      <DataTable columns={columns} rows={filtered} pageSize={12}
        onRowClick={(a) => setSelectedId(a.id)}
        rowActions={(a) => [
          { label: a.assignedVehicleId ? 'Detach' : 'Assign / Attach', icon: a.assignedVehicleId ? Unlink : Cable, onClick: () => setAttachFor(a.id) },
          { label: 'Move', icon: MapPin, onClick: () => setMoveFor(a.id) },
          { label: 'Service log', icon: Wrench, onClick: () => setSelectedId(a.id) },
          { label: 'History', icon: History, onClick: () => setSelectedId(a.id) },
        ]} />

      {/* utilization card */}
      <Card title="Fleet utilization — last 30 days"
        actions={<span className="font-mono text-[11px] text-ink-400">fleet avg {avgUtil}%</span>}>
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={fleetUtil} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#EDF1F6" vertical={false} />
              <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: '#EDF1F6' }} interval={4} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 100]} />
              <RTooltip cursor={{ fill: '#F2F5F9' }}
                content={({ active, payload, label }: { active?: boolean; payload?: { value?: number }[]; label?: string }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-border bg-white px-3 py-2 font-mono text-[12px] shadow-pop">{label}: <b>{payload[0].value}%</b></div>
                  ) : null} />
              <ReferenceLine y={avgUtil} stroke="#0F2540" strokeDasharray="6 5" strokeWidth={1.5} />
              <Bar dataKey="util" name="utilization" radius={[3, 3, 0, 0]} isAnimationActive animationDuration={600}
                fill="#06B6D4"
                shape={(props: { x?: number; y?: number; width?: number; height?: number; weekend?: boolean }) => {
                  const { x = 0, y = 0, width = 0, height = 0, weekend } = props;
                  return <rect x={x} y={y} width={width} height={height} rx={3} fill={weekend ? '#94A3B8' : '#06B6D4'} />;
                }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {leastUsed && (
          <div className="mt-2 text-[12px] leading-5 text-ink-600">
            <span className="font-mono font-semibold">{assetCode(leastUsed, assets)}</span> ({leastUsed.name}) idle {30 - Math.round((leastUsed.utilizationPct / 100) * 30)} of 30 days
            {extras[leastUsed.id]?.locationId ? ` at ${gfById.get(extras[leastUsed.id].locationId!)?.name}` : ' at Mombasa Rd Yard'} — consider redeploying to the Nakuru run.
          </div>
        )}
      </Card>

      {/* detail drawer */}
      {selected && (
        <AssetDrawer asset={selected} all={assets} extra={extras[selected.id] ?? {}}
          onClose={() => setSelectedId(null)}
          onAttach={() => { setSelectedId(null); setAttachFor(selected.id); }}
          onMove={() => { setSelectedId(null); setMoveFor(selected.id); }} />
      )}

      <AddAssetModal open={addOpen} onClose={() => setAddOpen(false)} />

      {attachFor && (
        <AttachModal asset={assets.find((a) => a.id === attachFor)!} vehicles={vehicles}
          onClose={() => setAttachFor(null)} />
      )}
      {moveFor && (
        <MoveModal asset={assets.find((a) => a.id === moveFor)!} onClose={() => setMoveFor(null)} />
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Asset detail drawer                                                 */
/* ------------------------------------------------------------------ */

function Silhouette({ type }: { type: Asset['type'] }) {
  return (
    <svg viewBox="0 0 160 80" className="h-full w-full">
      <g fill="none" stroke="#0F2540" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        {type === 'trailer' && (<>
          <rect x="14" y="26" width="104" height="28" rx="3" />
          <path d="M14 54 L14 62 M118 54 L118 60 L140 60 L140 66" />
          <circle cx="42" cy="64" r="8" /><circle cx="66" cy="64" r="8" />
          <path d="M26 26 L26 18 L40 18" />
        </>)}
        {type === 'generator' && (<>
          <rect x="30" y="18" width="100" height="44" rx="5" />
          <circle cx="58" cy="40" r="11" />
          <path d="M84 30 L116 30 M84 40 L116 40 M84 50 L104 50" />
          <path d="M38 62 L38 70 M122 62 L122 70" />
        </>)}
        {type === 'equipment' && (<>
          <path d="M40 60 L40 30 L58 30 L58 60" />
          <path d="M58 38 L96 38 L118 22" />
          <path d="M118 22 L118 52" />
          <path d="M30 60 L130 60" />
          <circle cx="52" cy="66" r="6" /><circle cx="106" cy="66" r="6" />
        </>)}
      </g>
    </svg>
  );
}

function AssetDrawer({ asset, all, extra, onClose, onAttach, onMove }: {
  asset: Asset; all: Asset[]; extra: AssetExtra;
  onClose: () => void; onAttach: () => void; onMove: () => void;
}) {
  const vehicles = useCollection('vehicles');
  const geofences = useCollection('geofences');
  const [serviceOpen, setServiceOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const hist = historyFor(asset);
  const weeks = useMemo(() => {
    const s = utilSeries(asset, 84);
    const out: number[] = [];
    for (let w = 0; w < 12; w++) {
      const slice = s.slice(w * 7, w * 7 + 7);
      out.push(Math.round(slice.reduce((a, b) => a + b, 0) / slice.length));
    }
    return out;
  }, [asset]);
  const condition: Condition = extra.condition ?? (asset.status === 'maintenance' ? 'service-due' : 'good');
  const vehicle = asset.assignedVehicleId ? vehicles.find((v) => v.id === asset.assignedVehicleId) : undefined;
  const gf = extra.locationId ? geofences.find((g) => g.id === extra.locationId) : undefined;
  const runHours = extra.runHours ?? Math.round(400 + hash01(asset.id) * 1400);
  const nextServiceH = Math.ceil(runHours / 250) * 250;

  const logService = () => {
    setExtra(asset.id, { lastServiceAt: DEMO_NOW_ISO, condition: 'good', runHours: 0 });
    add('audit', {
      id: '', at: DEMO_NOW_ISO, userId: 'usr-04', userName: 'Kevin Onyango', action: 'update',
      collection: 'assets', recordId: asset.id, summary: `Service logged — ${assetCode(asset, all)} ${asset.name}`,
    });
    if (asset.status === 'maintenance') update('assets', asset.id, { status: 'available' });
    toast({ title: 'Service logged', body: `${asset.name} — condition GOOD.`, status: 'ok' });
  };

  const markCondition = (c: Condition, createWo: boolean) => {
    setExtra(asset.id, { condition: c });
    if (c !== 'good' && asset.status !== 'maintenance') update('assets', asset.id, { status: 'maintenance' });
    if (c === 'good' && asset.status === 'maintenance') update('assets', asset.id, { status: 'available' });
    if (createWo && asset.assignedVehicleId) {
      add('workOrders', {
        id: '', number: `FBV-WO-0001${Math.floor(hash01(asset.id + Date.now()) * 90 + 10)}`,
        vehicleId: asset.assignedVehicleId, source: 'manual', status: 'open', priority: 'medium',
        title: `Asset service — ${asset.name} (${assetCode(asset, all)})`,
        items: [{ description: 'Asset inspection & service', qty: 1, unitCostKes: 4500 }],
        laborCostKes: 3000, vendorId: 'ven-02', openedAt: DEMO_NOW_ISO, dueAt: null, completedAt: null,
      });
      toast({ title: 'Condition updated + WO opened', status: 'warn' });
    } else {
      toast({ title: `Condition → ${CONDITION_PILL[c].label}`, status: c === 'good' ? 'ok' : 'warn' });
    }
  };

  return (
    <Drawer open onClose={onClose} width={500}
      title={<span className="flex items-center gap-2">
        <span className="font-mono text-[13px]">{assetCode(asset, all)}</span> {asset.name}
      </span>}>
      <div className="flex flex-col gap-4">
        {/* header tile */}
        <div className="flex items-center gap-3">
          <div className="h-20 w-36 shrink-0 rounded-lg border border-border bg-surface-muted p-2">
            <Silhouette type={asset.type} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={cn('w-fit rounded-full px-2 py-0.5 text-micro font-semibold', TYPE_PILL[asset.type].cls)}>{TYPE_PILL[asset.type].label}</span>
            <StatusPill status={CONDITION_PILL[condition].status} label={CONDITION_PILL[condition].label} />
            <span className="font-mono text-[11px] text-ink-400">{serialOf(asset)} · {fmtKES(asset.purchaseCostKes, { compact: true })}</span>
          </div>
        </div>

        {/* current assignment */}
        <Card title="Current assignment" className="shadow-none">
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex items-center gap-2">
              {vehicle ? <><PlateTag plate={vehicle.plate} /><span className="text-ink-600">{vehicle.model}</span></>
                : <span className="flex items-center gap-1.5 text-ink-600"><MapPin size={13} className="text-accent-strong" />{gf?.name ?? 'FBV Depot'}</span>}
            </div>
            <div className="font-mono text-[11px] text-ink-400">
              assigned by Brian Kibe · since {extra.assignedSince ? fmtDateEAT(extra.assignedSince) : '—'}
            </div>
            <div className="mt-1 flex gap-2">
              <Btn icon={Cable} variant="ghost" onClick={onAttach}>{vehicle ? 'Reassign' : 'Assign / Attach'}</Btn>
              {vehicle && (
                <Btn icon={Unlink} variant="ghost" onClick={() => {
                  const since = extra.assignedSince ? Date.parse(extra.assignedSince) : Date.parse(isoDaysAgo(6));
                  const durationH = Math.round((Date.parse(DEMO_NOW_ISO) - since) / 3600e3);
                  pushHistory(asset.id, {
                    from: extra.assignedSince ?? isoDaysAgo(6), to: DEMO_NOW_ISO,
                    target: vehicle.plate, by: 'Brian Kibe', durationH,
                    kmHauled: asset.type === 'trailer' ? Math.round(durationH * 38) : undefined,
                  });
                  update('assets', asset.id, { assignedVehicleId: null, status: 'available' });
                  setExtra(asset.id, { assignedSince: undefined });
                  toast({ title: 'Detached', body: `Duration ${Math.floor(durationH / 24)} d ${durationH % 24} h written to history.`, status: 'ok' });
                }}>Detach</Btn>
              )}
              <Btn icon={MapPin} variant="ghost" onClick={onMove}>Move</Btn>
            </div>
          </div>
        </Card>

        {/* assignment history */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Assignment history</div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-surface-muted/70 text-left text-[11px] uppercase tracking-[0.06em] text-ink-400">
                  <th className="h-8 px-2.5">From → To</th><th className="h-8 px-2.5">Vehicle / Location</th>
                  <th className="h-8 px-2.5">By</th><th className="h-8 px-2.5 text-right">Duration</th>
                  {asset.type === 'trailer' && <th className="h-8 px-2.5 text-right">km hauled</th>}
                </tr>
              </thead>
              <tbody>
                {[...hist].reverse().map((h, i) => (
                  <motion.tr key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.2 }} className="border-b border-border/60 last:border-0">
                    <td className="h-9 px-2.5 font-mono text-[11px]">{fmtDateEAT(h.from)} → {h.to ? fmtDateEAT(h.to) : 'now'}</td>
                    <td className="h-9 px-2.5">{h.target}</td>
                    <td className="h-9 px-2.5 text-ink-600">{h.by}</td>
                    <td className="h-9 px-2.5 text-right font-mono text-[11px]">
                      {h.durationH != null ? `${Math.floor(h.durationH / 24)} d ${h.durationH % 24} h` : '—'}
                    </td>
                    {asset.type === 'trailer' && <td className="h-9 px-2.5 text-right font-mono text-[11px]">{h.kmHauled != null ? fmtNum(h.kmHauled) : '—'}</td>}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* utilization mini-chart (12 weeks) */}
        <div>
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Utilization — 12 weeks</div>
          <div className="flex h-20 items-end gap-1">
            {weeks.map((w, i) => (
              <motion.div key={i} initial={{ height: 0 }} animate={{ height: `${Math.max(4, w)}%` }}
                transition={{ delay: i * 0.03, duration: 0.5, ease: 'easeOut' }}
                title={`W${i + 1}: ${w}%`}
                className={cn('flex-1 rounded-t-[3px]', w >= 60 ? 'bg-accent' : w >= 35 ? 'bg-navy-800' : 'bg-inactive/60')} />
            ))}
          </div>
        </div>

        {/* service log (gensets + all) */}
        <Card title="Service log" className="shadow-none"
          actions={<Btn icon={Wrench} variant="ghost" onClick={() => setServiceOpen(true)}>Log service</Btn>}>
          <div className="flex flex-col gap-2 text-[13px]">
            {asset.type === 'generator' && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-ink-600">Run hours</span>
                  <span className="font-mono text-[13px] font-bold text-ink-900">{fmtNum(runHours)} h</span>
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-ink-400">
                    <span>next service at {fmtNum(nextServiceH)} h</span>
                    <span className="font-mono">{Math.round((runHours / nextServiceH) * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div className={cn('h-full rounded-full', runHours / nextServiceH > 0.9 ? 'bg-warn' : 'bg-accent')}
                      style={{ width: `${Math.min(100, (runHours / nextServiceH) * 100)}%` }} />
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-between">
              <span className="text-ink-600">Last service</span>
              <span className="font-mono text-[12px]">{extra.lastServiceAt ? fmtDateEAT(extra.lastServiceAt) : fmtDateEAT(isoDaysAgo(34 + Math.round(hash01(asset.id) * 40)))}</span>
            </div>
            <Btn variant="ghost" icon={Pencil} onClick={() => setConditionOpen(true)} className="self-start">Change condition</Btn>
          </div>
        </Card>
      </div>

      {/* log service confirm */}
      <Modal open={serviceOpen} onClose={() => setServiceOpen(false)} title="Log service"
        footer={<>
          <Btn variant="ghost" onClick={() => setServiceOpen(false)}>Cancel</Btn>
          <Btn icon={Check} onClick={() => { logService(); setServiceOpen(false); }}>Confirm service</Btn>
        </>}>
        <p className="text-[13px] leading-5 text-ink-600">
          Record a completed service for <b>{asset.name}</b> ({assetCode(asset, all)}). Run-hour counter resets and condition flips to GOOD.
        </p>
      </Modal>

      {/* condition change */}
      <ConditionModal open={conditionOpen} onClose={() => setConditionOpen(false)}
        current={condition} canWo={!!asset.assignedVehicleId} onSave={markCondition} />
    </Drawer>
  );
}

function ConditionModal({ open, onClose, current, canWo, onSave }: {
  open: boolean; onClose: () => void; current: Condition; canWo: boolean;
  onSave: (c: Condition, createWo: boolean) => void;
}) {
  const [c, setC] = useState<Condition>(current);
  const [wo, setWo] = useState(true);
  return (
    <Modal open={open} onClose={onClose} title="Change condition"
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => { onSave(c, wo && c !== 'good'); onClose(); }}>Save</Btn>
      </>}>
      <div className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          {(Object.keys(CONDITION_PILL) as Condition[]).map((k) => (
            <button key={k} type="button" onClick={() => setC(k)}
              className={cn('flex-1 rounded-lg border px-2 py-2 text-[12px] font-semibold',
                c === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border text-ink-600 hover:bg-surface-muted')}>
              {CONDITION_PILL[k].label}
            </button>
          ))}
        </div>
        {c !== 'good' && (
          <label className="flex items-center gap-2 text-[13px] text-ink-600">
            <input type="checkbox" checked={wo} onChange={(e) => setWo(e.target.checked)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
            Also open a maintenance work order{canWo ? ' (attached vehicle)' : ' — needs an attached vehicle'}
          </label>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Add asset / attach / move modals                                    */
/* ------------------------------------------------------------------ */

function AddAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Asset['type']>('trailer');
  const [tag, setTag] = useState('');
  const [cost, setCost] = useState('');
  const inputCls = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  const save = () => {
    add('assets', {
      id: '', type, name: name.trim(), tag: tag.trim() || type.toUpperCase().slice(0, 3),
      status: 'available', assignedVehicleId: null, utilizationPct: 0,
      purchaseCostKes: Number(cost) || 0,
    });
    toast({ title: 'Asset added', body: `${name} registered in the yard.`, status: 'ok' });
    setName(''); setTag(''); setCost('');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add asset"
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn icon={Plus} disabled={name.trim().length < 3} onClick={save}>Add asset</Btn>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 40ft flatbed trailer" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as Asset['type'])} className={inputCls}>
            <option value="trailer">Trailer</option><option value="generator">Generator</option><option value="equipment">Equipment</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          Tag / reg
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ZE 4412" className={cn(inputCls, 'font-mono')} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          Purchase cost (KES)
          <input value={cost} onChange={(e) => setCost(e.target.value)} type="number" min="0" placeholder="1,850,000" className={cn(inputCls, 'font-mono')} />
        </label>
      </div>
    </Modal>
  );
}

function AttachModal({ asset, vehicles, onClose }: {
  asset: Asset; vehicles: { id: string; plate: string; model: string; type: string }[]; onClose: () => void;
}) {
  const [vehicleId, setVehicleId] = useState('');
  const compatible = vehicles.filter((v) => asset.type === 'trailer' ? v.type === 'truck' : true);
  const current = vehicles.find((v) => v.id === asset.assignedVehicleId);
  return (
    <Modal open onClose={onClose} title={current ? `Reassign ${asset.name}` : `Attach ${asset.name}`}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn icon={Cable} disabled={!vehicleId} onClick={() => {
          update('assets', asset.id, { assignedVehicleId: vehicleId, status: 'assigned' });
          setExtra(asset.id, { assignedSince: DEMO_NOW_ISO, locationId: undefined });
          pushHistory(asset.id, {
            from: DEMO_NOW_ISO, to: null, target: compatible.find((v) => v.id === vehicleId)?.plate ?? vehicleId,
            by: 'Brian Kibe', durationH: null,
          });
          toast({ title: 'Attached', body: `${asset.name} → ${compatible.find((v) => v.id === vehicleId)?.plate}. Route note sent to driver.`, status: 'ok' });
          onClose();
        }}>Confirm attach</Btn>
      </>}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-600">
          {asset.type === 'trailer' ? 'Trailers attach to trucks only.' : 'Select a host vehicle.'}{' '}
          {current && <>Currently on <span className="font-mono font-semibold">{current.plate}</span>.</>}
        </p>
        <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} autoFocus
          className="h-9 w-full rounded-lg border border-border px-2.5 text-[13px] outline-none focus:border-accent">
          <option value="">Select vehicle…</option>
          {compatible.map((v) => <option key={v.id} value={v.id}>{v.plate} — {v.model}</option>)}
        </select>
      </div>
    </Modal>
  );
}

function MoveModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const geofences = useCollection('geofences');
  const extras = getExtras();
  const [from, setFrom] = useState(extras[asset.id]?.locationId ?? 'gf-01');
  const [to, setTo] = useState('');
  const selectCls = 'h-9 w-full rounded-lg border border-border px-2.5 text-[13px] outline-none focus:border-accent';
  return (
    <Modal open onClose={onClose} title={`Move ${asset.name}`}
      footer={<>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn icon={MapPin} disabled={!to || to === from} onClick={() => {
          const gfTo = geofences.find((g) => g.id === to);
          setExtra(asset.id, { locationId: to, lastMovedAt: DEMO_NOW_ISO });
          pushHistory(asset.id, {
            from: DEMO_NOW_ISO, to: null, target: gfTo?.name ?? to, by: 'Brian Kibe', durationH: null,
          });
          if (asset.assignedVehicleId) update('assets', asset.id, { assignedVehicleId: null, status: 'available' });
          toast({ title: 'Move recorded', body: `${asset.name} → ${gfTo?.name}. History updated.`, status: 'ok' });
          onClose();
        }}>Record move</Btn>
      </>}>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          From
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>
            {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-medium text-ink-400">
          To
          <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} autoFocus>
            <option value="">Select…</option>
            {geofences.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-3 text-[12px] text-ink-400">Manual move — untracked assets rely on yard moves logged here.</p>
    </Modal>
  );
}
