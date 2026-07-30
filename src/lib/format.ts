// FBV FleetOS — formatting helpers (KES, EAT dates, metric units) + status maps.

export function fmtKES(n: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && Math.abs(n) >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (opts?.compact && Math.abs(n) >= 100_000) return `KES ${Math.round(n / 1000)}K`;
  return `KES ${Math.round(n).toLocaleString('en-KE')}`;
}

export function fmtNum(n: number, dp = 0): string {
  return n.toLocaleString('en-KE', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtKm(n: number): string {
  return `${fmtNum(Math.round(n))} km`;
}

/** EAT wall-clock from an ISO string. Demo data stores EAT wall time as
 *  UTC-shifted ISO, so we format the UTC components with an EAT suffix. */
export function fmtDateTimeEAT(iso: string, withSeconds = false): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = d.getUTCDate();
  const mon = months[d.getUTCMonth()];
  const yr = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dd} ${mon} ${yr}, ${hh}:${mm}${withSeconds ? `:${ss}` : ''} EAT`;
}

export function fmtTimeEAT(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDateEAT(iso: string): string {
  return fmtDateTimeEAT(iso).split(',')[0];
}

/** Days from TODAY-ish now to an ISO date (positive = future). */
export function daysUntil(isoDate: string): number {
  const now = new Date();
  const target = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export type StatusKey = 'ok' | 'warn' | 'alert' | 'inactive' | 'info';

export const VEHICLE_STATUS_TO_KEY: Record<string, StatusKey> = {
  moving: 'ok', idling: 'warn', stopped: 'inactive', offline: 'alert',
};

export const SEVERITY_TO_KEY: Record<string, StatusKey> = {
  critical: 'alert', major: 'warn', minor: 'info', info: 'inactive',
};

export function scoreColor(score: number): string {
  if (score >= 90) return '#16A34A';
  if (score >= 75) return '#06B6D4';
  if (score >= 60) return '#F59E0B';
  return '#DC2626';
}

export function expiryKey(days: number): StatusKey {
  if (days < 0) return 'alert';
  if (days <= 30) return 'alert';
  if (days <= 90) return 'warn';
  return 'ok';
}

export function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

/** Deterministic avatar tint from a name. */
export function avatarTint(name: string): string {
  const tints = ['bg-accent-soft text-accent-strong', 'bg-navy-50 text-navy-800', 'bg-ok-soft text-ok-on-soft', 'bg-warn-soft text-warn-on-soft'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return tints[h % tints.length];
}
