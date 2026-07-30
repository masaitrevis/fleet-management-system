// FBV FleetOS — topbar (design.md §5.2): 56px, breadcrumb, ⌘K search,
// live EAT clock, env pill, alerts bell, avatar menu.
// `overlay` = translucent navy glass over the map dashboard.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, ChevronRight, LogOut, Menu, Search, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCollection } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { avatarTint, initials } from '@/lib/format';

export const ROUTE_TITLES: [RegExp, string][] = [
  [/^\/$/, 'Live Operations Dashboard'],
  [/^\/tracking/, 'Live Tracking & Route Replay'],
  [/^\/geofences/, 'Geofences'],
  [/^\/drivers\/[^/]+/, 'Driver 360°'],
  [/^\/drivers/, 'Drivers'],
  [/^\/safety/, 'Safety Events'],
  [/^\/rewards/, 'Driver Rewards'],
  [/^\/dvir/, 'Vehicle Inspections (DVIR)'],
  [/^\/shifts/, 'Shifts & Driving Hours'],
  [/^\/documents/, 'Document Vault'],
  [/^\/maintenance\/schedules/, 'Preventive Schedules'],
  [/^\/maintenance\/parts/, 'Parts & Vendors'],
  [/^\/maintenance/, 'Work Orders'],
  [/^\/vehicles\/[^/]+/, 'Vehicle 360°'],
  [/^\/vehicles/, 'Vehicles'],
  [/^\/fuel\/analytics/, 'Fuel Analytics'],
  [/^\/fuel/, 'Fuel Management'],
  [/^\/trips/, 'Trips'],
  [/^\/dispatch\/[^/]+/, 'Job Detail'],
  [/^\/dispatch/, 'Dispatch'],
  [/^\/assets/, 'Assets & Equipment'],
  [/^\/alerts/, 'Alert Center'],
  [/^\/reports/, 'Reports'],
  [/^\/analytics/, 'Analytics'],
  [/^\/admin\/users/, 'Users & Roles'],
  [/^\/admin\/audit/, 'Audit Trail'],
  [/^\/admin\/bulk-upload/, 'Bulk Upload'],
  [/^\/settings/, 'Settings'],
];

export function pageTitle(pathname: string): string {
  for (const [re, t] of ROUTE_TITLES) if (re.test(pathname)) return t;
  return 'FleetOS';
}

/* live EAT clock */
function useEatClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return `${parts} EAT`;
}

interface SearchHit {
  group: string;
  label: string;
  mono?: string;
  to: string;
}

