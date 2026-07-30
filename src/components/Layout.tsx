// FBV FleetOS — authenticated app shell (design.md §5).
// Sidebar 264px (collapses to 72px rail <1280px, off-canvas <1024px)
// + 56px Topbar + <Outlet/> content slot. Nested-route pattern.

import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AppSidebar } from '@/components/AppSidebar';
import { Topbar } from '@/components/Topbar';
import { useAuth } from '@/hooks/useAuth';
import { syncStore } from '@/lib/store';
import { cn } from '@/lib/utils';

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = (e: MediaQueryListEvent) => setMatches(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return matches;
}

export default function Layout() {
  const { user, isLoading } = useAuth({ redirectOnUnauthenticated: true });
  const isNarrow = useMedia('(max-width: 1279px)');   // rail mode
  const isMobile = useMedia('(max-width: 1023px)');   // off-canvas
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const isMapDashboard = location.pathname === '/';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Start server sync once authenticated.
  useEffect(() => { if (user) syncStore(); }, [user]);

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-navy-900">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.svg" alt="FleetOS" className="h-12 w-12 animate-pulse" />
          <div className="text-[13px] text-navy-100">Loading operations console…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-surface-muted">
      {/* sidebar — desktop */}
      {!isMobile && (
        <aside className={cn('h-full shrink-0 transition-[width] duration-200 ease-ops', isNarrow ? 'w-[72px]' : 'w-[264px]')}>
          <AppSidebar collapsed={isNarrow} />
        </aside>
      )}

      {/* sidebar — mobile off-canvas drawer */}
      <AnimatePresence>
        {isMobile && mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }} onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-[850] bg-navy-950/45" />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-0 top-0 z-[851] h-full w-[264px]">
              <AppSidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar overlay={isMapDashboard} onMenu={() => setMobileOpen(true)} />
        <main className={cn('relative min-h-0 flex-1', isMapDashboard ? 'overflow-hidden' : 'overflow-y-auto')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
