// Focused checks for the replay derivation engine against the seeded dataset.
import { describe, expect, it } from 'vitest';
import { seedCollections } from '@/lib/seed';
import {
  buildDayReplay, humanizeMin, isoToDaySec, parkedAt, pointInGeofence,
  sampleTripAt, secToHHMMSS,
} from './replay';

const data = seedCollections();

function vehicleDayWithTrips() {
  // find the (vehicle, date) pair with the most seeded trips
  let best: { veh: string; date: string; n: number } = { veh: '', date: '', n: 0 };
  for (const v of data.vehicles) {
    const byDate = new Map<string, number>();
    for (const t of data.trips) {
      if (t.vehicleId !== v.id) continue;
      const d = t.startAt.slice(0, 10);
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    for (const [date, n] of byDate) if (n > best.n) best = { veh: v.id, date, n };
  }
  return best;
}

describe('replay engine (seed-derived)', () => {
  const { veh, date, n } = vehicleDayWithTrips();
  const vehicle = data.vehicles.find((v) => v.id === veh)!;
  const day = buildDayReplay(vehicle, date, data.trips, data.safetyEvents, data.geofences);

  it('builds a replay for every seeded trip of the day', () => {
    expect(n).toBeGreaterThan(0);
    expect(day.trips.length).toBe(n);
    expect(day.loggedPoints).toBeGreaterThan(day.trips.length * 2);
  });

  it('produces finite, time-ordered points within each trip window', () => {
    for (const r of day.trips) {
      expect(r.tEnd).toBeGreaterThan(r.tStart);
      for (const p of r.points) {
        expect(Number.isFinite(p.lat)).toBe(true);
        expect(Number.isFinite(p.lng)).toBe(true);
        expect(Number.isFinite(p.tSec)).toBe(true);
        expect(Number.isFinite(p.speedKmh)).toBe(true);
      }
      for (let i = 1; i < r.points.length; i++) {
        expect(r.points[i].tSec).toBeGreaterThanOrEqual(r.points[i - 1].tSec);
      }
      expect(r.points[0].tSec).toBeCloseTo(r.tStart, 0);
      expect(r.points[r.points.length - 1].tSec).toBeCloseTo(r.tEnd, 0);
    }
  });

  it('interpolates playback positions and parks between trips', () => {
    const r = day.trips[0];
    const mid = sampleTripAt(r, (r.tStart + r.tEnd) / 2);
    expect(mid).not.toBeNull();
    expect(mid!.lat).toBeGreaterThan(-5);
    expect(mid!.lat).toBeLessThan(1);
    expect(sampleTripAt(r, r.tStart - 10)).toBeNull();
    const parked = parkedAt(day, day.windowStart + 1);
    expect(parked).not.toBeNull();
    expect(parked!.speedKmh).toBe(0);
  });

  it('aggregates day stats consistent with trip stats', () => {
    const km = day.trips.reduce((s, r) => s + r.stats.distanceKm, 0);
    expect(day.dayStats.distanceKm).toBeCloseTo(km, 6);
    expect(day.dayStats.maxSpeedKmh).toBeGreaterThan(0);
    expect(day.events.length).toBeGreaterThanOrEqual(day.trips.length * 2);
  });

  it('formats clocks and durations', () => {
    expect(secToHHMMSS(14 * 3600 + 22 * 60 + 31)).toBe('14:22:31');
    expect(humanizeMin(41)).toBe('41 min');
    expect(humanizeMin(312)).toBe('5 h 12 m');
  });

  it('detects geofence containment (FBV Depot circle)', () => {
    const depot = data.geofences.find((g) => g.id === 'gf-01')!;
    expect(pointInGeofence(-1.3031, 36.8526, depot)).toBe(true);
    expect(pointInGeofence(-1.2921, 36.8219, depot)).toBe(false);
    const westlands = data.geofences.find((g) => g.id === 'gf-05')!;
    expect(pointInGeofence(-1.2635, 36.8029, westlands)).toBe(true);
    expect(pointInGeofence(-1.30, 36.85, westlands)).toBe(false);
  });

  it('reads EAT wall-clock seconds from UTC-shifted ISO', () => {
    expect(isoToDaySec('2026-07-28T06:12:00.000Z')).toBe(6 * 3600 + 12 * 60);
  });

  it('is deterministic for the same vehicle+date', () => {
    const again = buildDayReplay(vehicle, date, data.trips, data.safetyEvents, data.geofences);
    expect(again.loggedPoints).toBe(day.loggedPoints);
    expect(again.trips[0].path.length).toBe(day.trips[0].path.length);
  });
});