function CommandSearch({ dark }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const vehicles = useCollection('vehicles');
  const drivers = useCollection('drivers');
  const jobs = useCollection('jobs');
  const workOrders = useCollection('workOrders');

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const hits = useMemo<SearchHit[]>(() => {
    if (!q.trim()) return [];
    const needle = q.toLowerCase();
    const out: SearchHit[] = [];
    const pages: [string, string][] = [
      ['Dashboard', '/'], ['Live Tracking', '/tracking'], ['Trips', '/trips'], ['Dispatch', '/dispatch'],
      ['Geofences', '/geofences'], ['Drivers', '/drivers'], ['Safety', '/safety'], ['Rewards', '/rewards'],
      ['DVIR', '/dvir'], ['Shifts', '/shifts'], ['Vehicles', '/vehicles'], ['Maintenance', '/maintenance'],
      ['Fuel', '/fuel'], ['Documents', '/documents'], ['Assets', '/assets'], ['Alerts', '/alerts'],
      ['Reports', '/reports'], ['Analytics', '/analytics'], ['Settings', '/settings'],
    ];
    pages.filter(([l]) => l.toLowerCase().includes(needle)).slice(0, 4)
      .forEach(([l, to]) => out.push({ group: 'Pages', label: l, to }));
    vehicles.filter((v) => v.plate.toLowerCase().includes(needle) || v.model.toLowerCase().includes(needle)).slice(0, 4)
      .forEach((v) => out.push({ group: 'Vehicles', label: v.model, mono: v.plate, to: `/vehicles/${v.id}` }));
    drivers.filter((d) => d.name.toLowerCase().includes(needle)).slice(0, 3)
      .forEach((d) => out.push({ group: 'Drivers', label: d.name, mono: d.licenseNo, to: `/drivers/${d.id}` }));
    jobs.filter((j) => j.number.toLowerCase().includes(needle) || j.customer.toLowerCase().includes(needle)).slice(0, 3)
      .forEach((j) => out.push({ group: 'Jobs', label: j.customer, mono: j.number, to: `/dispatch/${j.id}` }));
    workOrders.filter((w) => w.number.toLowerCase().includes(needle) || w.title.toLowerCase().includes(needle)).slice(0, 3)
      .forEach((w) => out.push({ group: 'Work Orders', label: w.title, mono: w.number, to: '/maintenance' }));
    return out;
  }, [q, vehicles, drivers, jobs, workOrders]);

  const groups = useMemo(() => {
    const g = new Map<string, SearchHit[]>();
    hits.forEach((h) => { const arr = g.get(h.group) ?? []; arr.push(h); g.set(h.group, arr); });
    return g;
  }, [hits]);

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <button type="button" onClick={() => setOpen(true)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors',
          dark
            ? 'border-navy-700 bg-navy-900/50 text-navy-100/70 hover:border-accent-on-navy/50'
            : 'border-border bg-surface-muted text-ink-400 hover:border-ink-400/50',
        )}>
        <Search size={15} />
        <span className="flex-1 text-left">Search plates, drivers, jobs…</span>
        <kbd className={cn('rounded border px-1 font-mono text-[10px]', dark ? 'border-navy-700 text-navy-100/60' : 'border-border text-ink-400')}>⌘K</kbd>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[800] bg-navy-950/30" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-2 z-[801] w-[min(92vw,480px)] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-white shadow-pop">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search size={15} className="text-ink-400" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to vehicle, driver, job, work order, page…"
                className="h-11 flex-1 bg-transparent text-[14px] text-ink-900 outline-none placeholder:text-ink-400" />
              <kbd className="rounded border border-border px-1 font-mono text-[10px] text-ink-400">ESC</kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto py-1">
              {q && hits.length === 0 && <div className="px-4 py-6 text-center text-[13px] text-ink-400">No matches for “{q}”</div>}
              {Array.from(groups.entries()).map(([group, items]) => (
                <div key={group}>
                  <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{group}</div>
                  {items.map((h, i) => (
                    <button key={`${h.to}-${i}`} type="button"
                      onClick={() => { setOpen(false); setQ(''); navigate(h.to); }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-surface-muted">
                      <span className="flex-1 text-[13px] font-medium text-ink-900">{h.label}</span>
                      {h.mono && <span className="font-mono text-[12px] text-ink-400">{h.mono}</span>}
                      <ChevronRight size={13} className="text-ink-400" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Topbar({ overlay, onMenu }: { overlay?: boolean; onMenu: () => void }) {
  const clock = useEatClock();
  const location = useLocation();
  const alerts = useCollection('alerts');
  const users = useCollection('users');
  const { user: authUser, logout } = useAuth();
  const me = users[0];
  const displayName = authUser?.name ?? me?.name ?? 'Fleet User';
  const displayRole = authUser?.role === 'admin' ? 'Admin' : (me?.role ?? 'User');
  const displayEmail = authUser?.email ?? me?.email ?? '';
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = alerts.filter((a) => !a.read).length;
  const title = pageTitle(location.pathname);

  return (
    <header className={cn(
      'relative z-[700] flex h-14 shrink-0 items-center gap-3 px-4',
      overlay
        ? 'glass-navy border-b border-navy-700/60 text-white'
        : 'border-b border-border bg-white text-ink-900',
    )}>
      <button type="button" onClick={onMenu} aria-label="Menu"
        className={cn('flex h-9 w-9 items-center justify-center rounded-lg lg:hidden',
          overlay ? 'text-navy-100 hover:bg-navy-800' : 'text-ink-600 hover:bg-surface-muted')}>
        <Menu size={18} />
      </button>

      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('hidden text-[12px] font-medium sm:block', overlay ? 'text-navy-100/60' : 'text-ink-400')}>FBV</span>
        <ChevronRight size={12} className={cn('hidden sm:block', overlay ? 'text-navy-100/40' : 'text-ink-400/60')} />
        <h1 className="truncate text-[15px] font-bold leading-6 tracking-[-0.01em] sm:text-[17px]">{title}</h1>
        <span className={cn('ml-2 hidden font-mono text-[12px] font-medium tracking-[0.02em] md:block', overlay ? 'text-accent-on-navy' : 'text-ink-600')}>
          {clock}
        </span>
      </div>

      <div className="hidden flex-1 justify-center px-4 sm:flex">
        <CommandSearch dark={overlay} />
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className={cn(
          'hidden rounded-full border px-2.5 py-1 text-micro font-medium lg:inline-block',
          overlay ? 'border-navy-700 bg-navy-800/60 text-navy-100' : 'border-border bg-surface-muted text-ink-600',
        )}>
          Demo data · Nairobi
        </span>

        <Link to="/alerts" className={cn('relative flex h-9 w-9 items-center justify-center rounded-lg',
          overlay ? 'text-navy-100 hover:bg-navy-800' : 'text-ink-600 hover:bg-surface-muted')}>
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert px-1 text-[9px] font-bold text-white">
              {unread}
            </span>
          )}
        </Link>

        {(me || authUser) && (
          <div className="relative">
            <button type="button" onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-1.5 rounded-lg p-1 hover:bg-surface-muted/20">
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-full bg-cover text-[12px] font-bold', avatarTint(displayName))}
                style={{ backgroundImage: 'url(/avatar-texture.svg)' }}>
                {initials(displayName)}
              </span>
              <ChevronDown size={13} className={overlay ? 'text-navy-100/70' : 'text-ink-400'} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[790]" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-[791] w-52 overflow-hidden rounded-xl border border-border bg-white py-1 shadow-pop">
                  <div className="border-b border-border px-3 py-2">
                    <div className="text-[13px] font-semibold text-ink-900">{displayName}</div>
                    <div className="text-[11px] text-ink-400">{displayEmail}</div>
                  </div>
                  <Link to="/admin/users" onClick={() => setMenuOpen(false)} className="flex items-center gap-2 px-3 py-2 text-[13px] text-ink-900 hover:bg-surface-muted">
                    <User size={14} className="text-ink-400" /> Profile · {displayRole}
                  </Link>
                  <button type="button" onClick={() => { setMenuOpen(false); logout(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-alert hover:bg-alert-soft/50">
                    <LogOut size={14} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
