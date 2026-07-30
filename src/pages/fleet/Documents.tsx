// FBV FleetOS — /documents Compliance Document Vault (design/documents.md).
// 90/60/30-day expiry radar, runway timeline, vault table + renewal workflow.

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bell, BadgeCheck, CalendarClock, Car, CreditCard, Download, FileBadge,
  FileText, FileUp, History, Paperclip, RefreshCcw, Search, ShieldCheck,
  User,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertBanner, DataTable, Drawer, FileDropzone, Modal, PlateTag, StatusPill,
  toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, update, useCollection } from '@/lib/store';
import {
  expiryKey, fmtDateEAT,
} from '@/lib/format';
import type { StatusKey } from '@/lib/format';
import type { DocumentRec, Driver, Vehicle } from '@/lib/types';
import { cn } from '@/lib/utils';
import { TODAY } from '@/lib/seed';
import {
  Avatar, auditLog, addDaysISO, demoDaysUntil, exportXlsx, nowIsoEAT,
  useLocalKV,
} from './lib';
import { ExpiryRing } from './VehicleDetail';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const DOC_ICON: Record<string, LucideIcon> = {
  'Driving Licence': CreditCard,
  'PSV Badge': BadgeCheck,
  Insurance: ShieldCheck,
  'Inspection Cert': FileBadge,
  'Road Service Licence': Car,
};

function issuerOf(docType: string): string {
  if (docType === 'Insurance') return 'CIC Insurance';
  if (docType === 'Inspection Cert') return 'AA Kenya';
  return 'NTSA';
}

type RenewalState = 'renewal-started' | 'renewed';

function renewalPill(days: number, state?: RenewalState): { key: StatusKey; label: string } {
  if (state === 'renewed') return { key: 'ok', label: 'OK' };
  if (state === 'renewal-started') return { key: 'warn', label: 'RENEWAL STARTED' };
  if (days <= 30) return { key: 'alert', label: 'ACTION NEEDED' };
  return { key: 'ok', label: 'OK' };
}

/* ---------------- expiry timeline runway ---------------- */

function ExpiryRunway({ docs, vehicles, drivers, onPick }: {
  docs: DocumentRec[]; vehicles: Vehicle[]; drivers: Driver[];
  onPick: (d: DocumentRec) => void;
}) {
  const markers = docs
    .map((d) => ({ d, days: demoDaysUntil(d.expiresAt) }))
    .filter((m) => m.days >= 0 && m.days <= 90)
    .sort((a, b) => a.days - b.days);
  return (
    <div className="relative h-[104px] overflow-hidden rounded-card border border-border bg-white shadow-card">
      {/* zone shading: red near today → amber → green */}
      <div className="absolute inset-y-0 left-0 w-[33.3%] bg-alert-soft/40" />
      <div className="absolute inset-y-0 left-[33.3%] w-[33.4%] bg-warn-soft/40" />
      <div className="absolute inset-y-0 left-[66.7%] w-[33.3%] bg-ok-soft/30" />
      {/* axis labels */}
      <div className="absolute inset-x-0 bottom-1.5 flex justify-between px-3 font-mono text-micro text-ink-400">
        <span className="font-semibold text-alert-on-soft">TODAY · {fmtDateEAT(TODAY)}</span>
        <span>+30 d</span><span>+60 d</span><span>+90 d</span>
      </div>
      <div className="absolute inset-y-3 left-[33.3%] w-px bg-border" />
      <div className="absolute inset-y-3 left-[66.7%] w-px bg-border" />
      <div className="absolute inset-y-2 left-0 w-0.5 bg-alert" />
      {/* markers */}
      {markers.map((m, i) => {
        const entity = m.d.entityType === 'vehicle'
          ? vehicles.find((v) => v.id === m.d.entityId)?.plate ?? '?'
          : drivers.find((x) => x.id === m.d.entityId)?.name ?? '?';
        const left = 1 + (m.days / 90) * 97;
        const top = 18 + (i % 3) * 20;
        const key = expiryKey(m.days);
        return (
          <motion.button key={m.d.id} type="button"
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, delay: 0.2 + i * 0.03, ease: EASE }}
            whileHover={{ scale: 1.4 }}
            onClick={() => onPick(m.d)}
            title={`${m.d.docType} · ${entity} · expires ${fmtDateEAT(m.d.expiresAt)} (${m.days} d)`}
            className={cn('group absolute h-3.5 w-3.5 rounded-full border-2 border-white shadow-card',
              key === 'alert' ? 'bg-alert' : 'bg-warn')}
            style={{ left: `${left}%`, top }}>
            <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-navy-900 px-2 py-1 font-mono text-[10px] font-semibold text-white group-hover:block">
              {m.d.docType} · {entity} · {m.days} d
            </span>
          </motion.button>
        );
      })}
      <span className="absolute right-3 top-2 text-micro font-medium text-ink-400">90-day expiry runway</span>
    </div>
  );
}

