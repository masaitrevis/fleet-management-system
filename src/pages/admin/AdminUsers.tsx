// /admin/users — Users, Roles & Permission Matrix (design/admin-users.md)

import { Fragment, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, Eye, KeyRound, Minus, Search, ShieldCheck, UserPlus, Users,
} from 'lucide-react';
import {
  ConfirmDialog, DataTable, EmptyState, KPIStatCard, Modal, StatusPill,
  Tabs, toast,
} from '@/components/shared';
import type { Column } from '@/components/shared';
import { add, kvGet, kvSet, update, useCollection } from '@/lib/store';
import type { AppUser, Role } from '@/lib/types';
import { avatarTint, fmtTimeEAT, initials } from '@/lib/format';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import {
  AdminSubNav, Btn, Card, Chip, EASE, PageShell, currentUser, inputCls,
  logAudit, selectCls,
} from './common';

const ROLES: Role[] = ['Admin', 'Fleet Manager', 'Dispatcher', 'Mechanic', 'Driver', 'Read-only'];

const ROLE_STYLE: Record<Role, string> = {
  Admin: 'bg-navy-900 text-white',
  'Fleet Manager': 'bg-accent-soft text-accent-strong',
  Dispatcher: 'bg-info-soft text-info-on-soft',
  Mechanic: 'bg-warn-soft text-warn-on-soft',
  Driver: 'bg-ok-soft text-ok-on-soft',
  'Read-only': 'bg-inactive-soft text-inactive-on-soft',
};

const ROLE_DESC: Record<Role, string> = {
  Admin: 'Full control incl. settings, backup & clear-data.',
  'Fleet Manager': 'Approvals, fleet config, all operations.',
  Dispatcher: 'Jobs, geofences, trips — no costs.',
  Mechanic: 'Work orders, parts, DVIR defects — no approval.',
  Driver: 'Mobile: DVIR, jobs/POD, shifts, own scorecard.',
  'Read-only': 'View + export everything, change nothing.',
};

/* ---------------- permission model ---------------- */

type PermLevel = 'yes' | 'limited' | 'no';

interface PermDef { key: string; label: string; group: string; limitedNote?: string }

const PERMISSIONS: PermDef[] = [
  { key: 'view_live_map', label: 'View live map', group: 'TRACKING', limitedNote: 'assigned vehicle only' },
  { key: 'route_replay', label: 'Route replay', group: 'TRACKING', limitedNote: 'own trips only' },
  { key: 'manage_geofences', label: 'Manage geofences', group: 'OPERATIONS' },
  { key: 'manage_dispatch', label: 'Manage dispatch', group: 'OPERATIONS' },
  { key: 'capture_pod', label: 'Capture POD', group: 'OPERATIONS', limitedNote: 'assigned jobs only' },
  { key: 'classify_trips', label: 'Classify trips', group: 'OPERATIONS' },
  { key: 'manage_drivers', label: 'Manage drivers', group: 'DRIVERS' },
  { key: 'coach_events', label: 'Coach events', group: 'DRIVERS' },
  { key: 'acknowledge_coaching', label: 'Acknowledge coaching', group: 'DRIVERS', limitedNote: 'own events only' },
  { key: 'manage_vehicles', label: 'Manage vehicles', group: 'FLEET' },
  { key: 'approve_work_orders', label: 'Approve work orders', group: 'FLEET' },
  { key: 'edit_work_orders', label: 'Edit work orders', group: 'FLEET', limitedNote: 'assigned WOs only' },
  { key: 'manage_fuel_logs', label: 'Manage fuel logs', group: 'FLEET' },
  { key: 'manage_documents', label: 'Manage documents', group: 'FLEET' },
  { key: 'manage_users', label: 'Manage users', group: 'SYSTEM' },
  { key: 'manage_settings', label: 'Manage settings', group: 'SYSTEM' },
  { key: 'bulk_upload', label: 'Bulk upload', group: 'SYSTEM' },
  { key: 'backup_restore', label: 'Backup / restore', group: 'SYSTEM' },
  { key: 'clear_all_data', label: 'Clear all data', group: 'SYSTEM' },
  { key: 'view_audit_trail', label: 'View audit trail', group: 'SYSTEM' },
];

