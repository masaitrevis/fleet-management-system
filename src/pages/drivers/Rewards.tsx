// FBV FleetOS — /rewards Driver Gamification & Rewards (rewards.md).
// Hero podium band + league table + points/badges + catalog + month history.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck, BedDouble, Crown, FileSpreadsheet, Fuel, Gift, Info, Lock,
  Medal, Smartphone, Trophy, Zap,
} from 'lucide-react';
import { ConfirmDialog, DataTable, toast } from '@/components/shared';
import type { Column } from '@/components/shared';
import { useCollection, useKV, kvSet, add } from '@/lib/store';
import { fmtNum, scoreColor } from '@/lib/format';
import type { Driver } from '@/lib/types';
import { TODAY } from '@/lib/seed';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  Avatar, EASE, PageEnter, PageSection, exportXlsx, hash01, medalFor, nowIso,
  uid, useReducedMotion,
} from './helpers';
import type { Redemption } from './DriverDetail';

const MONTHS = [
  { key: '2026-07', label: 'Jul 2026' },
  { key: '2026-06', label: 'Jun 2026' },
  { key: '2026-05', label: 'May 2026' },
];

interface LeagueRow {
  id: string;
  rank: number;
  driver: Driver;
  score: number;
  trend: 'up' | 'down' | 'flat';
  points: number;
  harshPer1000: number;
  speeding: number;
  distraction: number;
  km: number;
  prize: string;
}

const PRIZES = [
  { prize: 'KES 15,000 + 2,500 pts', medal: '#D4A017' },
  { prize: 'KES 7,500 + 1,500 pts', medal: '#9AA5B1' },
  { prize: 'KES 3,000 + 1,000 pts', medal: '#B0793C' },
];

const CATALOG = [
  { name: 'KES 5,000 fuel voucher', pts: 4000, icon: Fuel },
  { name: 'Extra rest day', pts: 6500, icon: BedDouble },
  { name: 'KES 2,000 airtime', pts: 1800, icon: Smartphone },
  { name: 'FBV branded gear', pts: 900, icon: Gift },
];

const BADGE_WALL = [
  { name: 'Safe July', desc: 'Zero critical events in July', tone: '#16A34A' },
  { name: 'Highway Star', desc: 'Top-3 on a long-haul corridor', tone: '#06B6D4' },
  { name: '500 km Clean', desc: '500 km without a harsh event', tone: '#0F2540' },
  { name: 'Early Bird', desc: 'DVIR completed before 07:00, 5×', tone: '#F59E0B' },
  { name: 'Fuel Miser', desc: 'Best-in-fleet km/L for a month', tone: '#7C3AED' },
  { name: 'Perfect Month', desc: '30 days, zero events', tone: '#DB2777' },
];

