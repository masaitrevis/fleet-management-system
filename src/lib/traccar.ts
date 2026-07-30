// FBV FleetOS — Traccar real-GPS client sync.
// Polls api.telematics.positions every 5s and merges real fixes into the
// SAME useLiveStore the simulator writes to, so FleetMap / Dashboard / the
// fleet rail need zero changes. Real positions REPLACE sim positions for
// mapped vehicleIds (see mergeTraccarPositions, applied on every sim tick).
// When Traccar is unconfigured/unreachable we back off to a 30s retry and
// keep sim data — one console note, no spam, no UI breakage.

import { api } from './api';
import { useLiveStore } from './store';
import type { LivePosition } from './types';

const POLL_MS = 5000;
const RETRY_MS = 30000;

/** Last real fixes received from the server, keyed by vehicleId. */
const traccarPositions = new Map<string, LivePosition>();

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let notedError = false;

/** Overlay real fixes on a positions map (sim tick or local merge). */
export function mergeTraccarPositions(positions: Map<string, LivePosition>): Map<string, LivePosition> {
  if (traccarPositions.size === 0) return positions;
  const merged = new Map(positions);
  traccarPositions.forEach((p, id) => merged.set(id, p));
  return merged;
}

function schedule(ms: number) {
  if (!running) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void poll(), ms);
}

async function poll(): Promise<void> {
  if (!running) return;
  try {
    const rows = await api.telematics.positions.query();
    traccarPositions.clear();
    for (const p of rows) traccarPositions.set(p.vehicleId, p);
    useLiveStore.setState((s) => ({ positions: mergeTraccarPositions(s.positions) }));
    if (notedError) {
      console.info('[traccar] real-GPS sync restored');
      notedError = false;
    }
    schedule(POLL_MS);
  } catch {
    // Traccar unconfigured/down or signed out — keep simulator data.
    if (!notedError) {
      console.warn('[traccar] real-GPS positions unavailable — vehicles stay simulated (retrying every 30s)');
      notedError = true;
    }
    schedule(RETRY_MS);
  }
}

/** Start syncing real GPS fixes (idempotent). Called from startSim(). */
export function startTraccarSync(): void {
  if (running) return;
  running = true;
  void poll();
}

/** Stop syncing; sim positions take over again on the next sim tick. */
export function stopTraccarSync(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  traccarPositions.clear();
}
