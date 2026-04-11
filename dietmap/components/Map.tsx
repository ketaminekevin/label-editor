'use client';
import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Restaurant, DietaryTag } from '@/lib/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const ACCENT = '#2563EB';
const LABEL_MINZOOM = 12; // zoom level below which name labels are hidden

/** Spread co-located markers in a small ring so they don't overlap */
function spreadColocated(list: Restaurant[]): Restaurant[] {
  const THRESHOLD = 0.0001; // ~11 m — treat as same point
  const SPREAD_R  = 0.00014; // ~15 m ring radius
  const result = list.map(r => ({ ...r }));
  const groups: Record<string, number[]> = {};

  for (let i = 0; i < result.length; i++) {
    const key = `${Math.round(result[i].lat / THRESHOLD)},${Math.round(result[i].lng / THRESHOLD)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  }

  for (const indices of Object.values(groups)) {
    if (indices.length < 2) continue;
    const cLat = indices.reduce((s, i) => s + result[i].lat, 0) / indices.length;
    const cLng = indices.reduce((s, i) => s + result[i].lng, 0) / indices.length;
    const lngScale = Math.cos(cLat * Math.PI / 180);
    indices.forEach((idx, k) => {
      const angle = (2 * Math.PI * k) / indices.length;
      result[idx] = {
        ...result[idx],
        lat: cLat + SPREAD_R * Math.sin(angle),
        lng: cLng + (SPREAD_R / lngScale) * Math.cos(angle),
      };
    });
  }
  return result;
}

interface Props {
  restaurants: Restaurant[];
  selectedFilters: DietaryTag[];
  onMapMove: (swLat: number, swLng: number, neLat: number, neLng: number) => void;
  onRestaurantClick: (r: Restaurant) => void;
  onAddClick?: (lat: number, lng: number) => void;
  flyToTarget?: { lat: number; lng: number; zoom?: number } | null;
  restaurantListColor?: Record<string, string>;
  selectedRestaurantId?: string | null;
  mapStyle?: string;
}

export function Map({
  restaurants, selectedFilters, onMapMove,
  onRestaurantClick, onAddClick, flyToTarget,
  restaurantListColor, selectedRestaurantId,
  mapStyle = 'mapbox://styles/mapbox/light-v11',
}: Props) {
  const containerRef        = useRef<HTMLDivElement>(null);
  const mapRef              = useRef<mapboxgl.Map | null>(null);
  // Keyed marker map: 'r:<id>' for singles, 'cluster:<sorted ids>' for clusters
  const markerMapRef        = useRef<Record<string, mapboxgl.Marker>>({});
  // Tracks the last-known isSelected state per marker key to detect selection changes
  const markerSelectedRef   = useRef<Record<string, boolean>>({});
  // Tracks whether each marker matched the active filters, to detect filter changes
  const markerFilterMatchRef = useRef<Record<string, boolean>>({});
  const popupRef            = useRef<mapboxgl.Popup | null>(null);
  const ctxMoveHandlerRef   = useRef<(() => void) | null>(null);
  const updateMarkersRef    = useRef<(() => void) | null>(null);
  const markerClickedRef    = useRef(false);
  // Track which style URL is currently applied so we don't call setStyle redundantly on mount
  const appliedMapStyleRef  = useRef<string>('mapbox://styles/mapbox/light-v11');

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [174.76, -36.84],
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    }), 'top-right');

    const fireBounds = () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      onMapMove(sw.lat, sw.lng, ne.lat, ne.lng);
    };

    map.on('moveend', fireBounds);
    map.on('zoomend', () => { updateMarkersRef.current?.(); });

    // Fire initial data load once tiles are ready
    map.on('load', () => {
      fireBounds();
      updateMarkersRef.current?.();

      // Guard: style.load may have already added these if setStyle was called early
      if (map.getSource('restaurant-labels')) return;

      // Symbol layer for name labels — shows at zoom ≥ 14, native collision detection
      map.addSource('restaurant-labels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'restaurant-label-layer',
        type: 'symbol',
        source: 'restaurant-labels',
        minzoom: LABEL_MINZOOM,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-anchor': 'left',
          'text-offset': [1.4, 0],
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-max-width': 12,
          'symbol-sort-key': ['get', 'sortKey'],
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
        },
      });
    });

    // Close open popup when clicking bare map (not a marker or popup)
    map.on('click', () => {
      if (markerClickedRef.current) return;
      const popup = popupRef.current;
      if (!popup) return;
      const el = popup.getElement();
      if (el) {
        el.style.transition = 'opacity 0.15s ease';
        el.style.opacity = '0';
        setTimeout(() => { popup.remove(); if (popupRef.current === popup) popupRef.current = null; }, 150);
      } else {
        popup.remove();
        popupRef.current = null;
      }
    });


    mapRef.current = map;

    return () => {
      Object.values(markerMapRef.current).forEach(m => m.remove());
      markerMapRef.current = {};
      markerSelectedRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers — incremental: reuse existing markers, only animate truly new ones
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // ── Spread co-located then cluster ──────────────────────────────────────
    const spreadRestaurants = spreadColocated(restaurants);
    const zoom = map.getZoom();
    const CLUSTER_PX = zoom <= 9 ? 60 : 0;
    type Proj = { r: Restaurant; x: number; y: number };
    const projected: Proj[] = spreadRestaurants.map(r => {
      const p = map.project([r.lng, r.lat]);
      return { r, x: p.x, y: p.y };
    });

    const used = new Set<number>();
    type Cluster = { members: Restaurant[]; cx: number; cy: number; lng: number; lat: number };
    const clusters: Cluster[] = [];

    for (let i = 0; i < projected.length; i++) {
      if (used.has(i)) continue;
      const members: Restaurant[] = [projected[i].r];
      used.add(i);
      let cx = projected[i].x, cy = projected[i].y;

      for (let j = i + 1; j < projected.length; j++) {
        if (used.has(j)) continue;
        const dx = cx - projected[j].x, dy = cy - projected[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < CLUSTER_PX) {
          members.push(projected[j].r);
          used.add(j);
          cx = members.reduce((s, _, k) => s + projected.find(p => p.r === members[k])!.x, 0) / members.length;
          cy = members.reduce((s, _, k) => s + projected.find(p => p.r === members[k])!.y, 0) / members.length;
        }
      }

      clusters.push({
        members,
        cx, cy,
        lng: members.reduce((s, r) => s + r.lng, 0) / members.length,
        lat: members.reduce((s, r) => s + r.lat, 0) / members.length,
      });
    }

    const nextKeys = new Set<string>();

    clusters.forEach(cluster => {
      const isCluster = cluster.members.length > 1;
      const key = isCluster
        ? 'cluster:' + cluster.members.map(r => r.id).sort().join(',')
        : 'r:' + cluster.members[0].id;
      nextKeys.add(key);

      if (isCluster) {
        // ── Cluster marker ──────────────────────────────────────────────────
        if (markerMapRef.current[key]) {
          markerMapRef.current[key].setLngLat([cluster.lng, cluster.lat]);
          return;
        }
        const el = document.createElement('div');
        const size = Math.min(28 + cluster.members.length * 2, 44);
        el.style.cssText = `
          width:${size}px;height:${size}px;
          background:${ACCENT};border:2.5px solid #fff;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;font-size:11px;font-weight:700;color:#fff;
          box-shadow:0 2px 10px rgba(37,99,235,0.45);
          opacity:0;transition:opacity 0.2s ease;
        `;
        el.textContent = String(cluster.members.length);
        el.addEventListener('click', () => {
          const bounds = new mapboxgl.LngLatBounds();
          cluster.members.forEach(r => bounds.extend([r.lng, r.lat]));
          map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 700 });
        });
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([cluster.lng, cluster.lat])
          .addTo(map);
        requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
        markerMapRef.current[key] = marker;
        return;
      }

      // ── Single restaurant marker ──────────────────────────────────────────
      const r = cluster.members[0];
      const isSelected = r.id === selectedRestaurantId;
      const prevSelected = markerSelectedRef.current[key];
      const isAI   = r.source === 'area_scan';
      const isSeed = r.source === 'seed';
      const hasMatchingTag = selectedFilters.length === 0 ||
        selectedFilters.every(f => (r.dietary_tags ?? []).some(dt => dt.tag === f));
      const prevFilterMatch = markerFilterMatchRef.current[key];

      // Reuse existing marker if neither selection nor filter-match state changed
      if (markerMapRef.current[key] && prevSelected === isSelected && prevFilterMatch === hasMatchingTag) {
        markerMapRef.current[key].setLngLat([r.lng, r.lat]);
        return;
      }

      // Remove stale marker if selection or filter state changed (needs visual rebuild)
      if (markerMapRef.current[key]) {
        markerMapRef.current[key].remove();
        delete markerMapRef.current[key];
        delete markerFilterMatchRef.current[key];
      }

      const isNew = prevSelected === undefined; // never seen before → fade in
      const AI_PURPLE   = '#7c3aed';
      const SEED_COLOUR = '#94a3b8'; // slate-400 — unverified OSM data
      const pinColor    = !hasMatchingTag ? '#9CA3AF'
                        : isSeed ? SEED_COLOUR
                        : isAI   ? AI_PURPLE
                        : ACCENT;
      const pinShadow   = !hasMatchingTag ? 'rgba(0,0,0,0.15)'
                        : isSeed ? 'rgba(148,163,184,0.4)'
                        : isAI   ? 'rgba(124,58,237,0.4)'
                        : 'rgba(37,99,235,0.4)';
      const hoverShadow = !hasMatchingTag ? '0 4px 14px rgba(0,0,0,0.25)'
                        : isSeed ? '0 4px 14px rgba(148,163,184,0.55)'
                        : isAI   ? '0 4px 14px rgba(124,58,237,0.55)'
                        : '0 4px 14px rgba(37,99,235,0.55)';

      const size = isSelected ? 24 : 18;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;opacity:${isNew ? '0' : '1'};${isNew ? 'transition:opacity 0.2s ease;' : ''}`;

      const circle = document.createElement('div');
      circle.style.cssText = `
        width:${size}px;height:${size}px;
        background:${pinColor};
        border:2.5px solid #fff;border-radius:50%;
        box-shadow:0 2px 8px ${pinShadow};
        transition:transform 0.15s,box-shadow 0.15s;
        ${isSelected ? 'animation:pin-pulse 1.5s ease-in-out infinite;' : ''}
      `;
      wrapper.appendChild(circle);

      wrapper.addEventListener('mouseenter', () => {
        circle.style.transform = 'scale(1.3)';
        circle.style.boxShadow = hoverShadow;
      });
      wrapper.addEventListener('mouseleave', () => {
        circle.style.transform = 'scale(1)';
        circle.style.boxShadow = `0 2px 8px ${pinShadow}`;
      });

      const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'center' })
        .setLngLat([r.lng, r.lat])
        .addTo(map);

      if (isNew) {
        requestAnimationFrame(() => requestAnimationFrame(() => { wrapper.style.opacity = '1'; }));
      }

      wrapper.addEventListener('click', (e) => {
        markerClickedRef.current = true;
        setTimeout(() => { markerClickedRef.current = false; }, 50);
        e.stopPropagation();
        onRestaurantClick(r);
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        const containerW = map.getContainer().clientWidth;
        const panelW = Math.max(containerW * 0.42, 340);
        map.easeTo({ center: [r.lng, r.lat], offset: [-panelW / 2, 0], duration: 400 });
        // Show name label when zoomed out too far for the symbol layer
        if (map.getZoom() < LABEL_MINZOOM) {
          const nameEl = document.createElement('div');
          nameEl.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px;font-weight:600;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:4px 8px;box-shadow:0 2px 8px rgba(0,0,0,0.12);white-space:nowrap;pointer-events:none;';
          nameEl.textContent = r.name;
          const namePopup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -14], anchor: 'bottom' })
            .setLngLat([r.lng, r.lat])
            .setDOMContent(nameEl)
            .addTo(map);
          popupRef.current = namePopup;
          map.once('movestart', () => { namePopup.remove(); if (popupRef.current === namePopup) popupRef.current = null; });
        }
      });

      markerMapRef.current[key] = marker;
      markerSelectedRef.current[key] = isSelected;
      markerFilterMatchRef.current[key] = hasMatchingTag;
    });

    // Remove markers that are no longer in view
    for (const key of Object.keys(markerMapRef.current)) {
      if (!nextKeys.has(key)) {
        markerMapRef.current[key].remove();
        delete markerMapRef.current[key];
        delete markerSelectedRef.current[key];
        delete markerFilterMatchRef.current[key];
      }
    }
  }, [restaurants, selectedFilters, onRestaurantClick, selectedRestaurantId]);

  // Keep ref in sync so zoomend listener can call the latest version
  useEffect(() => { updateMarkersRef.current = updateMarkers; });
  useEffect(() => { updateMarkers(); }, [updateMarkers]);

  // Sync restaurant name labels into the symbol layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource('restaurant-labels') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    const AI_PURPLE = '#7c3aed';
    const spread = spreadColocated(restaurants);
    source.setData({
      type: 'FeatureCollection',
      features: spread
        .filter(r => selectedFilters.length === 0 || selectedFilters.every(f => (r.dietary_tags ?? []).some(dt => dt.tag === f)))
        .map(r => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
          properties: {
            name: r.name,
            color: r.source === 'area_scan' ? AI_PURPLE : ACCENT,
            sortKey: -(Number(r.avg_rating) || 0),
          },
        })),
    });
  }, [restaurants, selectedFilters]);

  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    const map = mapRef.current;
    const containerW = map.getContainer().clientWidth;
    const panelW = Math.max(containerW * 0.42, 340);
    map.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: flyToTarget.zoom ?? 13,
      duration: 1200,
      offset: [-panelW / 2, 0],
    });
  }, [flyToTarget]);

  // Change map style dynamically; re-add the label layer after style loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Skip if style hasn't actually changed (prevents unnecessary setStyle on mount)
    if (appliedMapStyleRef.current === mapStyle) return;
    appliedMapStyleRef.current = mapStyle;
    map.setStyle(mapStyle);
    map.once('style.load', () => {
      if (!map.getSource('restaurant-labels')) {
        map.addSource('restaurant-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'restaurant-label-layer',
          type: 'symbol',
          source: 'restaurant-labels',
          minzoom: LABEL_MINZOOM,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 11,
            'text-anchor': 'left',
            'text-offset': [1.4, 0],
            'text-allow-overlap': false,
            'text-ignore-placement': false,
            'text-max-width': 12,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
          },
        });
      }
      updateMarkersRef.current?.();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyle]);

  return <div ref={containerRef} className="w-full h-full" />;
}