const DEFAULT_MATRIX: Record<Role, Record<string, PermLevel>> = {
  Admin: Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'yes'])) as Record<string, PermLevel>,
  'Fleet Manager': {
    ...Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'yes'])) as Record<string, PermLevel>,
    manage_users: 'limited', clear_all_data: 'no',
  },
  Dispatcher: {
    ...Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'no'])) as Record<string, PermLevel>,
    view_live_map: 'yes', route_replay: 'yes', manage_geofences: 'yes', manage_dispatch: 'yes',
    capture_pod: 'limited', classify_trips: 'yes',
  },
  Mechanic: {
    ...Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'no'])) as Record<string, PermLevel>,
    view_live_map: 'yes', manage_vehicles: 'limited', edit_work_orders: 'limited', manage_documents: 'yes',
  },
  Driver: {
    ...Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'no'])) as Record<string, PermLevel>,
    view_live_map: 'limited', route_replay: 'limited', capture_pod: 'yes', acknowledge_coaching: 'yes',
  },
  'Read-only': {
    ...Object.fromEntries(PERMISSIONS.map((p) => [p.key, 'no'])) as Record<string, PermLevel>,
    view_live_map: 'yes', route_replay: 'yes', view_audit_trail: 'yes',
  },
};

function userStatus(u: AppUser): 'ACTIVE' | 'INVITED' | 'DISABLED' {
  if (!u.active) return 'DISABLED';
  return u.lastLoginAt === null ? 'INVITED' : 'ACTIVE';
}

/* ---------------- page ---------------- */

