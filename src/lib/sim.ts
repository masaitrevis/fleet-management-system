// FBV FleetOS — telematics simulator bootstrap.
// Owns the singleton simulator, wires it into useLiveStore, and turns
// operational events into store alerts/safety events.

import { FleetSimulator, corridorById } from './telematics';
import type { TelematicsEvent } from './telematics';
import { SIM_CONFIGS } from './seed';
import { useLiveStore, add } from './store';
import { mergeTraccarPositions, startTraccarSync, stopTraccarSync } from './traccar';
import type { SafetyEventType } from './types';

export const sim: FleetSimulator = new FleetSimulator(SIM_CONFIGS);

let wired = false;

/** Start the simulator (idempotent). Call once from the app root. */
export function startSim(): void {
  if (!wired) {
    wired = true;
    sim.subscribe((positions) => {
      useLiveStore.setState((s) => ({
        // Real Traccar fixes win over sim positions for mapped vehicles.
        positions: mergeTraccarPositions(positions),
        running: sim.isRunning(),
        trailsVersion: s.trailsVersion + 1,
      }));
    });
    sim.onEvent?.(handleSimEvent);
  }
  sim.start();
  startTraccarSync();
  useLiveStore.setState({ running: true });
}

export function stopSim(): void {
  sim.stop();
  stopTraccarSync();
  useLiveStore.setState({ running: false });
}

let alertCounter = 0;
function handleSimEvent(e: TelematicsEvent) {
  // throttle: live-generated rows at most every ~3 ticks to avoid flooding
  if (e.kind === 'trip_completed') return;
  alertCounter++;
  const vehicle = useLiveStore.getState().positions.get(e.vehicleId);
  const plate = plateOf(e.vehicleId);
  if (e.kind === 'speeding') {
    add('alerts', {
      id: `al-live-${alertCounter}`,
      type: 'speeding', severity: 'critical',
      message: `Speeding ${e.speedKmh} km/h in 80 zone — ${plate}, ${corridorById(e.location).name ?? e.location}`,
      entityRef: { kind: 'vehicle', id: e.vehicleId, label: plate },
      at: e.at, read: false, acknowledged: false,
    });
  } else {
    add('safetyEvents', {
      id: `sev-live-${alertCounter}`,
      type: e.kind as SafetyEventType,
      severity: 'major',
      vehicleId: e.vehicleId,
      driverId: driverOf(e.vehicleId),
      at: e.at,
      location: corridorById(e.location).name ?? e.location,
      speedKmh: vehicle?.speedKmh,
      coachingStatus: 'new',
    });
  }
}

// lazy lookups to avoid circular imports at module init
import { getById } from './store';
function plateOf(vehicleId: string): string {
  return getById('vehicles', vehicleId)?.plate ?? vehicleId;
}
function driverOf(vehicleId: string): string {
  return getById('vehicles', vehicleId)?.assignedDriverId ?? 'drv-01';
}
