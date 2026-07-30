// FBV FleetOS — mobile driver shell (design.md §5.3).
// Slim navy top bar + bottom 4-tab bar with safe-area padding.
// Used by driver-facing pages: /dvir, /dispatch/:id/run, /shifts (mobile view), /driver.

import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Calendar1, ClipboardCheck, Home, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveStore, syncStore } from '@/lib/store';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';
import { pageTitle } from '@/components/Topbar';

const TABS = [
  { to: '/driver', label: 'Home', icon: Home },
  { to: '/dvir', label: 'DVIR', icon: ClipboardCheck },
  { to: '/dispatch', label: 'Jobs', icon: Package },
  { to: '/shifts', label: 'Shifts', icon: Calendar1 },
];

export default function DriverShell() {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  useEffect(() => { if (user) syncStore(); }, [user]);
  if (isLoading || !user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-navy-900">
        <img src="/logo.svg" alt="FleetOS" className="h-10 w-10 animate-pulse" />
      </div>
    );
  }
  const running = useLiveStore((s) => s.running);
  const location = useLocation();
  return (
    <div className="flex h-[100dvh] flex-col bg-surface-muted">
      {/* slim navy top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2.5 bg-navy-900 px-4 text-white">
        <img src="/logo.svg" alt="" className="h-7 w-7" />
        <div className="flex-1 truncate text-[14px] font-bold">{pageTitle(location.pathname)}</div>
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-navy-100/70">
          <span className="relative flex h-1.5 w-1.5">
            {running && <span className="absolute h-full w-full rounded-full bg-accent-on-navy animate-pulse-live-ring" />}
            <span className={cn('relative h-1.5 w-1.5 rounded-full', running ? 'bg-accent-on-navy' : 'bg-inactive')} />
          </span>
          {running ? 'Synced' : 'Offline'}
        </span>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto pb-2">
        <Outlet />
      </main>

      {/* bottom tab bar */}
      <nav className="shrink-0 border-t border-border bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to}
              className={({ isActive }) => cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
                isActive ? 'text-accent-strong' : 'text-ink-400',
              )}>
              <t.icon size={19} strokeWidth={2} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
