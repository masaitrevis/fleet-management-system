// FBV FleetOS — reusable Leaflet map (design.md §8).
// CARTO Positron tiles, chevron-disc vehicle markers with 2s marker-tween,
// trail polylines, geofence overlays, control stack, tile-failure fallback.

import 'leaflet/dist/leaflet.css';
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { Circle, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import type { Geofence, LivePosition, VehicleStatus } from '@/lib/types';
import { MapControls } from '@/components/shared';
import type { MapLayerToggles } from '@/components/shared';
import { PlateTag } from '@/components/shared';
import { NAIROBI_CENTER } from '@/lib/telematics';

export const STATUS_COLOR: Record<VehicleStatus, string> = {
  moving: '#16A34A', idling: '#F59E0B', stopped: '#64748B', offline: '#DC2626',
};

export interface FleetMapHandle {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  fitFleet: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export interface FleetMapProps {
  positions: Map<string, LivePosition>;
  /** id → display plate */
  plates?: Map<string, string>;
  selectedId?: string | null;
  onVehicleClick?: (vehicleId: string) => void;
  geofences?: Geofence[];
  layers?: MapLayerToggles;
  onLayers?: (l: MapLayerToggles) => void;
  trails?: Map<string, [number, number][]>;
  showControls?: boolean;
  center?: [number, number];
  zoom?: number;
  className?: string;
  children?: React.ReactNode;
}

/* ---------------- internals ---------------- */

function MapRef({ mapRef }: { mapRef: React.MutableRefObject<LeafletMap | null> }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

/** Custom pane order: tiles → geofences → routes → trails → markers → popups. */
function Panes() {
  const map = useMap();
  useEffect(() => {
    const defs: [string, number][] = [
      ['fbv-geofences', 350], ['fbv-routes', 360], ['fbv-trails', 370], ['fbv-markers', 620],
    ];
    defs.forEach(([name, z]) => {
      if (!map.getPane(name)) map.createPane(name);
      map.getPane(name)!.style.zIndex = String(z);
    });
  }, [map]);
  return null;
}

function TileWatcher({ onFail }: { onFail: () => void }) {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      eventHandlers={{ tileerror: () => onFail() }}
    />
  );
}

/** DOM-overlay vehicle markers — CSS transform transition = marker-tween. */
function MarkerLayer({ positions, plates, selectedId, onVehicleClick }: {
  positions: Map<string, LivePosition>;
  plates?: Map<string, string>;
  selectedId?: string | null;
  onVehicleClick?: (id: string) => void;
}) {
  const map = useMap();
  const [, setTick] = useState(0);
  const [animOn, setAnimOn] = useState(true);

  useEffect(() => {
    const off = () => setAnimOn(false);
    const on = () => {
      setTick((t) => t + 1);
      // re-enable tween after the jump has been applied
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimOn(true)));
    };
    const refresh = () => setTick((t) => t + 1);
    map.on('zoomstart movestart', off);
    map.on('zoomend moveend', on);
    map.on('move', refresh);
    return () => {
      map.off('zoomstart movestart', off);
      map.off('zoomend moveend', on);
      map.off('move', refresh);
    };
  }, [map]);

  const items = Array.from(positions.values());
  return (
    <div className="pointer-events-none absolute inset-0 z-[620] overflow-hidden">
      {items.map((p) => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        const color = STATUS_COLOR[p.status];
        const selected = selectedId === p.vehicleId;
        return (
          <div
            key={p.vehicleId}
            className={animOn ? 'fbv-marker' : undefined}
            style={{
              position: 'absolute', left: 0, top: 0,
              transform: `translate(${pt.x}px, ${pt.y}px)`,
              zIndex: selected ? 10 : 1,
            }}
          >
            <div className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); onVehicleClick?.(p.vehicleId); }}>
              {selected && (
                <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-accent/80 transition-transform duration-200" />
              )}
              {p.status === 'moving' && (
                <span className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full animate-pulse-live-ring" style={{ background: color }} />
              )}
              <div className="fbv-marker-rotate relative" style={{ transform: `rotate(${p.heading}deg)` }}>
                <svg width="28" height="28" viewBox="0 0 28 28">
                  <circle cx="14" cy="14" r="11.5" fill={color} stroke="#fff" strokeWidth="2" />
                  <path d="M14 7 L19.5 18 L14 15 L8.5 18 Z" fill="#fff" />
                </svg>
              </div>
              {selected && (
                <div className="absolute left-1/2 top-7 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-white px-2 py-1 shadow-pop">
                  <PlateTag plate={plates?.get(p.vehicleId) ?? p.vehicleId} />
                  <span className="font-mono text-[11px] font-semibold text-ink-900">{p.speedKmh} km/h</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Trail polyline with gradient-fade tail (segment opacity ramps to head). */
function Trail({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null;
  const segments: [number, number][][] = [];
  const CHUNK = Math.max(2, Math.ceil(points.length / 6));
  for (let i = 0; i < points.length - 1; i += CHUNK) {
    segments.push(points.slice(i, Math.min(i + CHUNK + 1, points.length)));
  }
  return (
    <>
      {segments.map((seg, i) => (
        <Polyline key={i} positions={seg} pane="fbv-trails"
          pathOptions={{ color: '#06B6D4', weight: 4, opacity: 0.12 + (0.78 * (i + 1)) / segments.length, lineCap: 'round' }} />
      ))}
    </>
  );
}

function GeofenceOverlay({ gf, labelled }: { gf: Geofence; labelled: boolean }) {
  const style = { color: '#06B6D4', weight: 2, dashArray: '6 4', fillColor: '#06B6D4', fillOpacity: 0.08 };
  const label = labelled && (
    <Tooltip permanent direction="center" className="fbv-gf-label" opacity={1}>
      {gf.name.toUpperCase()}
    </Tooltip>
  );
  if (gf.kind === 'circle' && gf.center && gf.radiusM) {
    return <Circle center={[gf.center.lat, gf.center.lng]} radius={gf.radiusM} pathOptions={style} pane="fbv-geofences">{label}</Circle>;
  }
  if (gf.kind === 'polygon' && gf.polygon) {
    return <Polygon positions={gf.polygon.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={style} pane="fbv-geofences">{label}</Polygon>;
  }
  return null;
}

/* ---------------- main component ---------------- */

export const FleetMap = forwardRef<FleetMapHandle, FleetMapProps>(function FleetMap({
  positions, plates, selectedId, onVehicleClick,
  geofences = [], layers, onLayers, trails,
  showControls = true, center = NAIROBI_CENTER, zoom = 11, className, children,
}, ref) {
  const mapRef = useRef<LeafletMap | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [internalLayers, setInternalLayers] = useState<MapLayerToggles>({ geofences: true, trails: true, labels: true, traffic: false });
  const activeLayers = layers ?? internalLayers;
  const setLayers = onLayers ?? setInternalLayers;

  const flyTo = useCallback((lat: number, lng: number, z = 15) => {
    mapRef.current?.flyTo([lat, lng], z, { duration: 0.6 });
  }, []);
  const fitFleet = useCallback(() => {
    const pts = Array.from(positions.values()).map((p) => [p.lat, p.lng] as [number, number]);
    if (pts.length && mapRef.current) {
      mapRef.current.flyToBounds(L.latLngBounds(pts).pad(0.15), { duration: 0.6 });
    }
  }, [positions]);

  useImperativeHandle(ref, () => ({
    flyTo, fitFleet,
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
  }), [flyTo, fitFleet]);

  return (
    <div className={className} style={{ position: 'relative', height: '100%', width: '100%' }}>
      {tilesFailed && (
        <img src="/map-fallback.svg" alt="Map fallback"
          className="absolute inset-0 z-0 h-full w-full object-cover" />
      )}
      <MapContainer
        center={center} zoom={zoom}
        style={{ position: 'absolute', inset: 0, background: '#EDF1F6' }}
        zoomControl={false}
        attributionControl={!tilesFailed}
      >
        <MapRef mapRef={mapRef} />
        <Panes />
        {!tilesFailed && <TileWatcher onFail={() => setTilesFailed(true)} />}
        {activeLayers.geofences && geofences.map((gf) => (
          <GeofenceOverlay key={gf.id} gf={gf} labelled={activeLayers.labels} />
        ))}
        {activeLayers.trails && trails && Array.from(trails.entries()).map(([id, pts]) => (
          <Trail key={id} points={pts} />
        ))}
        {children}
      </MapContainer>
      <MarkerLayer positions={positions} plates={plates} selectedId={selectedId} onVehicleClick={onVehicleClick} />
      {showControls && (
        <div className="absolute bottom-4 right-4 z-[700]">
          <MapControls
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
            onFitFleet={fitFleet}
            layers={activeLayers}
            onLayers={setLayers}
          />
        </div>
      )}
    </div>
  );
});

export default FleetMap;
