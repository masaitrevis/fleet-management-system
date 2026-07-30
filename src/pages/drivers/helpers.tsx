// FBV FleetOS — shared helpers for the drivers/safety/rewards/dvir/shifts pages.
// Design tokens & motion names per design.md §2/§7.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import type { ReactNode } from 'react';
import { avatarTint, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { toast } from '@/components/shared';
import type { Driver, Vehicle } from '@/lib/types';

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ---------------- motion primitives ---------------- */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const h = (e: MediaQueryListEvent) => setReduced(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return reduced;
}

/** page-enter: opacity 0→1, y 8→0, 300ms ops-ease; children stagger 0.05s. */
export function PageEnter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn('mx-auto max-w-[1520px] p-6 max-lg:p-4', className)}
    >
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        className="flex flex-col gap-4"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function PageSection({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Re-render on an interval (live timers). */
export function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => v + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = (e: MediaQueryListEvent) => setMatches(e.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return matches;
}

/* ---------------- identity ---------------- */

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      className={cn('flex shrink-0 items-center justify-center rounded-full font-bold', avatarTint(name), className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}
    >
      {initials(name)}
    </span>
  );
}

/** drv-07 → FBV-DRV-0007 (display identifier, design.md §9). */
export function driverDisplayId(driver: Driver): string {
  const n = Number(driver.id.replace(/\D/g, '')) || 0;
  return `FBV-DRV-${String(n).padStart(4, '0')}`;
}

export function vehicleOf(vehicles: Vehicle[], driverId: string): Vehicle | undefined {
  return vehicles.find((v) => v.assignedDriverId === driverId);
}

/** Unique id for new records (module-scope — safe to call from handlers). */
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(uidCounter++).toString(36)}`;
}
let uidCounter = 0;

/** Current time as ISO (module-scope — safe to call from handlers). */
export function nowIso(): string {
  return new Date().toISOString();
}

/* ---------------- deterministic pseudo-random (derived from seeded entities) ---------------- */

export function hash01(key: string): number {
  let h = 2166136261;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/* ---------------- formatting ---------------- */

export function fmtMin(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h} h ${String(r).padStart(2, '0')} m` : `${r} m`;
}

export function fmtDurShort(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
}

/** Days left pill label for expiries. */
export function daysLeftLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} d overdue`;
  if (days === 0) return 'Expires today';
  return `${days} d left`;
}

/* ---------------- medals (rewards.md / drivers.md) ---------------- */

export const MEDAL = {
  gold: { hex: '#D4A017', soft: '#FFF8E1', label: '1st' },
  silver: { hex: '#9AA5B1', soft: '#F4F6F8', label: '2nd' },
  bronze: { hex: '#B0793C', soft: '#FBF1E7', label: '3rd' },
} as const;

export function medalFor(rank: number): { hex: string; soft: string; label: string } | null {
  if (rank === 1) return MEDAL.gold;
  if (rank === 2) return MEDAL.silver;
  if (rank === 3) return MEDAL.bronze;
  return null;
}

/* ---------------- excel export ---------------- */

export function exportXlsx(filename: string, rows: Record<string, unknown>[], sheetName = 'Sheet1'): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
  toast({ title: 'Export ready', body: filename, status: 'ok' });
}
