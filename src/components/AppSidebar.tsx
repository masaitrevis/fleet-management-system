// FBV FleetOS — sidebar (design.md §5.1): navy-900, nav groups, SIM chip, user card.

import { NavLink } from 'react-router-dom';
import {
  BarChart3, Bell, Calendar1, ClipboardCheck, FileText, FileBarChart, Fuel,
  Gauge, LayoutDashboard, MapPinned, Package, Radio, Route, Settings,
  ShieldAlert, Trophy, Truck, Upload, Users, Wrench, Boxes, ScrollText, UserCog,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveStore } from '@/lib/store';
import { useCollection } from '@/lib/store';
import { avatarTint, initials } from '@/lib/format';

interface NavItem { to: string; label: string; icon: LucideIcon }
interface NavGroup { label: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/reports', label: 'Reports', icon: FileBarChart },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/tracking', label: 'Live Tracking', icon: Route },
      { to: '/trips', label: 'Trips', icon: MapPinned },
      { to: '/dispatch', label: 'Dispatch', icon: Package },
      { to: '/geofences', label: 'Geofences', icon: Radio },
      { to: '/assets', label: 'Assets', icon: Boxes },
    ],
  },
  {
    label: 'Safety & Drivers',
    items: [
      { to: '/drivers', label: 'Drivers', icon: Users },
      { to: '/safety', label: 'Safety Events', icon: ShieldAlert },
      { to: '/rewards', label: 'Rewards', icon: Trophy },
      { to: '/dvir', label: 'DVIR', icon: ClipboardCheck },
      { to: '/shifts', label: 'Shifts', icon: Calendar1 },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { to: '/vehicles', label: 'Vehicles', icon: Truck },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench },
      { to: '/fuel', label: 'Fuel', icon: Fuel },
      { to: '/documents', label: 'Documents', icon: FileText },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/alerts', label: 'Alerts', icon: Bell },
      { to: '/admin/users', label: 'Users', icon: UserCog },
      { to: '/admin/audit', label: 'Audit Trail', icon: ScrollText },
      { to: '/admin/bulk-upload', label: 'Bulk Upload', icon: Upload },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function SimChip({ collapsed }: { collapsed: boolean }) {
  const running = useLiveStore((s) => s.running);
  const positions = useLiveStore((s) => s.positions);
  const devices = positions.size || 14;
  if (collapsed) {
    return (
      <div className="flex justify-center py-2" title={`Telematics SIM · 2s tick · ${devices} devices`}>
        <span className="relative flex h-2.5 w-2.5">
          {running && <span className="absolute inline-flex h-full w-full rounded-full bg-accent-on-navy animate-pulse-live-ring" />}
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', running ? 'bg-accent-on-navy' : 'bg-inactive')} />
        </span>
      </div>
    );
  }
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-hairline-dark bg-navy-800/60 px-3 py-2" title="Live data is simulated by the built-in telematics provider">
      <span className="relative flex h-2 w-2 shrink-0">
        {running && <span className="absolute inline-flex h-full w-full rounded-full bg-accent-on-navy animate-pulse-live-ring" />}
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', running ? 'bg-accent-on-navy' : 'bg-inactive')} />
      </span>
      <span className="truncate font-mono text-[11px] font-medium tracking-[0.02em] text-navy-100">
        {running ? `Telematics SIM · 2s tick · ${devices} devices` : 'Telematics SIM · paused'}
      </span>
      <Gauge size={13} className="ml-auto shrink-0 text-navy-100/50" />
    </div>
  );
}

export function AppSidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const users = useCollection('users');
  const me = users[0];
  return (
    <div className="flex h-full flex-col bg-navy-900">
      {/* brand block */}
      <div className={cn('flex h-16 items-center gap-3 border-b border-hairline-dark px-4', collapsed && 'justify-center px-0')}>
        <img src="/logo.svg" alt="FleetOS" className="h-9 w-9 shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold leading-5 text-white">FBV FleetOS</div>
            <div className="truncate text-[11px] leading-4 text-navy-100">Future Bright Ventures</div>
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="mb-4">
            {!collapsed && (
              <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-navy-100/60">{g.label}</div>
            )}
            <div className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) => cn(
                    'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors duration-100',
                    collapsed && 'justify-center px-0',
                    isActive ? 'bg-navy-800 text-white' : 'text-navy-100 hover:bg-navy-800/60 hover:text-white',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-on-navy" />}
                      <item.icon size={18} className="shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* footer: SIM chip + user card */}
      <div className="border-t border-hairline-dark py-2">
        <SimChip collapsed={collapsed} />
        {me && (
          <div className={cn('flex items-center gap-2.5 px-4 py-2', collapsed && 'justify-center px-0')}>
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cover text-[13px] font-bold', avatarTint(me.name))}
              style={{ backgroundImage: 'url(/avatar-texture.svg)' }}>
              {initials(me.name)}
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold leading-4 text-white">{me.name}</div>
                <span className="mt-0.5 inline-block rounded-full bg-navy-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-accent-on-navy">
                  {me.role}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
