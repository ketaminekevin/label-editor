'use client';
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ScanRestaurant } from '@/lib/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const AI_COLOR        = '#7c3aed'; // purple  — area_scan
const COMMUNITY_COLOR = '#f59e0b'; // amber   — community pick
const LABEL_MINZOOM   = 12;

const CONF_SORT: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Spread co-located markers in a small ring so they don't overlap */
function spreadColocated(list: ScanRestaurant[]): ScanRestaurant[] {
  const THRESHOLD = 0.0001; // ~11 m — treat as same point
  const SPREAD_R  = 0.00014; // ~15 m ring radius
  const result = list.map(r => ({ ...r }));
  const groups = new Map<string, number[]>();

  for (let i = 0; i < result.length; i++) {
    const key = `${Math.round(result[i].lat / THRESHOLD)},${Math.round(result[i].lng / THRESHOLD)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  for (const indices of groups.values()) {
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
  restaurants: ScanRestaurant[];
  onPinClick: (restaurantId: string) => void;
  /** Custom dot colour for non-AI restaurants (e.g. list colour). Defaults to amber community colour. */
  listColor?: string;
}

// Inject popup styles once (transparent bg, no arrow — looks like native map label)
if (typeof document !== 'undefined' && !document.getElementById('scan-popup-style')) {
  const s = document.createElement('style');
  s.id = 'scan-popup-style';
  s.textContent = `.scan-label-popup .mapboxgl-popup-content{background:transparent!important;box-shadow:none!important;padding:0!important;border:none!important}.scan-label-popup .mapboxgl-popup-tip{display:none!important}`;
  document.head.appendChild(s);
}

export function ScanMap({ restaurants, onPinClick, listColor }: Props) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<mapboxgl.Map | null>(null);
  const markersRef    = useRef<mapboxgl.Marker[]>([]);
  const popupRef      = useRef<mapboxgl.Popup | null>(null);
  const listColorRef  = useRef<string | undefined>(listColor);
  listColorRef.current = listColor;

  // Update markers + label source when restaurants change (e.g. after Find More)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // Refresh markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const spread = spreadColocated(restaurants);
    spread.forEach(r => {
      const isAI  = r.source === 'area_scan';
      const color = isAI ? AI_COLOR : (listColorRef.current ?? COMMUNITY_COLOR);
      const size  = 18;
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;
      const circle = document.createElement('div');
      circle.style.cssText = `width:${size}px;height:${size}px;background:${color};border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 8px ${isAI ? 'rgba(124,58,237,0.4)' : 'rgba(245,158,11,0.4)'};transition:transform 0.15s,box-shadow 0.15s;`;
      wrapper.appendChild(circle);
      wrapper.addEventListener('mouseenter', () => { circle.style.transform = 'scale(1.3)'; });
      wrapper.addEventListener('mouseleave', () => { circle.style.transform = 'scale(1)'; });
      wrapper.addEventListener('click', () => {
        onPinClick(r.restaurant_id);
        if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
        const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -14], className: 'scan-label-popup', anchor: 'bottom' })
          .setLngLat([r.lng, r.lat])
          .setHTML(`<span style="font-family:'DIN Offc Pro Medium',Arial,sans-serif;font-size:12px;font-weight:600;color:${color};text-shadow:-1.5px 0 #fff,0 1.5px #fff,1.5px 0 #fff,0 -1.5px #fff;white-space:nowrap;pointer-events:none;display:block;padding:2px 4px;">${r.name}</span>`)
          .addTo(map);
        popupRef.current = popup;
        setTimeout(() => { if (popupRef.current === popup) { popup.remove(); popupRef.current = null; } }, 2500);
      });
      const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'center' }).setLngLat([r.lng, r.lat]).addTo(map);
      markersRef.current.push(marker);
    });

    // Refresh label source
    const src = map.getSource('scan-labels') as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: spread.map(r => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
          properties: {
            name: r.name,
            color: r.source === 'area_scan' ? AI_COLOR : (listColor ?? COMMUNITY_COLOR),
            sortKey: -(CONF_SORT[r.ai_safety_confidence ?? ''] ?? 0),
          },
        })),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !restaurants.length) return;

    const lats = restaurants.map(r => r.lat);
    const lngs = restaurants.map(r => r.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      zoom: 11,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 60, maxZoom: 14, duration: 0 }
      );

      const spread = spreadColocated(restaurants);

      // Add markers
      spread.forEach(r => {
        const isAI  = r.source === 'area_scan';
        const color = isAI ? AI_COLOR : (listColorRef.current ?? COMMUNITY_COLOR);
        const size  = 18;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;

        const circle = document.createElement('div');
        circle.style.cssText = `
          width:${size}px;height:${size}px;
          background:${color};border:2.5px solid #fff;border-radius:50%;
          box-shadow:0 2px 8px ${isAI ? 'rgba(124,58,237,0.4)' : 'rgba(245,158,11,0.4)'};
          transition:transform 0.15s,box-shadow 0.15s;
        `;

        wrapper.appendChild(circle);

        wrapper.addEventListener('mouseenter', () => {
          circle.style.transform = 'scale(1.3)';
          circle.style.boxShadow = isAI
            ? '0 4px 14px rgba(124,58,237,0.55)'
            : '0 4px 14px rgba(245,158,11,0.55)';
        });
        wrapper.addEventListener('mouseleave', () => {
          circle.style.transform = 'scale(1)';
          circle.style.boxShadow = isAI
            ? '0 2px 8px rgba(124,58,237,0.4)'
            : '0 2px 8px rgba(245,158,11,0.4)';
        });
        wrapper.addEventListener('click', () => {
          onPinClick(r.restaurant_id);
          if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
          const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: true, offset: [0, -14], className: 'scan-label-popup', anchor: 'bottom' })
            .setLngLat([r.lng, r.lat])
            .setHTML(`<span style="font-family:'DIN Offc Pro Medium',Arial,sans-serif;font-size:12px;font-weight:600;color:${color};text-shadow:-1.5px 0 #fff,0 1.5px #fff,1.5px 0 #fff,0 -1.5px #fff;white-space:nowrap;pointer-events:none;display:block;padding:2px 4px;">${r.name}</span>`)
            .addTo(map);
          popupRef.current = popup;
          setTimeout(() => { if (popupRef.current === popup) { popup.remove(); popupRef.current = null; } }, 2500);
        });

        const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'center' })
          .setLngLat([r.lng, r.lat])
          .addTo(map);
        markersRef.current.push(marker);
      });

      // Native symbol layer for name labels — shows at zoom ≥ 13, built-in collision detection
      map.addSource('scan-labels', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: spread.map(r => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
            properties: {
              name: r.name,
              color: r.source === 'area_scan' ? AI_COLOR : (listColor ?? COMMUNITY_COLOR),
              sortKey: -(CONF_SORT[r.ai_safety_confidence ?? ''] ?? 0),
            },
          })),
        },
      });

      map.addLayer({
        id: 'scan-label-layer',
        type: 'symbol',
        source: 'scan-labels',
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

    mapRef.current = map;
    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '280px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #f3f4f6' }} />;
}
