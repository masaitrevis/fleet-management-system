// FBV FleetOS — reusable Leaflet map (design.md §8).
// CARTO Positron tiles, chevron-disc vehicle markers with 2s marker-tween,
// trail polylines, geofence overlays, control stack, tile-failure fallback.

import 'leaflet/dist/leaflet.css';
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
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
  fitPoints: (pts: [number, number][]) => void;
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

  const fitPoints = useCallback((pts: [number, number][]) => {
    if (pts.length && mapRef.current) {
      mapRef.current.flyToBounds(L.latLngBounds(pts).pad(0.12), { duration: 0.6 });
    }
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo, fitFleet, fitPoints,
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
  }), [flyTo, fitFleet, fitPoints]);

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

/* ================================================================== */
/* Replay & editor extensions (additive — used by tracking/geofences)  */
/* ================================================================== */

function divIcon(html: string, size: number, anchor?: [number, number]): L.DivIcon {
  return L.divIcon({
    className: 'fbv-divicon',
    html,
    iconSize: [size, size],
    iconAnchor: anchor ?? [size / 2, size / 2],
  });
}

/** Replay playback marker: 34px cyan-halo disc + fading ghost breadcrumbs. */
export function ReplayMarker({ lat, lng, heading, ghosts = [], visible = true, plate, speedKmh }: {
  lat: number; lng: number; heading: number;
  ghosts?: [number, number][];
  visible?: boolean;
  plate?: string;
  speedKmh?: number;
}) {
  if (!visible) return null;
  const html = `
    <div style="position:relative;width:34px;height:34px">
      <span style="position:absolute;inset:-7px;border-radius:9999px;border:3px solid rgba(6,182,212,.55)"></span>
      <div style="position:absolute;inset:0;transform:rotate(${Math.round(heading)}deg)">
        <svg width="34" height="34" viewBox="0 0 34 34">
          <circle cx="17" cy="17" r="14" fill="#06B6D4" stroke="#fff" stroke-width="2.5"/>
          <path d="M17 8 L24 22 L17 18.5 L10 22 Z" fill="#062831"/>
        </svg>
      </div>
    </div>`;
  return (
    <>
      {ghosts.map((g, i) => (
        <CircleMarker key={i} center={g} radius={4.5 - i * 0.4} pane="fbv-markers"
          pathOptions={{ color: '#06B6D4', weight: 1.5, opacity: Math.max(0.06, 0.5 - i * 0.07), fillColor: '#06B6D4', fillOpacity: Math.max(0.05, 0.42 - i * 0.06) }} />
      ))}
      <Marker position={[lat, lng]} icon={divIcon(html, 34)} pane="fbv-markers" zIndexOffset={900} interactive={false} />
      {plate && (
        <Marker position={[lat, lng]} icon={divIcon(
          `<div style="transform:translate(-50%,26px);white-space:nowrap;display:flex;gap:6px;align-items:center;background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:2px 8px;box-shadow:0 4px 16px rgba(10,26,47,.12)">
             <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.04em;color:#0E1B2A">${plate}</span>
             <span style="font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;color:#46586D">${Math.round(speedKmh ?? 0)} km/h</span>
           </div>`, 0, [0, 0])} pane="fbv-markers" zIndexOffset={899} interactive={false} />
      )}
    </>
  );
}

export interface RouteEventMarker {
  lat: number; lng: number;
  kind: 'harsh' | 'stop' | 'geofence' | 'idle';
  label: string;
}

/** Replay route overlay: navy polyline + direction chevrons + stop discs +
 *  amber dashed idle spans + harsh flags + cyan geofence gate ticks. */
