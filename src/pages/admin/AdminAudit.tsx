// /admin/audit — Audit Trail (design/admin-audit.md)

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown, Copy, Download, FilePlus2, Lock, LogIn,
  Pencil, RotateCcw, Search, ShieldCheck, Trash2, Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AuditDiff, toast } from '@/components/shared';
import { getById, useCollection } from '@/lib/store';
import type { AuditEntry } from '@/lib/types';
import { fmtDateTimeEAT, fmtNum } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  AdminSubNav, Btn, Card, Chip, EASE, PageShell, collectionLabel,
  demoDateDaysAgo, exportXlsx, inputCls, logAudit,
} from './common';

/* ---------------- action metadata ---------------- */

const ACTION_META: Record<AuditEntry['action'], { label: string; icon: LucideIcon; tile: string }> = {
  create: { label: 'CREATE', icon: FilePlus2, tile: 'bg-ok-soft text-ok-on-soft' },
  update: { label: 'UPDATE', icon: Pencil, tile: 'bg-accent-soft text-accent-strong' },
  delete: { label: 'DELETE', icon: Trash2, tile: 'bg-alert-soft text-alert-on-soft' },
  login: { label: 'LOGIN', icon: LogIn, tile: 'bg-inactive-soft text-inactive-on-soft' },
  export: { label: 'EXPORT', icon: Download, tile: 'bg-info-soft text-info-on-soft' },
  import: { label: 'IMPORT / RESTORE', icon: RotateCcw, tile: 'bg-navy-900 text-white' },
};

const ALL_ACTIONS = Object.keys(ACTION_META) as AuditEntry['action'][];
const MODULES = ['vehicles', 'drivers', 'jobs', 'workOrders', 'fuelLogs', 'documents', 'settings', 'users', 'reports', 'alerts', 'geofences', 'trips'];

function sourceChip(e: AuditEntry): string {
  if (e.userId === 'SYSTEM' || e.userName === 'SYSTEM') return 'API-SIM';
  if (e.collection === 'inspections' || e.collection === 'shifts') return 'MOBILE';
  return 'WEB';
}

function sessionId(e: AuditEntry): string {
  let h = 0;
  for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `ses-${h.toString(16).padStart(8, '0')}`;
}

/* ---------------- page ---------------- */

const PAGE = 50;