/* ---------------- upload modal ---------------- */

function UploadModal({ open, vehicles, drivers, onClose }: {
  open: boolean; vehicles: Vehicle[]; drivers: Driver[]; onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [entityType, setEntityType] = useState<'vehicle' | 'driver'>('vehicle');
  const [entityId, setEntityId] = useState('');
  const [docType, setDocType] = useState('Insurance');
  const [number, setNumber] = useState('');
  const [issued, setIssued] = useState(TODAY);
  const [expiry, setExpiry] = useState('');
  const valid = entityId && number.trim() && expiry;
  const expiredFlag = expiry && demoDaysUntil(expiry) < 0;
  const input = 'h-9 w-full rounded-lg border border-border px-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
  return (
    <Modal open={open} onClose={onClose} wide title="Upload document"
      footer={
        <>
          <button type="button" onClick={onClose}
            className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
          <button type="button" disabled={!valid}
            onClick={() => {
              const rec = add('documents', {
                id: `doc-${Date.now().toString(36)}`,
                entityType, entityId, docType, number: number.trim(),
                issuedAt: issued, expiresAt: expiry,
                fileName: files[0]?.name ?? 'scan.pdf',
              });
              auditLog('create', 'documents', rec.id, `Uploaded ${docType} ${number.trim()}`);
              toast({ title: 'Document uploaded', body: `${docType} · expires ${fmtDateEAT(expiry)} — radar updated`, status: expiredFlag ? 'warn' : 'ok' });
              onClose();
              setFiles([]); setEntityId(''); setNumber(''); setExpiry('');
            }}
            className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Save to vault</button>
        </>
      }>
      <div className="flex flex-col gap-3">
        <FileDropzone onFiles={setFiles} accept=".pdf,.jpg,.jpeg,.png" />
        {files.length > 0 && (
          <p className="text-micro text-ink-600">{files.map((f) => f.name).join(', ')}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Linked to</span>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {(['vehicle', 'driver'] as const).map((t) => (
                <button key={t} type="button" onClick={() => { setEntityType(t); setEntityId(''); }}
                  className={cn('h-9 flex-1 text-[12px] font-semibold capitalize', entityType === t ? 'bg-accent-soft text-accent-strong' : 'text-ink-600 hover:bg-surface-muted')}>
                  {t}
                </button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">{entityType}</span>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={input}>
              <option value="">— select —</option>
              {entityType === 'vehicle'
                ? vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.model}</option>)
                : drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Document type</span>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={input}>
              {Object.keys(DOC_ICON).map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Document number</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="INS-KE-123456" className={cn(input, 'font-mono')} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Issue date</span>
            <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className={cn(input, 'font-mono')} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Expiry date *</span>
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={cn(input, 'font-mono', expiredFlag && 'border-alert')} />
            {expiredFlag && <span className="text-micro font-semibold text-alert-on-soft">Date is in the past — saved as EXPIRED.</span>}
          </label>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- document drawer ---------------- */

function DocDrawer({ doc, vehicles, drivers, renewal, setRenewal, onClose }: {
  doc: DocumentRec | null; vehicles: Vehicle[]; drivers: Driver[];
  renewal: Record<string, RenewalState>;
  setRenewal: (r: Record<string, RenewalState>) => void;
  onClose: () => void;
}) {
  const [renewOpen, setRenewOpen] = useState(false);
  const [newExpiry, setNewExpiry] = useState('');
  const [newNumber, setNewNumber] = useState('');
  if (!doc) return <Drawer open={!!doc} onClose={onClose} title="Document"><div /></Drawer>;

  const days = demoDaysUntil(doc.expiresAt);
  const state = renewal[doc.id];
  const pill = renewalPill(days, state);
  const Icon = DOC_ICON[doc.docType] ?? FileText;
  const vehicle = doc.entityType === 'vehicle' ? vehicles.find((v) => v.id === doc.entityId) : undefined;
  const driver = doc.entityType === 'driver' ? drivers.find((d) => d.id === doc.entityId) : undefined;
  const entityLabel = vehicle?.plate ?? driver?.name ?? doc.entityId;
  const alertsFired = [90, 60, 30].filter((t) => days <= t);

  const startRenewal = () => {
    setRenewal({ ...renewal, [doc.id]: 'renewal-started' });
    auditLog('update', 'documents', doc.id, `Renewal started — ${doc.docType} ${doc.number}`);
    toast({ title: 'Renewal started', body: `${doc.docType} · booking noted for ${fmtDateEAT(addDaysISO(3))}`, status: 'info' });
  };

  const markRenewed = () => {
    if (!newExpiry || !newNumber.trim()) return;
    update('documents', doc.id, { expiresAt: newExpiry, number: newNumber.trim(), issuedAt: TODAY });
    setRenewal({ ...renewal, [doc.id]: 'renewed' });
    auditLog('update', 'documents', doc.id, `Renewed ${doc.docType} → ${newNumber.trim()} (exp ${fmtDateEAT(newExpiry)}); old ${doc.number} archived`);
    toast({ title: 'Document renewed', body: `${doc.docType} now expires ${fmtDateEAT(newExpiry)} — old copy archived to history`, status: 'ok' });
    setRenewOpen(false);
  };

  return (
    <Drawer open={!!doc} onClose={onClose} width={500}
      title={<span className="flex items-center gap-2"><Icon size={16} />{doc.docType}<StatusPill status={pill.key} label={pill.label} /></span>}>
      <div className="flex flex-col gap-5">
        {/* CSS preview mock */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
          className="relative mx-auto w-full max-w-[340px] overflow-hidden rounded-lg border border-border bg-white shadow-card">
          <div className="flex items-center justify-between bg-navy-900 px-4 py-2.5">
            <span className="text-[11px] font-bold tracking-[0.08em] text-white">{doc.docType.toUpperCase()}</span>
            <span className="font-mono text-[10px] text-accent-on-navy">REPUBLIC OF KENYA</span>
          </div>
          <div className="relative flex h-[150px] flex-col justify-center gap-1.5 px-5">
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[26px] font-bold text-navy-50 select-none">
              {doc.number}
            </span>
            <div className="h-2 w-3/4 rounded bg-surface-muted" />
            <div className="h-2 w-1/2 rounded bg-surface-muted" />
            <div className="h-2 w-2/3 rounded bg-surface-muted" />
            <div className="mt-2 font-mono text-[10px] text-ink-400">Scanned copy · {doc.fileName ?? 'scan.pdf'}</div>
          </div>
        </motion.div>

        <div className="flex items-center gap-4">
          <ExpiryRing days={Math.max(0, days)} size={64} />
          <div>
            <div className="font-mono text-[15px] font-bold text-ink-900">{doc.number}</div>
            <div className="text-[12px] text-ink-600">
              {days < 0 ? `expired ${-days} days ago` : `expires ${fmtDateEAT(doc.expiresAt)} — ${days} days left`}
            </div>
          </div>
        </div>

        {/* metadata grid */}
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          {([
            ['Linked entity', entityLabel],
            ['Issuer', issuerOf(doc.docType)],
            ['Issued', fmtDateEAT(doc.issuedAt)],
            ['Expiry', fmtDateEAT(doc.expiresAt)],
            ['Uploaded by', 'Wanjiru Maina'],
            ['File', doc.fileName ?? 'scan.pdf'],
          ] as const).map(([k, val]) => (
            <div key={k} className="rounded-lg border border-border px-3 py-2">
              <div className="text-micro uppercase tracking-[0.06em] text-ink-400">{k}</div>
              <div className="font-mono text-[12px] font-semibold text-ink-900">{val}</div>
            </div>
          ))}
        </div>

        {/* alert schedule */}
        <div className="rounded-lg bg-surface-muted px-3 py-2 text-[12px] text-ink-600">
          Alerts fired: 90 d {alertsFired.includes(90) ? '✓' : '—'} · 60 d {alertsFired.includes(60) ? '✓' : '—'} · 30 d{' '}
          {alertsFired.includes(30) ? '✓' : `scheduled ${fmtDateEAT(addDaysISO(Math.max(1, days - 30)))}`}
          <span className="block text-micro text-ink-400">recipients: Fleet Manager + document owner</span>
        </div>

        {/* renewal workflow */}
        <div className="flex gap-2">
          {state !== 'renewal-started' && state !== 'renewed' && (
            <button type="button" onClick={startRenewal}
              className="h-9 flex-1 rounded-lg border border-warn text-[13px] font-semibold text-warn-on-soft hover:bg-warn-soft">
              Start renewal
            </button>
          )}
          <button type="button" onClick={() => { setRenewOpen(true); setNewExpiry(''); setNewNumber(''); }}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-navy-950 hover:bg-accent-strong">
            <RefreshCcw size={14} /> Mark renewed
          </button>
        </div>
        <p className="font-mono text-micro text-ink-400">audit: uploaded by Wanjiru Maina · {fmtDateEAT(doc.issuedAt)} · every renewal is diff-logged</p>
      </div>

      <Modal open={renewOpen} onClose={() => setRenewOpen(false)} title={`Renew ${doc.docType}`}
        footer={
          <>
            <button type="button" onClick={() => setRenewOpen(false)}
              className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-600 hover:bg-surface-muted">Cancel</button>
            <button type="button" disabled={!newExpiry || !newNumber.trim()} onClick={markRenewed}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-navy-950 hover:bg-accent-strong disabled:opacity-40">Replace document</button>
          </>
        }>
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-ink-600">The current document ({doc.number}) is archived to History and replaced:</p>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">New document number</span>
            <input value={newNumber} onChange={(e) => setNewNumber(e.target.value)}
              className="h-9 rounded-lg border border-border px-3 font-mono text-[13px] outline-none focus:border-accent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">New expiry date</span>
            <input type="date" value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)}
              className="h-9 rounded-lg border border-border px-3 font-mono text-[13px] outline-none focus:border-accent" />
          </label>
          <FileDropzone onFiles={() => toast({ title: 'Scan attached', body: 'Replacement scan linked to the new record.', status: 'ok' })}
            accept=".pdf,.jpg,.jpeg,.png" className="py-6" />
        </div>
      </Modal>
    </Drawer>
  );
}

/* ---------------- main page ---------------- */

type RadarBand = 'all' | 'le30' | 'd31-60' | 'd61-90' | 'ok';

export default function Documents() {
  const documents = useCollection('documents');
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const [renewal, setRenewal] = useLocalKV<Record<string, RenewalState>>('docRenewal', {});

  const [band, setBand] = useState<RadarBand>('all');
  const [typeF, setTypeF] = useState<'all' | string>('all');
  const [entityF, setEntityF] = useState<'all' | 'vehicle' | 'driver'>('all');
  const [stateF, setStateF] = useState<'all' | 'action' | 'started' | 'ok'>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<DocumentRec | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const withDays = useMemo(() => documents.map((d) => ({ d, days: demoDaysUntil(d.expiresAt) })), [documents]);

  const radar = useMemo(() => ({
    le30: withDays.filter((x) => x.days <= 30).length,
    mid: withDays.filter((x) => x.days > 30 && x.days <= 60).length,
    high: withDays.filter((x) => x.days > 60 && x.days <= 90).length,
    ok: withDays.filter((x) => x.days > 90).length,
  }), [withDays]);

  const rows = useMemo(() => withDays.filter(({ d, days }) => {
    if (band === 'le30' && days > 30) return false;
    if (band === 'd31-60' && (days <= 30 || days > 60)) return false;
    if (band === 'd61-90' && (days <= 60 || days > 90)) return false;
    if (band === 'ok' && days <= 90) return false;
    if (typeF !== 'all' && d.docType !== typeF) return false;
    if (entityF !== 'all' && d.entityType !== entityF) return false;
    const pill = renewalPill(days, renewal[d.id]);
    if (stateF === 'action' && pill.label !== 'ACTION NEEDED') return false;
    if (stateF === 'started' && pill.label !== 'RENEWAL STARTED') return false;
    if (stateF === 'ok' && pill.label !== 'OK') return false;
    if (q.trim()) {
      const v = d.entityType === 'vehicle' ? vehicles.find((x) => x.id === d.entityId)?.plate : drivers.find((x) => x.id === d.entityId)?.name;
      const hay = `${d.number} ${d.docType} ${v ?? ''}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => a.days - b.days), [withDays, band, typeF, entityF, stateF, q, renewal, vehicles, drivers]);

  const entityOf = (d: DocumentRec) => d.entityType === 'vehicle'
    ? vehicles.find((v) => v.id === d.entityId)
    : drivers.find((x) => x.id === d.entityId);

  const remindOwner = (d: DocumentRec) => {
    const days = demoDaysUntil(d.expiresAt);
    const entity = entityOf(d);
    const label = d.entityType === 'vehicle' ? (entity as Vehicle)?.plate : (entity as Driver)?.name;
    add('alerts', {
      id: `al-${Date.now().toString(36)}`,
      type: 'document_expiry', severity: days <= 30 ? 'critical' : 'major',
      message: `Reminder logged — ${d.docType} ${d.number} expires ${fmtDateEAT(d.expiresAt)} (${label})`,
      entityRef: { kind: 'document', id: d.id, label: `${d.docType} · ${label}` },
      at: nowIsoEAT(11, 15), read: false, acknowledged: false,
    });
    toast({ title: 'Reminder logged', body: `${d.docType} expires ${fmtDateEAT(d.expiresAt)} — owner + Fleet Manager notified`, status: 'ok' });
  };

  const radarCards: { key: RadarBand; label: string; count: number; tone: StatusKey; sub: string }[] = [
    { key: 'le30', label: '≤ 30 days', count: radar.le30, tone: 'alert', sub: 'immediate action' },
    { key: 'd31-60', label: '31–60 days', count: radar.mid, tone: 'warn', sub: 'book renewals' },
    { key: 'd61-90', label: '61–90 days', count: radar.high, tone: 'warn', sub: 'early warning' },
    { key: 'ok', label: 'Compliant > 90 d', count: radar.ok, tone: 'ok', sub: 'no action' },
  ];

  const columns: Column<DocumentRec>[] = [
    {
      key: 'dot', header: '', width: '26px', render: (d) => {
        const days = demoDaysUntil(d.expiresAt);
        const key = expiryKey(days);
        return <span className={cn('inline-block h-2.5 w-2.5 rounded-full',
          key === 'alert' ? 'bg-alert' : key === 'warn' ? 'bg-warn' : 'bg-ok')} title={`${days} days`} />;
      },
    },
    {
      key: 'type', header: 'Document', render: (d) => {
        const Icon = DOC_ICON[d.docType] ?? FileText;
        return <span className="flex items-center gap-2 font-medium"><Icon size={14} className="text-ink-400" />{d.docType}</span>;
      },
    },
    {
      key: 'entity', header: 'Linked entity', render: (d) => {
        if (d.entityType === 'vehicle') {
          const v = vehicles.find((x) => x.id === d.entityId);
          return v ? <PlateTag plate={v.plate} /> : '—';
        }
        const dr = drivers.find((x) => x.id === d.entityId);
        return dr ? <span className="flex items-center gap-1.5"><Avatar name={dr.name} size={20} />{dr.name}</span> : '—';
      },
    },
    { key: 'num', header: 'Doc number', mono: true, render: (d) => d.number },
    { key: 'issuer', header: 'Issuer', render: (d) => issuerOf(d.docType) },
    { key: 'issued', header: 'Issued', mono: true, render: (d) => fmtDateEAT(d.issuedAt) },
    {
      key: 'expiry', header: 'Expiry', render: (d) => {
        const days = demoDaysUntil(d.expiresAt);
        return (
          <span className="flex items-center gap-2">
            <span className="font-mono text-[12px]">{fmtDateEAT(d.expiresAt)}</span>
            <StatusPill status={expiryKey(days)} label={days < 0 ? 'EXPIRED' : `${days} days`} pulse={days <= 7 && days >= 0} />
          </span>
        );
      },
    },
    {
      key: 'file', header: 'File', render: () => (
        <span className="flex items-center gap-1 text-[12px] font-medium text-accent-strong"><Paperclip size={12} />view</span>
      ),
    },
    {
      key: 'renewal', header: 'Renewal', render: (d) => {
        const pill = renewalPill(demoDaysUntil(d.expiresAt), renewal[d.id]);
        return <StatusPill status={pill.key} label={pill.label} />;
      },
    },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}
      className="mx-auto flex max-w-[1520px] flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Document Vault</h1>
          <p className="text-[13px] text-ink-400">Licences, PSV badges, insurance & NTSA certificates — 90/60/30-day expiry radar</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => exportXlsx('document-vault-2026-07-28.xlsx', rows.map(({ d }) => ({
              Type: d.docType, Number: d.number,
              Entity: d.entityType === 'vehicle' ? vehicles.find((v) => v.id === d.entityId)?.plate : drivers.find((x) => x.id === d.entityId)?.name,
              Issuer: issuerOf(d.docType), Issued: fmtDateEAT(d.issuedAt), Expiry: fmtDateEAT(d.expiresAt),
              'Days left': demoDaysUntil(d.expiresAt),
            })), 'Documents')}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-[13px] font-semibold text-ink-600 hover:bg-surface-muted">
            <Download size={15} /> Export
          </button>
          <button type="button" onClick={() => setUploadOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
            <FileUp size={15} /> Upload document
          </button>
        </div>
      </div>

      <AlertBanner severity="warn" className="rounded-card"
        message="Vault alerts fire automatically at 90 / 60 / 30 days and daily in the final 7 — to Fleet Manager + document owner. Configure in Settings → Alerts." />

      {/* expiry radar */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {radarCards.map((c, i) => (
          <motion.button key={c.key} type="button"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.08, ease: EASE }}
            onClick={() => setBand(band === c.key ? 'all' : c.key)}
            className={cn('relative overflow-hidden rounded-card border bg-white p-4 text-left shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-pop',
              band === c.key ? 'border-accent ring-2 ring-accent/30' : 'border-border')}>
            <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">{c.label}</div>
            <div className="mt-1 font-mono text-[26px] font-bold leading-8 text-ink-900">{c.count}</div>
            <div className="text-micro text-ink-400">{c.sub}</div>
            <span className={cn('absolute inset-x-0 bottom-0 h-1',
              c.tone === 'alert' ? 'bg-alert' : c.tone === 'warn' ? 'bg-warn' : 'bg-ok')} />
          </motion.button>
        ))}
      </div>

      <ExpiryRunway docs={documents} vehicles={vehicles} drivers={drivers} onPick={setSel} />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search doc number, plate or driver…"
            className="h-9 w-64 rounded-lg border border-border bg-white pl-8 pr-3 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </div>
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-3 text-[13px] outline-none focus:border-accent">
          <option value="all">All types</option>
          {Object.keys(DOC_ICON).map((t) => <option key={t}>{t}</option>)}
        </select>
        {([['all', 'All entities'], ['vehicle', 'Vehicles'], ['driver', 'Drivers']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setEntityF(k)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', entityF === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {l}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {([['all', 'Any state'], ['action', 'Action needed'], ['started', 'Renewal started'], ['ok', 'OK']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStateF(k)}
            className={cn('h-8 rounded-full border px-3 text-[12px] font-semibold', stateF === k ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {l}
          </button>
        ))}
      </div>

      <DataTable<DocumentRec> columns={columns} rows={rows.map((r) => r.d)} pageSize={12}
        onRowClick={setSel}
        rowActions={(d) => [
          { label: 'View', icon: FileText, onClick: () => setSel(d) },
          { label: 'Replace / renew', icon: RefreshCcw, onClick: () => setSel(d) },
          { label: 'Remind owner', icon: Bell, onClick: () => remindOwner(d) },
          {
            label: 'History', icon: History, onClick: () => {
              toast({ title: 'Document history', body: `${d.number} — prior versions appear here after renewals.`, status: 'info' });
            },
          },
        ]}
        empty={
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CalendarClock size={22} className="text-ink-400" />
            <p className="text-[13px] text-ink-400">No documents match the current radar band and filters.</p>
          </div>
        } />

      <p className="flex items-center gap-1.5 text-micro text-ink-400">
        <User size={11} /> Expired documents auto-create red alerts and flag the linked driver/vehicle across the console.
      </p>

      <DocDrawer doc={sel} vehicles={vehicles} drivers={drivers} renewal={renewal} setRenewal={setRenewal} onClose={() => setSel(null)} />
      <UploadModal open={uploadOpen} vehicles={vehicles} drivers={drivers} onClose={() => setUploadOpen(false)} />
    </motion.div>
  );
}