export default function Rewards() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const drivers = useCollection('drivers');
  const appUsers = useCollection('users');
  const rewardsCol = useCollection('rewards');
  const safetyEvents = useCollection('safetyEvents');
  const trips = useCollection('trips');
  const redemptions = (useKV('redemptions') as Redemption[] | undefined) ?? [];
  const [month, setMonth] = useState('2026-07');
  const [redeemFor, setRedeemFor] = useState<(typeof CATALOG)[number] | null>(null);

  // Seed two pending requests once so managers see the queue (derived from seeded drivers).
  useEffect(() => {
    if (redemptions.length === 0 && drivers.length >= 4) {
      kvSet('redemptions', [
        { id: 'red-01', driverId: drivers[1].id, driverName: drivers[1].name, item: 'KES 2,000 airtime', pts: 1800, at: '2026-07-26T09:20:00.000Z', status: 'pending' },
        { id: 'red-02', driverId: drivers[3].id, driverName: drivers[3].name, item: 'FBV branded gear', pts: 900, at: '2026-07-27T15:05:00.000Z', status: 'pending' },
      ] satisfies Redemption[]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drivers.length]);

  const league = useMemo<LeagueRow[]>(() => {
    const monthStart = new Date(`${month}-01T00:00:00Z`).getTime();
    const monthEnd = month === '2026-07' ? new Date(`${TODAY}T23:59:59Z`).getTime() : monthStart + 31 * 86400000;
    const rows = drivers.map((d) => {
      // July uses the seeded standings; prior months derive deterministically from seeded drivers.
      const seeded = month === '2026-07' ? rewardsCol.find((r) => r.driverId === d.id && r.month === month) : undefined;
      const h = hash01(`${d.id}-${month}`);
      const score = month === '2026-07'
        ? d.safetyScore
        : Math.max(52, Math.min(99, d.safetyScore + (h - 0.5) * 10));
      const points = seeded?.points ?? Math.round(d.rewardPoints * (0.55 + h * 0.5));
      const trend = seeded?.trend ?? (h > 0.6 ? 'up' : h < 0.35 ? 'down' : 'flat');
      const evs = safetyEvents.filter((e) => {
        const t = new Date(e.at).getTime();
        return e.driverId === d.id && t >= monthStart && t <= monthEnd;
      });
      const km = trips.filter((t) => {
        const x = new Date(t.startAt).getTime();
        return t.driverId === d.id && x >= monthStart && x <= monthEnd;
      }).reduce((s, t) => s + t.distanceKm, 0);
      return {
        id: d.id, rank: 0, driver: d, score: Number(score.toFixed(1)), trend, points,
        harshPer1000: km > 0 ? Number(((evs.length / km) * 1000).toFixed(2)) : evs.length,
        speeding: evs.filter((e) => e.type === 'speeding').length,
        distraction: evs.filter((e) => e.type === 'distraction').length,
        km,
        prize: '',
      };
    });
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.rank = i + 1; r.prize = i < 3 ? PRIZES[i].prize : '—'; });
    return rows;
  }, [drivers, rewardsCol, safetyEvents, trips, month]);

  const fleetAvg = league.length > 0 ? league.reduce((s, r) => s + r.score, 0) / league.length : 0;
  const top3 = league.slice(0, 3);
  // Session auth role is generic (admin/user); fleet role comes from the users collection.
  const fleetRole = appUsers.find((u) => u.name === user?.name)?.role ?? 'Fleet Manager';
  const isDriverRole = fleetRole === 'Driver';
  const pending = redemptions.filter((r) => r.status === 'pending');

  const exportLeague = () => exportXlsx(
    `safety-league-${month}.xlsx`,
    league.map((r) => ({
      Rank: r.rank, Driver: r.driver.name, Score: r.score, 'Trend vs prev': r.trend,
      'Harsh /1000km': r.harshPer1000, Speeding: r.speeding, Distraction: r.distraction,
      'km driven': Math.round(r.km), Points: r.points, 'Projected prize': r.prize,
    })),
    'League',
  );

  const columns: Column<LeagueRow>[] = [
    {
      key: 'rank', header: 'Rank', width: '80px',
      render: (r) => {
        const m = medalFor(r.rank);
        return (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-[13px] font-bold" style={{ color: m?.hex ?? '#46586D' }}>#{r.rank}</span>
            {m && <Medal size={14} style={{ color: m.hex }} />}
          </span>
        );
      },
    },
    {
      key: 'driver', header: 'Driver',
      render: (r) => (
        <span className="flex items-center gap-2.5 py-0.5">
          <Avatar name={r.driver.name} size={30} />
          <span className="text-[13px] font-semibold text-ink-900">{r.driver.name}</span>
        </span>
      ),
    },
    {
      key: 'score', header: 'Score', width: '90px',
      render: (r) => (
        <span className="rounded-full px-2 py-0.5 font-mono text-[12px] font-bold"
          style={{ background: `${scoreColor(r.score)}1F`, color: scoreColor(r.score) }}>
          {r.score.toFixed(1)}
        </span>
      ),
    },
    {
      key: 'delta', header: 'Δ vs prev', width: '80px',
      render: (r) => (
        <span className={cn('font-mono text-[12px] font-semibold',
          r.trend === 'up' ? 'text-ok-on-soft' : r.trend === 'down' ? 'text-alert-on-soft' : 'text-ink-400')}>
          {r.trend === 'up' ? '▲' : r.trend === 'down' ? '▼' : '—'}
        </span>
      ),
    },
    { key: 'harsh', header: 'Harsh /1,000 km', mono: true, align: 'right', width: '120px', render: (r) => r.harshPer1000.toFixed(2) },
    { key: 'speed', header: 'Speeding', mono: true, align: 'right', width: '80px', render: (r) => r.speeding },
    { key: 'distr', header: 'Distraction', mono: true, align: 'right', width: '90px', render: (r) => r.distraction },
    { key: 'km', header: 'km driven', mono: true, align: 'right', width: '100px', render: (r) => fmtNum(Math.round(r.km)) },
    { key: 'pts', header: 'Points', mono: true, align: 'right', width: '90px', render: (r) => <span className="font-bold text-accent-strong">{fmtNum(r.points)}</span> },
    { key: 'prize', header: 'Projected prize', width: '170px', render: (r) => <span className="text-[12px] text-ink-600">{r.prize}</span> },
  ];

  return (
    <PageEnter>
      <PageSection className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.015em] text-ink-900">Rewards</h1>
          <p className="text-[13px] text-ink-400">Monthly safety league, points, badges & Driver of the Month</p>
        </div>
        <button type="button" onClick={exportLeague}
          className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-[13px] font-medium text-ink-600 shadow-card hover:bg-surface-muted">
          <FileSpreadsheet size={15} /> Export league →
        </button>
      </PageSection>

      {/* month history strip */}
      <PageSection className="flex items-center gap-2">
        {MONTHS.map((m) => (
          <button key={m.key} type="button" onClick={() => setMonth(m.key)}
            className={cn('rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
              month === m.key ? 'bg-navy-900 text-white' : 'border border-border bg-white text-ink-600 hover:bg-surface-muted')}>
            {m.label}
          </button>
        ))}
      </PageSection>

      <AnimatePresence mode="wait">
        <motion.div key={month}
          initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="flex flex-col gap-4">

          {/* hero band */}
          <HeroBand rows={top3} monthLabel={MONTHS.find((m) => m.key === month)!.label} month={month} />

          {/* league table */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[18px] font-bold leading-[26px] tracking-[-0.01em] text-ink-900">
                {MONTHS.find((m) => m.key === month)!.label} Safety League
              </h2>
            </div>
            <DataTable
              columns={columns}
              rows={league.map((r) => ({ ...r }))}
              pageSize={10}
              onRowClick={(r) => navigate(`/drivers/${r.driver.id}?tab=rewards`)}
              empty={<div className="py-6 text-center text-[13px] text-ink-400">No standings for this month.</div>}
            />
            <div className="mt-2 flex items-center gap-2 rounded-card border border-border bg-white px-4 py-2.5 text-[13px] shadow-card">
              <Info size={14} className="text-accent-strong" />
              <span className="text-ink-600">
                Fleet average <b className="font-mono text-ink-900">{fleetAvg.toFixed(1)}</b>
                {month === '2026-07' ? <> <span className="text-ok-on-soft">▲ 1.8 vs June</span> — best month on record.</> : ' for the month.'}
              </span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* points & badges */}
      <PageSection className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <div className="rounded-card border border-border bg-white p-5 shadow-card">
          <h3 className="mb-3 text-[15px] font-semibold text-ink-900">How points work</h3>
          <div className="flex flex-col gap-2.5">
            {[
              { pts: '+10', rule: 'Per event-free day' },
              { pts: '+50', rule: 'Weekly score ≥ 90' },
              { pts: '+200', rule: 'Monthly top-3 finish' },
              { pts: '−15', rule: 'Per major event' },
              { pts: '−40', rule: 'Per critical event' },
            ].map((r) => (
              <div key={r.rule} className="flex items-center gap-3">
                <span className={cn('w-14 rounded-full px-2 py-0.5 text-center font-mono text-[12px] font-bold',
                  r.pts.startsWith('+') ? 'bg-accent-soft text-accent-strong' : 'bg-alert-soft text-alert-on-soft')}>
                  {r.pts}
                </span>
                <span className="text-[13px] text-ink-900">{r.rule}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-micro text-ink-400">Points reset yearly · redeem anytime from the catalog below.</p>
        </div>

        <div className="rounded-card border border-border bg-white p-5 shadow-card">
          <h3 className="mb-3 text-[15px] font-semibold text-ink-900">Badge wall</h3>
          <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-2">
            {BADGE_WALL.map((b, i) => {
              const earnedBy = drivers.filter((d) => d.badges.includes(b.name));
              const earned = earnedBy.length > 0;
              return (
                <motion.div key={b.name}
                  initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.3, delay: i * 0.03, ease: EASE }}
                  whileHover={{ rotate: 3 }}
                  title={earned ? `${b.desc} — earned by ${earnedBy.map((d) => d.name.split(' ')[0]).join(', ')}` : `Locked — ${b.desc}`}
                  className={cn('flex flex-col items-center gap-1.5 rounded-card border p-3 text-center',
                    earned ? 'border-border bg-surface-muted/40' : 'border-dashed border-border')}>
                  <motion.span
                    animate={earned ? { boxShadow: ['0 0 0 0 rgba(6,182,212,0)', '0 0 14px 2px rgba(6,182,212,.25)', '0 0 0 0 rgba(6,182,212,0)'] } : {}}
                    transition={earned ? { duration: 3, repeat: Infinity } : {}}
                    className="flex h-[88px] w-[88px] items-center justify-center"
                    style={{
                      clipPath: 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                      background: earned ? b.tone : '#64748B',
                      opacity: earned ? 1 : 0.4,
                    }}>
                    {earned ? <BadgeCheck size={30} className="text-white" /> : <Lock size={24} className="text-white" />}
                  </motion.span>
                  <span className="text-[12px] font-semibold text-ink-900">{b.name}</span>
                  <span className="text-micro text-ink-400">{earned ? `${earnedBy.length} driver${earnedBy.length === 1 ? '' : 's'}` : 'Locked'}</span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </PageSection>

      {/* catalog */}
      <PageSection>
        <div className="rounded-card border border-border bg-white p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-ink-900">Rewards catalog</h3>
            {!isDriverRole && pending.length > 0 && (
              <span className="rounded-full bg-warn-soft px-2.5 py-1 text-micro font-semibold text-warn-on-soft">
                {pending.length} pending request{pending.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
            {CATALOG.map((c) => (
              <div key={c.name}
                className="flex flex-col gap-2 rounded-card border border-border bg-white p-4 shadow-card transition-all duration-150 ease-ops hover:-translate-y-0.5 hover:shadow-pop">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                  <c.icon size={18} />
                </span>
                <span className="text-[14px] font-semibold text-ink-900">{c.name}</span>
                <span className="font-mono text-[12px] font-bold text-accent-strong">{fmtNum(c.pts)} pts</span>
                {isDriverRole ? (
                  <button type="button" onClick={() => setRedeemFor(c)}
                    className="mt-auto h-9 rounded-lg bg-accent text-[13px] font-semibold text-navy-950 transition-all hover:bg-accent-strong active:scale-[0.97]">
                    Redeem
                  </button>
                ) : (
                  <span className="mt-auto text-micro text-ink-400">Drivers redeem from the mobile app</span>
                )}
              </div>
            ))}
          </div>

          {/* manager approval queue */}
          {!isDriverRole && pending.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <h4 className="mb-2 text-[13px] font-semibold text-ink-900">Redemption requests</h4>
              <div className="flex flex-col gap-1.5">
                {pending.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <Avatar name={r.driverName} size={26} />
                    <span className="text-[13px] font-semibold text-ink-900">{r.driverName}</span>
                    <span className="text-[13px] text-ink-600">{r.item}</span>
                    <span className="font-mono text-[12px] text-accent-strong">{fmtNum(r.pts)} pts</span>
                    <span className="font-mono text-[11px] text-ink-400">{r.at.slice(0, 10)}</span>
                    <div className="ml-auto flex gap-1.5">
                      <button type="button"
                        onClick={() => {
                          kvSet('redemptions', redemptions.map((x) => x.id === r.id ? { ...x, status: 'approved' as const } : x));
                          add('audit', {
                            id: uid('aud'), at: nowIso(),
                            userId: String(user?.id ?? 'usr-02'), userName: user?.name ?? 'Wanjiru Maina', action: 'update',
                            collection: 'rewards', recordId: r.id,
                            summary: `Redemption approved — ${r.item} · ${r.driverName}`,
                          });
                          toast({ title: 'Redemption approved', body: `${r.item} → ${r.driverName}`, status: 'ok' });
                        }}
                        className="h-8 rounded-lg bg-ok px-3 text-[12px] font-semibold text-white hover:bg-ok-on-soft">
                        Approve
                      </button>
                      <button type="button"
                        onClick={() => {
                          kvSet('redemptions', redemptions.map((x) => x.id === r.id ? { ...x, status: 'declined' as const } : x));
                          toast({ title: 'Redemption declined', body: 'Driver notified in-app.', status: 'warn' });
                        }}
                        className="h-8 rounded-lg border border-border px-3 text-[12px] font-medium text-ink-600 hover:bg-surface-muted">
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PageSection>

      <ConfirmDialog
        open={!!redeemFor}
        onClose={() => setRedeemFor(null)}
        onConfirm={() => {
          if (!redeemFor) return;
          const me = drivers.find((d) => d.name === user?.name) ?? drivers[0];
          if (!me || me.rewardPoints < redeemFor.pts) {
            toast({ title: 'Insufficient points', body: `Need ${fmtNum(redeemFor.pts)} pts.`, status: 'alert' });
            return;
          }
          kvSet('redemptions', [...redemptions, {
            id: uid('red'), driverId: me.id, driverName: me.name,
            item: redeemFor.name, pts: redeemFor.pts, at: nowIso(), status: 'pending',
          } satisfies Redemption]);
          add('audit', {
            id: uid('aud'), at: nowIso(),
            userId: String(user?.id ?? 'usr-05'), userName: user?.name ?? me.name, action: 'create',
            collection: 'rewards', recordId: me.id,
            summary: `Redemption requested — ${redeemFor.name} (${fmtNum(redeemFor.pts)} pts)`,
          });
          toast({ title: 'Redemption requested', body: 'A manager will approve shortly. Logged to audit trail.', status: 'ok' });
        }}
        title="Redeem reward"
        body={redeemFor ? `Redeem “${redeemFor.name}” for ${fmtNum(redeemFor.pts)} points? Points are deducted on approval.` : ''}
        confirmLabel="Redeem"
      />
    </PageEnter>
  );
}

/* ---------------- hero band with podium + confetti ---------------- */

function HeroBand({ rows, monthLabel, month }: { rows: LeagueRow[]; monthLabel: string; month: string }) {
  const reduced = useReducedMotion();
  const [confetti, setConfetti] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || reduced || rows.length === 0) return;
    firedRef.current = true;
    let seen = false;
    try { seen = sessionStorage.getItem(`fbv-confetti-${month}`) === '1'; } catch { /* ignore */ }
    if (!seen) {
      setConfetti(true);
      try { sessionStorage.setItem(`fbv-confetti-${month}`, '1'); } catch { /* ignore */ }
      const t = setTimeout(() => setConfetti(false), 1400);
      return () => clearTimeout(t);
    }
  }, [rows, reduced, month]);

  const winner = rows[0];
  const podiumOrder = [rows[1], rows[0], rows[2]].filter(Boolean);
  const heights = [88, 128, 72];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="relative overflow-hidden rounded-drawer bg-navy-900 p-8 text-white shadow-card"
    >
      <img src="/login-texture.svg" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30" />
      {/* confetti burst */}
      {confetti && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {Array.from({ length: 36 }).map((_, i) => {
            const h = hash01(`conf-${i}`);
            const colors = ['#06B6D4', '#22D3EE', '#D4A017', '#FFFFFF'];
            return (
              <motion.span key={i}
                initial={{ x: '50vw', y: 140, opacity: 1, rotate: 0 }}
                animate={{
                  x: `${10 + h * 80}vw`,
                  y: 40 + hash01(`conf-y-${i}`) * 260,
                  opacity: 0,
                  rotate: 360 + h * 360,
                }}
                transition={{ duration: 0.8 + h * 0.4, ease: 'easeOut' }}
                className="absolute h-2 w-1.5 rounded-sm"
                style={{ background: colors[i % colors.length], left: 0, top: 0 }}
              />
            );
          })}
        </div>
      )}

      <div className="relative flex flex-wrap items-center justify-between gap-8">
        <div className="min-w-[260px]">
          <div className="flex items-center gap-2">
            <Trophy size={40} className="text-accent-on-navy" />
          </div>
          <div className="mt-3 font-mono text-micro font-semibold uppercase tracking-[0.12em] text-accent-on-navy">
            Driver of the month · {monthLabel}
          </div>
          {winner && (
            <>
              <div className="mt-1 text-[34px] font-extrabold leading-10 tracking-[-0.02em] text-white">
                {winner.driver.name}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-navy-100">
                <span>{winner.score.toFixed(1)} score</span>
                <span>{winner.speeding + winner.distraction === 0 ? '0 harsh events' : `${winner.speeding + winner.distraction} flagged events`}</span>
                <span>{fmtNum(Math.round(winner.km))} km</span>
                <span>{fmtNum(winner.points)} pts</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {PRIZES.map((p, i) => (
                  <span key={p.prize} className="rounded-full px-2.5 py-1 text-micro font-semibold"
                    style={{ background: `${p.medal}26`, color: p.medal }}>
                    {i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'} · {p.prize}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* podium */}
        <div className="flex items-end gap-4">
          {podiumOrder.map((r, i) => {
            if (!r) return null;
            const m = medalFor(r.rank)!;
            return (
              <div key={r.id} className="group flex flex-col items-center gap-2">
                <motion.div whileHover={{ scale: 1.08 }} className="relative">
                  <Avatar name={r.driver.name} size={48} className="ring-2 ring-white/70 transition-shadow group-hover:ring-accent-on-navy" />
                  <span className="absolute -bottom-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: m.hex }}>
                    {r.rank}
                  </span>
                </motion.div>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: heights[i] }}
                  transition={{ type: 'spring', stiffness: 160, damping: 22, delay: 0.2 + i * 0.12 }}
                  whileHover={{ y: -4 }}
                  className="flex w-24 flex-col items-center justify-start rounded-t-lg pt-2"
                  style={{ background: `linear-gradient(180deg, ${m.hex}33, ${m.hex}0F)`, borderTop: `3px solid ${m.hex}` }}
                >
                  <span className="font-mono text-[26px] font-bold leading-8" style={{ color: m.hex }}>{r.rank}</span>
                </motion.div>
                <div className="text-center">
                  <div className="max-w-[96px] truncate text-[12px] font-semibold text-white">{r.driver.name}</div>
                  <div className="font-mono text-[11px] text-navy-100">{r.score.toFixed(1)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {month !== '2026-07' && (
        <div className="relative mt-4 flex items-center gap-1.5 text-micro text-navy-100/70">
          <Crown size={11} className="text-accent-on-navy" /> Archived month — standings derived from driver history.
        </div>
      )}
      {month === '2026-07' && (
        <div className="relative mt-4 flex items-center gap-1.5 text-micro text-navy-100/70">
          <Zap size={11} className="text-accent-on-navy" /> Live standings — updated from July telematics.
        </div>
      )}
    </motion.div>
  );
}