export function RouteOverlay({ path, chevrons = true, stops = [], idlePaths = [], events = [], accent = false }: {
  path: [number, number][];
  chevrons?: boolean;
  stops?: { lat: number; lng: number; label?: string }[];
  idlePaths?: [number, number][][];
  events?: RouteEventMarker[];
  /** cyan (mini-map style) instead of navy */
  accent?: boolean;
}) {
  const chevronMarks = useMemo(() => {
    if (!chevrons || path.length < 2) return [];
    const out: { lat: number; lng: number; deg: number }[] = [];
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const [aLat, aLng] = path[i - 1];
      const [bLat, bLng] = path[i];
      const dKm = Math.hypot(bLat - aLat, (bLng - aLng) * Math.cos((aLat * Math.PI) / 180)) * 111.32;
      acc += dKm;
      if (acc >= 0.4) {
        acc = 0;
        const deg = (Math.atan2(bLng - aLng, bLat - aLat) * 180) / Math.PI;
        out.push({ lat: (aLat + bLat) / 2, lng: (aLng + bLng) / 2, deg: 90 - deg });
      }
    }
    return out;
  }, [path, chevrons]);

  const lineColor = accent ? '#06B6D4' : '#0F2540';
  return (
    <>
      {path.length > 1 && (
        <Polyline positions={path} pane="fbv-routes"
          pathOptions={{ color: lineColor, weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />
      )}
      {idlePaths.map((p, i) => p.length > 1 && (
        <Polyline key={`idle-${i}`} positions={p} pane="fbv-routes"
          pathOptions={{ color: '#F59E0B', weight: 5, opacity: 0.85, dashArray: '4 6', lineCap: 'round' }} />
      ))}
      {chevronMarks.map((c, i) => (
        <Marker key={`ch-${i}`} position={[c.lat, c.lng]} interactive={false} pane="fbv-routes"
          icon={divIcon(`<div style="transform:rotate(${Math.round(c.deg)}deg);width:14px;height:14px">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1.5 L12 12 L7 9.4 L2 12 Z" fill="${accent ? '#062831' : '#06B6D4'}" stroke="#fff" stroke-width="1"/></svg>
          </div>`, 14)} />
      ))}
      {stops.map((s, i) => (
        <CircleMarker key={`st-${i}`} center={[s.lat, s.lng]} radius={5} pane="fbv-routes"
          pathOptions={{ color: '#64748B', weight: 2, fillColor: '#EEF2F6', fillOpacity: 1 }}>
          {s.label && <Tooltip direction="top" offset={[0, -6]}>{s.label}</Tooltip>}
        </CircleMarker>
      ))}
      {events.map((e, i) => {
        if (e.kind === 'harsh') {
          return (
            <Marker key={`ev-${i}`} position={[e.lat, e.lng]} pane="fbv-routes"
              icon={divIcon(`<svg width="18" height="18" viewBox="0 0 18 18">
                <path d="M9 2 L16.5 15 L1.5 15 Z" fill="#DC2626" stroke="#fff" stroke-width="1.5"/>
                <text x="9" y="13" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">!</text>
              </svg>`, 18, [9, 15])}>
              <Tooltip direction="top" offset={[0, -12]}>{e.label}</Tooltip>
            </Marker>
          );
        }
        if (e.kind === 'geofence') {
          return (
            <Marker key={`ev-${i}`} position={[e.lat, e.lng]} pane="fbv-routes"
              icon={divIcon(`<svg width="16" height="20" viewBox="0 0 16 20">
                <rect x="6.5" y="2" width="3" height="16" rx="1.5" fill="#06B6D4" stroke="#fff" stroke-width="1"/>
                <circle cx="8" cy="4" r="3.2" fill="#06B6D4" stroke="#fff" stroke-width="1.2"/>
              </svg>`, 16, [8, 18])}>
              <Tooltip direction="top" offset={[0, -14]}>{e.label}</Tooltip>
            </Marker>
          );
        }
        return null; // stops/idle rendered via stops/idlePaths
      })}
    </>
  );
}

/* ---------------- geofence drawing (manual, no leaflet-draw) -------- */

export interface DrawShape {
  kind: 'circle' | 'polygon';
  center?: { lat: number; lng: number };
  radiusM?: number;
  polygon?: { lat: number; lng: number }[];
}

export interface DrawDraft {
  center?: { lat: number; lng: number };
  radiusM?: number;
  vertices: { lat: number; lng: number }[];
  cursor?: { lat: number; lng: number };
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180, lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const VERTEX_ICON = divIcon(
  `<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#fff;border:3px solid #06B6D4;box-shadow:0 1px 4px rgba(10,26,47,.35)"></span>`, 12);

/** Manual geofence drawing layer: click-to-add vertices (polygon) or
 *  click center → drag/click radius (circle), with live rubber-band preview. */
export function GeofenceDrawLayer({ mode, active, onComplete, onDraft }: {
  mode: 'circle' | 'polygon';
  active: boolean;
  onComplete: (shape: DrawShape) => void;
  onDraft?: (draft: DrawDraft) => void;
}) {
  const map = useMap();
  const [draft, setDraft] = useState<DrawDraft>({ vertices: [] });
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // reset when mode/activation changes
  useEffect(() => { setDraft({ vertices: [] }); }, [mode, active]);

  useEffect(() => { onDraft?.(draft); }, [draft, onDraft]);

  useEffect(() => {
    if (!active) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const d = draftRef.current;
      const ll = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (mode === 'circle') {
        if (!d.center) {
          setDraft({ vertices: [], center: ll, radiusM: 60 });
        } else {
          const radiusM = Math.max(40, Math.round(haversineM(d.center, ll)));
          onComplete({ kind: 'circle', center: d.center, radiusM });
          setDraft({ vertices: [] });
        }
      } else {
        // close polygon when clicking near the first vertex (>=3 points)
        if (d.vertices.length >= 3) {
          const first = map.latLngToContainerPoint([d.vertices[0].lat, d.vertices[0].lng]);
          const clickPt = map.latLngToContainerPoint(e.latlng);
          if (first.distanceTo(clickPt) < 16) {
            onComplete({ kind: 'polygon', polygon: d.vertices });
            setDraft({ vertices: [] });
            return;
          }
        }
        setDraft({ ...d, vertices: [...d.vertices, ll] });
      }
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      const d = draftRef.current;
      const ll = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (mode === 'circle' && d.center) {
        setDraft({ ...d, radiusM: Math.max(40, Math.round(haversineM(d.center, ll))) });
      } else if (mode === 'polygon') {
        setDraft({ ...d, cursor: ll });
      }
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);
    return () => { map.off('click', onClick); map.off('mousemove', onMove); };
  }, [map, mode, active, onComplete]);

  if (!active) return null;
  const preview = { color: '#06B6D4', weight: 2, dashArray: '6 4', fillColor: '#06B6D4', fillOpacity: 0.1 };
  return (
    <>
      {mode === 'circle' && draft.center && (
        <>
          <Circle center={[draft.center.lat, draft.center.lng]} radius={draft.radiusM ?? 60} pathOptions={preview} pane="fbv-geofences" />
          <Marker position={[draft.center.lat, draft.center.lng]} icon={VERTEX_ICON} interactive={false} />
        </>
      )}
      {mode === 'polygon' && draft.vertices.length > 0 && (
        <>
          {draft.vertices.map((v, i) => (
            <Marker key={i} position={[v.lat, v.lng]} icon={VERTEX_ICON} interactive={false} zIndexOffset={i === 0 ? 100 : 0} />
          ))}
          {draft.vertices.length > 1 && (
            <Polyline
              positions={[...draft.vertices.map((v) => [v.lat, v.lng] as [number, number]),
                ...(draft.cursor ? [[draft.cursor.lat, draft.cursor.lng] as [number, number]] : [])]}
              pathOptions={{ color: '#06B6D4', weight: 2, dashArray: '6 4' }} pane="fbv-geofences" />
          )}
          {draft.vertices.length >= 3 && (
            <Polygon positions={draft.vertices.map((v) => [v.lat, v.lng] as [number, number])}
              pathOptions={{ ...preview, dashArray: undefined }} pane="fbv-geofences" />
          )}
        </>
      )}
    </>
  );
}

/** Draggable white/accent edit handles for an existing fence. */
export function FenceEditHandles({ geofence, onChange }: {
  geofence: Geofence;
  onChange: (patch: Partial<Geofence>) => void;
}) {
  const HANDLE = divIcon(
    `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#fff;border:3px solid #06B6D4;box-shadow:0 1px 6px rgba(10,26,47,.4);cursor:grab"></span>`, 16);

  if (geofence.kind === 'circle' && geofence.center && geofence.radiusM) {
    const c = geofence.center;
    const dLat = (geofence.radiusM / 111320);
    const edge = { lat: c.lat + dLat, lng: c.lng };
    return (
      <>
        <Marker position={[c.lat, c.lng]} icon={HANDLE} draggable
          eventHandlers={{ drag: (e) => { const ll = (e.target as L.Marker).getLatLng(); onChange({ center: { lat: ll.lat, lng: ll.lng } }); } }} />
        <Marker position={[edge.lat, edge.lng]} icon={HANDLE} draggable
          eventHandlers={{ drag: (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            const r = haversineM(c, { lat: ll.lat, lng: ll.lng });
            onChange({ radiusM: Math.max(40, Math.round(r)) });
          } }} />
      </>
    );
  }
  if (geofence.kind === 'polygon' && geofence.polygon) {
    return (
      <>
        {geofence.polygon.map((v, i) => (
          <Marker key={i} position={[v.lat, v.lng]} icon={HANDLE} draggable
            eventHandlers={{ drag: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              const next = geofence.polygon!.map((p, j) => (j === i ? { lat: ll.lat, lng: ll.lng } : p));
              onChange({ polygon: next });
            } }} />
        ))}
      </>
    );
  }
  return null;
}