export default function AdminAuditPage() {
  const entries = useCollection('audit');
  const users = useCollection('users');
  const [userFilter, setUserFilter] = useState('');
  const [actions, setActions] = useState<Set<AuditEntry['action']>>(new Set());
  const [modules, setModules] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<7 | 30 | 9999>(7);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.at.localeCompare(a.at)),
    [entries],
  );

  const filtered = useMemo(() => sorted.filter((e) => {
    if (userFilter && e.userId !== userFilter) return false;
    if (actions.size && !actions.has(e.action)) return false;
    if (modules.size && !modules.has(e.collection)) return false;
    if (range !== 9999 && e.at.slice(0, 10) < demoDateDaysAgo(range)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${e.userName} ${e.recordId} ${e.summary} ${e.collection}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [sorted, userFilter, actions, modules, range, search]);

  const todayCount = entries.filter((e) => e.at.slice(0, 10) === TODAY).length;
  const weekCount = entries.filter((e) => e.at.slice(0, 10) >= demoDateDaysAgo(7)).length;

  const toggle = <T,>(set: Set<T>, v: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v); else next.add(v);
    apply(next);
  };

  const doExport = () => {
    const rows = filtered.map((e) => ({
      'Timestamp (EAT)': fmtDateTimeEAT(e.at, true),
      Actor: e.userName,
      Action: ACTION_META[e.action].label,
      Module: collectionLabel(e.collection),
      Entity: e.recordId,
      Summary: e.summary,
      Source: sourceChip(e),
    }));
    const n = exportXlsx(`audit-trail-${range === 9999 ? 'all' : `${range}d`}-${TODAY}.xlsx`, [{ name: 'Audit trail', rows }]);
    logAudit('export', 'audit', 'export', `Exported audit trail (${n} rows, ${range === 9999 ? 'all time' : `${range}d`})`);
    toast({ title: 'Audit trail exported', body: `${n} rows · export logged as a new entry`, status: 'ok' });
  };

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).catch(() => undefined);
    toast({ title: 'Copied', body: id, status: 'inactive' });
  };

  const visible = filtered.slice(0, shown);

  return (
    <PageShell className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Audit Trail</h1>
          <AdminSubNav active="audit" />
        </div>
        <div className="flex items-center gap-2">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: EASE }}
            title="Entries form a hash-chained, append-only log (concept in demo)"
            className="flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1.5 text-[12px] font-medium text-ok-on-soft">
            <ShieldCheck size={14} /> Log intact · {fmtNum(entries.length)} entries · demo chain verified
          </motion.div>
          <Btn variant="navy" onClick={doExport}><Download size={15} /> Export</Btn>
        </div>
      </div>
      <div className="font-mono text-micro text-ink-400">Today {fmtNum(todayCount)} entries · This week {fmtNum(weekCount)}</div>

      <div className="flex gap-4">
        {/* filter rail */}
        <motion.aside
          initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE }}
          className="hidden w-60 shrink-0 flex-col gap-4 md:flex">
          <Card className="p-3">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">User</div>
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className={inputCls}>
              <option value="">All users + SYSTEM</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="SYSTEM">SYSTEM</option>
            </select>
          </Card>
          <Card className="p-3">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Action</div>
            {ALL_ACTIONS.map((a) => {
              const M = ACTION_META[a];
              return (
                <label key={a} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink-900 hover:bg-surface-muted">
                  <input type="checkbox" checked={actions.has(a)} onChange={() => toggle(actions, a, setActions)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
                  <span className={cn('flex h-5 w-5 items-center justify-center rounded', M.tile)}><M.icon size={11} /></span>
                  {M.label}
                </label>
              );
            })}
          </Card>
          <Card className="p-3">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Module</div>
            {MODULES.map((m) => (
              <label key={m} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink-900 hover:bg-surface-muted">
                <input type="checkbox" checked={modules.has(m)} onChange={() => toggle(modules, m, setModules)} className="h-3.5 w-3.5 accent-[#06B6D4]" />
                {collectionLabel(m)}
              </label>
            ))}
          </Card>
          <Card className="p-3">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Date range</div>
            <div className="flex gap-1">
              {([['7 d', 7], ['30 d', 30], ['All', 9999]] as [string, 7 | 30 | 9999][]).map(([label, v]) => (
                <button key={label} type="button" onClick={() => setRange(v)}
                  className={cn('rounded-full px-2.5 py-1 text-micro font-medium', range === v ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
                  {label}
                </button>
              ))}
            </div>
          </Card>
        </motion.aside>

        {/* log list */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <form className="relative" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }}>
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder='Search actor, entity ("wo-001", plate, doc no)… Enter applies'
              className={cn(inputCls, 'pl-9 font-mono text-[12px]')}
            />
          </form>

          {(search || userFilter || actions.size > 0 || modules.size > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {search && <Chip tone="accent">“{search}” <button type="button" onClick={() => { setSearch(''); setSearchInput(''); }}>×</button></Chip>}
              {userFilter && <Chip tone="accent">{users.find((u) => u.id === userFilter)?.name ?? userFilter} <button type="button" onClick={() => setUserFilter('')}>×</button></Chip>}
              {[...actions].map((a) => <Chip key={a} tone="accent">{ACTION_META[a].label} <button type="button" onClick={() => toggle(actions, a, setActions)}>×</button></Chip>)}
              {[...modules].map((m) => <Chip key={m} tone="accent">{collectionLabel(m)} <button type="button" onClick={() => toggle(modules, m, setModules)}>×</button></Chip>)}
            </div>
          )}

          {visible.length === 0 && (
            <Card className="p-10 text-center text-[13px] text-ink-400">No entries match these filters.</Card>
          )}

          {visible.map((e, i) => {
            const M = ACTION_META[e.action];
            const isOpen = expanded === e.id;
            const related = entries.filter((x) => x.recordId === e.recordId && x.id !== e.id).length;
            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.5), ease: EASE }}
                className={cn('overflow-hidden rounded-card border border-border bg-white shadow-card', e.id.startsWith('aud-') && i === 0 && 'animate-alert-flash')}
              >
                <button type="button" onClick={() => setExpanded(isOpen ? null : e.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-muted">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', M.tile)}>
                    {e.summary.toLowerCase().includes('failed') ? <Lock size={15} /> : <M.icon size={15} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium leading-5 text-ink-900">
                      <span className="text-accent-strong">{e.userName}</span> {e.summary}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Chip tone="inactive">{collectionLabel(e.collection)}</Chip>
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); copyId(e.recordId); }}
                        className="group inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 font-mono text-micro font-medium text-navy-800 transition-transform hover:-translate-y-px">
                        {e.recordId} <Copy size={9} className="opacity-0 group-hover:opacity-100" />
                      </button>
                      <span className="font-mono text-micro text-ink-400">196.201.xx.xx</span>
                      <Chip tone={sourceChip(e) === 'WEB' ? 'info' : sourceChip(e) === 'MOBILE' ? 'ok' : 'inactive'}>{sourceChip(e)}</Chip>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[11px] text-ink-600">{fmtDateTimeEAT(e.at, true)}</span>
                    <ChevronDown size={14} className={cn('ml-auto mt-1 text-ink-400 transition-transform duration-200', isOpen && 'rotate-180')} />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="border-t border-border bg-surface-muted/50"
                    >
                      <div className="flex flex-col gap-2 px-4 py-3">
                        {e.diff && e.diff.length > 0 ? (
                          <AuditDiff rows={e.diff} />
                        ) : e.action === 'create' ? (
                          <CreateBlob entry={e} />
                        ) : (
                          <div className="rounded-lg border border-border bg-white px-3 py-2 text-[12px] text-ink-400">
                            No field-level diff recorded for this entry (pre-migration log line).
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-3 font-mono text-micro text-ink-400">
                          <span>{sessionId(e)}</span>
                          <span>FleetOS-Web/2.4.1 (demo UA)</span>
                          {related > 0 && (
                            <button type="button"
                              onClick={() => { setSearch(e.recordId); setSearchInput(e.recordId); }}
                              className="text-accent-strong hover:underline">
                              {related} more on {e.recordId} →
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}

          {filtered.length > shown && (
            <Btn className="self-center" onClick={() => setShown(shown + PAGE)}>
              Load more — {fmtNum(filtered.length - shown)} remaining
            </Btn>
          )}

          {/* behavior note */}
          <Card className="flex items-start gap-2 border-info/30 bg-info-soft/60 p-3 text-[12px] leading-5 text-info-on-soft">
            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
            Audit entries are append-only. Admins can filter and export but not edit or delete entries — including via
            Clear-all-data (the audit of the wipe itself is retained in the fresh log).
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

/** "+ N fields created" + collapsible JSON blob for create entries. */
function CreateBlob({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const rec = getById(entry.collection as never, entry.recordId) as Record<string, unknown> | undefined;
  const fields = rec ? Object.keys(rec).length : 0;
  return (
    <div className="rounded-lg border border-border bg-white">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-ink-600 hover:bg-surface-muted">
        <span className="flex items-center gap-1.5"><Upload size={13} className="text-ok" /> + {fields || '—'} fields created</span>
        <ChevronDown size={14} className={cn('text-ink-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <motion.pre
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
          className="max-h-[200px] overflow-auto border-t border-border bg-navy-900 p-3 font-mono text-[12px] leading-5 text-navy-50">
          {rec ? JSON.stringify(rec, null, 2) : `Record ${entry.recordId} no longer present (deleted or replaced).`}
        </motion.pre>
      )}
    </div>
  );
}