export default function AdminUsersPage() {
  const users = useCollection('users');
  const drivers = useCollection('drivers');
  const [tab, setTab] = useState('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [disableTarget, setDisableTarget] = useState<AppUser | null>(null);
  const [impersonating, setImpersonating] = useState<AppUser | null>(null);

  const me = currentUser();
  const isAdmin = me.role === 'Admin';

  const activeSessions = users.filter((u) => u.active && u.lastLoginAt && u.lastLoginAt.slice(0, 10) === TODAY).length;
  const pendingInvites = users.filter((u) => userStatus(u) === 'INVITED').length;

  const filtered = users.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (search && !`${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const linkedDriver = (u: AppUser) => u.role === 'Driver' ? drivers.find((d) => d.name === u.name) : undefined;

  const disableUser = () => {
    if (!disableTarget) return;
    update('users', disableTarget.id, { active: false });
    logAudit('update', 'users', disableTarget.id, `Disabled user ${disableTarget.name} — sessions revoked immediately`,
      [{ field: 'active', before: true, after: false }]);
    toast({ title: 'User disabled', body: `${disableTarget.name} · sessions revoked. Logged to audit trail.`, status: 'warn' });
  };

  const columns: Column<AppUser>[] = [
    {
      key: 'user', header: 'User', render: (u) => (
        <span className="flex items-center gap-2.5">
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold', avatarTint(u.name))}>
            {initials(u.name)}
          </span>
          <span>
            <span className="block font-medium text-ink-900">{u.name}</span>
            <span className="block font-mono text-micro text-ink-400">{u.email}</span>
          </span>
        </span>
      ),
    },
    { key: 'role', header: 'Role', render: (u) => <span className={cn('rounded-full px-2 py-0.5 text-micro font-medium', ROLE_STYLE[u.role])}>{u.role}</span> },
    {
      key: 'driver', header: 'Linked driver', render: (u) => {
        const d = linkedDriver(u);
        return d ? <span className="text-accent-strong">{d.name}</span> : <span className="text-ink-400">—</span>;
      },
    },
    {
      key: 'last', header: 'Last active', mono: true, render: (u) => u.lastLoginAt
        ? (u.lastLoginAt.slice(0, 10) === TODAY ? fmtTimeEAT(u.lastLoginAt) : `${Math.round((new Date(`${TODAY}T00:00:00Z`).getTime() - new Date(u.lastLoginAt).getTime()) / 86400000)} d ago`)
        : '—',
    },
    {
      key: 'status', header: 'Status', render: (u) => {
        const s = userStatus(u);
        return <StatusPill status={s === 'ACTIVE' ? 'ok' : s === 'INVITED' ? 'warn' : 'inactive'} label={s} pulse={s === 'INVITED'} />;
      },
    },
    { key: 'mfa', header: 'MFA', align: 'center', render: (u) => (u.role === 'Admin' || u.role === 'Fleet Manager' ? <Check size={14} className="mx-auto text-ok" /> : <Minus size={14} className="mx-auto text-ink-400" />) },
  ];

  return (
    <PageShell className="flex flex-col gap-4">
      {impersonating && (
        <div className="flex items-center justify-between rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-medium text-white">
          <span className="flex items-center gap-2"><Eye size={15} className="text-accent-on-navy" /> Viewing as {impersonating.name} ({impersonating.role}) — read-only</span>
          <button type="button" onClick={() => setImpersonating(null)} className="rounded-md px-2 py-0.5 text-accent-on-navy hover:bg-navy-800">Exit ×</button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Users & Roles</h1>
          <AdminSubNav active="users" />
        </div>
        <Btn variant="accent" onClick={() => setInviteOpen(true)}><UserPlus size={15} /> Invite user</Btn>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPIStatCard label="Users" value={users.length} icon={Users} />
        <KPIStatCard label="Active sessions" value={activeSessions} icon={ShieldCheck} delta="live" deltaGood />
        <KPIStatCard label="Roles" value={6} icon={KeyRound} />
        <KPIStatCard label="Pending invites" value={pendingInvites} icon={UserPlus} delta={pendingInvites > 0 ? 'awaiting sign-in' : undefined} deltaGood={pendingInvites === 0} />
      </div>

      <Tabs
        tabs={[
          { key: 'users', label: 'Users', count: users.length },
          { key: 'matrix', label: 'Permission matrix' },
          { key: 'roles', label: 'Role cards', count: 6 },
        ]}
        active={tab}
        onChange={setTab}
      />

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
          {tab === 'users' && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…"
                    className={cn(inputCls, 'w-56 pl-8')} />
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setRoleFilter(null)}
                    className={cn('rounded-full px-2.5 py-1 text-micro font-medium', !roleFilter ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
                    All roles
                  </button>
                  {ROLES.map((r) => (
                    <button key={r} type="button" onClick={() => setRoleFilter(roleFilter === r ? null : r)}
                      className={cn('rounded-full px-2.5 py-1 text-micro font-medium', roleFilter === r ? 'bg-accent-soft text-accent-strong' : 'bg-inactive-soft text-inactive-on-soft')}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                columns={columns}
                rows={filtered}
                pageSize={12}
                empty={<EmptyState title="No users match" hint="Adjust the search or role filter." />}
                rowActions={(u) => [
                  { label: 'Reset password', icon: KeyRound, onClick: () => { logAudit('update', 'users', u.id, `Password reset issued for ${u.name}`); toast({ title: 'Password reset sent', body: `${u.email} · logged to audit trail`, status: 'ok' }); } },
                  ...(isAdmin ? [{ label: 'Impersonate-view', icon: Eye, onClick: () => { setImpersonating(u); logAudit('login', 'users', u.id, `${me.name} entered impersonate-view as ${u.name}`); } }] : []),
                  ...(u.active ? [{ label: 'Disable', icon: Minus, danger: true, onClick: () => setDisableTarget(u) }] : []),
                ]}
              />
            </div>
          )}

          {tab === 'matrix' && <PermissionMatrix isAdmin={isAdmin} />}
          {tab === 'roles' && (
            <RoleCards
              users={users}
              onViewUsers={(r) => { setRoleFilter(r); setTab('users'); }}
              isAdmin={isAdmin}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ConfirmDialog
        open={!!disableTarget}
        onClose={() => setDisableTarget(null)}
        onConfirm={disableUser}
        title={`Disable ${disableTarget?.name}?`}
        body="Sessions revoked immediately. The account can be re-enabled later."
        confirmLabel="Disable user"
        destructive
      />
    </PageShell>
  );
}

/* ---------------- permission matrix ---------------- */

function PermissionMatrix({ isAdmin }: { isAdmin: boolean }) {
  const [matrix, setMatrix] = useState<Record<Role, Record<string, PermLevel>>>(() =>
    (kvGet('permMatrix') as Record<Role, Record<string, PermLevel>> | undefined) ?? DEFAULT_MATRIX);
  const [pending, setPending] = useState<{ role: Role; perm: PermDef; next: PermLevel } | null>(null);

  const cycle = (role: Role, perm: PermDef) => {
    const cur = matrix[role][perm.key];
    const next: PermLevel = cur === 'yes' ? 'limited' : cur === 'limited' ? 'no' : 'yes';
    setPending({ role, perm, next });
  };

  const confirm = () => {
    if (!pending) return;
    const next = { ...matrix, [pending.role]: { ...matrix[pending.role], [pending.perm.key]: pending.next } };
    setMatrix(next);
    kvSet('permMatrix', next);
    const label = pending.next === 'yes' ? '✓' : pending.next === 'limited' ? '◐' : '—';
    const before = matrix[pending.role][pending.perm.key];
    logAudit('update', 'users', `perm-${pending.perm.key}-${pending.role}`,
      `Permission change — ${pending.role}: ${pending.perm.label} ${before === 'yes' ? '✓' : before === 'limited' ? '◐' : '—'} → ${label}`,
      [{ field: pending.perm.label, before, after: pending.next }]);
    toast({ title: 'Permission updated', body: `${pending.role} · ${pending.perm.label} → ${label}. Logged to audit trail.`, status: 'ok' });
  };

  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];

  return (
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-table">
        <thead>
          <tr className="border-b border-border bg-surface-muted/70">
            <th className="h-9 px-3 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">Permission</th>
            {ROLES.map((r) => (
              <th key={r} className="h-9 px-2 text-center text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr className="bg-surface-muted/50">
                <td colSpan={7} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-400">{g}</td>
              </tr>
              {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                <tr key={p.key} className="border-b border-border/60 transition-colors hover:bg-surface-muted">
                  <td className="px-3 py-2 text-[13px] text-ink-900">{p.label}</td>
                  {ROLES.map((r) => {
                    const level = matrix[r][p.key];
                    const editable = isAdmin && r !== 'Admin';
                    return (
                      <td key={r} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          disabled={!editable}
                          title={level === 'limited' ? (p.limitedNote ?? 'limited') : undefined}
                          onClick={() => editable && cycle(r, p)}
                          className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full transition-all duration-200',
                            level === 'yes' && 'bg-ok-soft text-ok-on-soft',
                            level === 'limited' && 'bg-warn-soft text-warn-on-soft',
                            level === 'no' && 'bg-inactive-soft text-ink-400',
                            editable && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-card')}>
                          {level === 'yes' ? <Check size={13} /> : level === 'limited' ? <span className="text-[11px] font-bold">◐</span> : <Minus size={13} />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-4 border-t border-border px-3 py-2.5 text-micro text-ink-400">
        <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-ok-soft text-ok-on-soft"><Check size={10} /></span> allowed</span>
        <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-warn-soft text-warn-on-soft text-[9px] font-bold">◐</span> limited (own data only)</span>
        <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-inactive-soft text-ink-400"><Minus size={10} /></span> denied</span>
        <span className="ml-auto max-w-md text-[12px]">Drivers use the mobile shell — they only ever see DVIR, Jobs, Shifts and their own profile.</span>
      </div>

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        title={`Change permission for all ${pending?.role}s?`}
        body={pending ? `"${pending.perm.label}" becomes ${pending.next === 'yes' ? 'allowed' : pending.next === 'limited' ? `limited (${pending.perm.limitedNote ?? 'own data only'})` : 'denied'} for every ${pending.role} account.` : ''}
        confirmLabel="Change permission"
      />
    </Card>
  );
}

/* ---------------- role cards ---------------- */

function RoleCards({ users, onViewUsers, isAdmin }: {
  users: AppUser[];
  onViewUsers: (r: Role) => void;
  isAdmin: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ROLES.map((r, i) => {
        const perms = PERMISSIONS.filter((p) => DEFAULT_MATRIX[r][p.key] === 'yes').slice(0, 4);
        return (
          <motion.div key={r}
            initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
            className="flex flex-col gap-3 rounded-card border border-border bg-white p-5 shadow-card transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop">
            <div className="flex items-center justify-between">
              <span className={cn('rounded-full px-3 py-1 text-[13px] font-semibold', ROLE_STYLE[r])}>{r}</span>
              <Chip>{users.filter((u) => u.role === r).length} users</Chip>
            </div>
            <div className="text-[13px] leading-5 text-ink-600">{ROLE_DESC[r]}</div>
            <ul className="flex flex-col gap-1 text-[12px] text-ink-600">
              {perms.map((p) => (
                <li key={p.key} className="flex items-center gap-1.5"><Check size={12} className="text-ok" /> {p.label}</li>
              ))}
            </ul>
            <div className="mt-auto flex gap-2 pt-1">
              <Btn className="h-8 text-micro" onClick={() => onViewUsers(r)}>View users →</Btn>
              {isAdmin && (
                <Btn className="h-8 text-micro" variant="ghost"
                  onClick={() => toast({ title: 'Edit role', body: 'Adjust cells in the Permission matrix tab — changes are audited.', status: 'info' })}>
                  Edit role
                </Btn>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---------------- invite modal ---------------- */

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const drivers = useCollection('drivers');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Dispatcher');
  const [driverId, setDriverId] = useState('');

  const permPreview = PERMISSIONS.filter((p) => DEFAULT_MATRIX[role][p.key] === 'yes').map((p) => p.label);

  const send = () => {
    const finalName = role === 'Driver' && driverId ? drivers.find((d) => d.id === driverId)?.name ?? name : name;
    const u = add('users', {
      id: `usr-${Date.now().toString(36)}`,
      name: finalName, email, role, active: true, lastLoginAt: null,
    });
    logAudit('create', 'users', u.id, `Invited ${finalName} (${email}) as ${role}`);
    toast({ title: 'Invite sent', body: `${email} · ${role}. Logged to audit trail.`, status: 'ok' });
    setName(''); setEmail(''); setRole('Dispatcher'); setDriverId('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite user" wide
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="accent" disabled={!email || (role === 'Driver' ? !driverId : !name)} onClick={send}>Send invite</Btn>
        </>
      }>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-ink-600">
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@fbv.co.ke" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-600">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectCls}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {role === 'Driver' ? (
            <label className="flex flex-col gap-1 text-[13px] text-ink-600">
              Linked driver *
              <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={selectCls}>
                <option value="">— pick a driver —</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-[13px] text-ink-600">
              Full name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. W. Kariuki" className={inputCls} />
            </label>
          )}
        </div>
        <div className="rounded-lg border border-border bg-surface-muted/60 p-3">
          <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-400">What a {role} can do</div>
          <AnimatePresence mode="wait">
            <motion.ul key={role} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
              className="flex flex-col gap-1 text-[12px] text-ink-600">
              {permPreview.map((p) => (
                <li key={p} className="flex items-center gap-1.5"><Check size={12} className="text-ok" /> {p}</li>
              ))}
              {DEFAULT_MATRIX[role].clear_all_data === 'no' && (
                <li className="flex items-center gap-1.5 text-ink-400"><Minus size={12} /> No clear-all-data</li>
              )}
            </motion.ul>
          </AnimatePresence>
        </div>
      </div>
    </Modal>
  );
}
