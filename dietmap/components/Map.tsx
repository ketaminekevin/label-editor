'use client';
import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Restaurant, DietaryTag, DIETARY_LABELS } from '@/lib/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const ACCENT = '#2563EB';

interface Props {
  restaurants: Restaurant[];
  selectedFilters: DietaryTag[];
  onMapMove: (swLat: number, swLng: number, neLat: number, neLng: number) => void;
  onRestaurantClick: (r: Restaurant) => void;
  onAddClick?: (lat: number, lng: number) => void;
  flyToTarget?: { lat: number; lng: number; zoom?: number } | null;
  restaurantListColor?: Record<string, string>;
  selectedRestaurantId?: string | null;
}

export function Map({
  restaurants, selectedFilters, onMapMove,
  onRestaurantClick, onAddClick, flyToTarget,
  restaurantListColor, selectedRestaurantId,
}: Props) {
  const containerRef      = useRef<HTMLDivElement>(null);
  const mapRef            = useRef<mapboxgl.Map | null>(null);
  const markersRef        = useRef<mapboxgl.Marker[]>([]);
  const popupRef          = useRef<mapboxgl.Popup | null>(null);
  const ctxMoveHandlerRef = useRef<(() => void) | null>(null);
  const updateMarkersRef  = useRef<(() => void) | null>(null);
  const markerClickedRef  = useRef(false);

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

    // Right-click: small popup with pin icon, circular X, reverse geocode, closes on move
    map.on('contextmenu', async (e) => {
      e.preventDefault();

      if (popupRef.current) popupRef.current.remove();
      if (ctxMoveHandlerRef.current) {
        map.off('movestart', ctxMoveHandlerRef.current);
        ctxMoveHandlerRef.current = null;
      }

      const { lat, lng } = e.lngLat;

      const el = document.createElement('div');
      el.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;width:186px;padding:12px 14px 14px;position:relative;';
      el.innerHTML = `
        <button id="ctx-x-btn" style="
          position:absolute;top:8px;right:8px;
          width:18px;height:18px;border-radius:50%;
          background:#f3f4f6;border:1px solid #e5e7eb;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;font-size:9px;color:#6b7280;line-height:1;
        ">✕</button>
        <div style="display:flex;align-items:flex-start;gap:8px;padding-right:20px">
          <span style="font-size:15px;line-height:1;margin-top:1px;flex-shrink:0">📍</span>
          <div>
            <div style="font-size:12px;font-weight:700;color:#111827;line-height:1.3">Add a restaurant here?</div>
            <div id="ctx-addr" style="font-size:10px;color:#9ca3af;margin-top:3px;line-height:1.4">Locating…</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button id="ctx-add-btn" style="
            flex:1;padding:6px 0;
            background:${ACCENT};color:#fff;
            border:none;border-radius:7px;
            font-size:11px;font-weight:600;cursor:pointer;
          ">Add Restaurant</button>
          <button id="ctx-cancel-btn" style="
            flex:1;padding:6px 0;
            background:#f3f4f6;color:#374151;
            border:none;border-radius:7px;
            font-size:11px;font-weight:500;cursor:pointer;
          ">Cancel</button>
        </div>
      `;

      const popup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '200px',
        anchor: 'top',
        offset: [0, 6],
      })
        .setLngLat(e.lngLat)
        .setDOMContent(el)
        .addTo(map);
      popupRef.current = popup;

      const onMoveStart = () => { popup.remove(); ctxMoveHandlerRef.current = null; };
      ctxMoveHandlerRef.current = onMoveStart;
      map.once('movestart', onMoveStart);

      const addBtn = el.querySelector('#ctx-add-btn') as HTMLButtonElement;
      const cancelBtn = el.querySelector('#ctx-cancel-btn') as HTMLButtonElement;
      const xBtn = el.querySelector('#ctx-x-btn') as HTMLButtonElement;
      const addrEl = el.querySelector('#ctx-addr') as HTMLElement;

      addBtn?.addEventListener('mouseenter', () => { addBtn.style.background = '#1d4ed8'; });
      addBtn?.addEventListener('mouseleave', () => { addBtn.style.background = ACCENT; });
      addBtn?.addEventListener('click', () => { popup.remove(); onAddClick?.(lat, lng); });
      cancelBtn?.addEventListener('click', () => popup.remove());
      xBtn?.addEventListener('click', () => popup.remove());

      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (token) {
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&types=address,neighborhood,place&limit=1`)
          .then(r => r.json())
          .then(data => {
            const place = data.features?.[0];
            if (addrEl) addrEl.textContent = place
              ? place.place_name?.split(',').slice(0, 2).join(', ') || 'Unknown location'
              : 'Unknown location';
          })
          .catch(() => { if (addrEl) addrEl.textContent = ''; });
      } else if (addrEl) {
        addrEl.textContent = '';
      }
    });

    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // ── Clustering ───────────────────────────────────────────────────────────
    // Only cluster at low zoom levels (≤ 9) with a large pixel radius
    const zoom = map.getZoom();
    const CLUSTER_PX = zoom <= 9 ? 60 : 0; // 0 = no clustering at normal zoom
    type Proj = { r: Restaurant; x: number; y: number };
    const projected: Proj[] = restaurants.map(r => {
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

    clusters.forEach(cluster => {
      if (cluster.members.length > 1) {
        // ── Cluster marker ──────────────────────────────────────────────────
        const el = document.createElement('div');
        const size = Math.min(28 + cluster.members.length * 2, 44);
        el.style.cssText = `
          width:${size}px;height:${size}px;
          background:${ACCENT};border:2.5px solid #fff;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          cursor:pointer;font-size:11px;font-weight:700;color:#fff;
          box-shadow:0 2px 10px rgba(37,99,235,0.45);
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
        markersRef.current.push(marker);
        return;
      }

      // ── Single restaurant marker ──────────────────────────────────────────
      const r = cluster.members[0];
      const isSelected = r.id === selectedRestaurantId;
      const isAI = r.source === 'area_scan';

      const hasMatchingTag = selectedFilters.length === 0 ||
        (r.dietary_tags ?? []).some(dt => selectedFilters.includes(dt.tag as DietaryTag));
      const AI_PURPLE = '#7c3aed';
      const pinColor  = !hasMatchingTag ? '#9CA3AF' : isAI ? AI_PURPLE : ACCENT;
      const pinShadow = !hasMatchingTag ? 'rgba(0,0,0,0.15)' : isAI ? 'rgba(124,58,237,0.4)' : 'rgba(37,99,235,0.4)';
      const hoverShadow = !hasMatchingTag ? '0 4px 14px rgba(0,0,0,0.25)' : isAI ? '0 4px 14px rgba(124,58,237,0.55)' : '0 4px 14px rgba(37,99,235,0.55)';

      const wrapper = document.createElement('div');
      const size = isSelected ? 24 : 18;
      wrapper.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;

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

      wrapper.addEventListener('click', (e) => {
        markerClickedRef.current = true;
        setTimeout(() => { markerClickedRef.current = false; }, 50);
        e.stopPropagation();
        onRestaurantClick(r);

        if (popupRef.current) popupRef.current.remove();

        const el = document.createElement('div');
        el.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;width:220px;';

        const rating = r.avg_rating ? Number(r.avg_rating) : null;
        const reviewCount = r.review_count ? Number(r.review_count) : 0;
        const filledStar = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" style="display:inline-block;vertical-align:middle"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        const emptyStar = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#e5e7eb" style="display:inline-block;vertical-align:middle"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
        const starsHtml = Array.from({ length: 5 }, (_, i) =>
          i < Math.round(rating ?? 0) ? filledStar : emptyStar
        ).join('');
        const tagLine = (r.dietary_tags ?? [])
          .map(dt => DIETARY_LABELS[dt.tag as DietaryTag] ?? dt.tag)
          .join(', ');

        el.innerHTML = `
          <div style="padding:12px 12px 12px;position:relative">
            <button id="popup-x-btn" style="
              position:absolute;top:8px;right:8px;
              background:none;border:none;cursor:pointer;
              color:#d1d5db;font-size:13px;line-height:1;padding:2px;
            ">✕</button>
            <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:4px;padding-right:20px;line-height:1.3">${r.name}</div>
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px">
              <span style="display:flex;gap:1px">${starsHtml}</span>
              ${rating
                ? `<span style="font-size:11px;font-weight:600;color:#374151">${rating.toFixed(1)}</span>
                   <span style="font-size:10px;color:#9ca3af">(${reviewCount})</span>`
                : `<span style="font-size:10px;color:#9ca3af">No reviews yet</span>`
              }
            </div>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:${tagLine ? '4px' : '6px'}">${r.cuisine_type?.join(' · ') || 'Restaurant'}</div>
            ${tagLine ? `<div style="font-size:10px;color:#9ca3af;line-height:1.4;margin-bottom:6px">${tagLine}</div>` : ''}
            <a href="https://maps.google.com/?q=${encodeURIComponent(r.name + ' ' + (r.address ?? ''))}" target="_blank" rel="noopener noreferrer"
               style="display:inline-flex;align-items:center;gap:4px;font-size:10px;color:#6b7280;text-decoration:none;border:1px solid #e5e7eb;border-radius:6px;padding:3px 8px;margin-top:2px">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              Directions
            </a>
          </div>
        `;

        const xBtn = el.querySelector('#popup-x-btn') as HTMLButtonElement;
        xBtn?.addEventListener('click', () => popup.remove());

        const popup = new mapboxgl.Popup({
          offset: [0, 8],
          closeButton: false,
          closeOnClick: false,
          maxWidth: '240px',
          anchor: 'top',
        })
          .setLngLat([r.lng, r.lat])
          .setDOMContent(el)
          .addTo(map);
        popupRef.current = popup;
      });

      markersRef.current.push(marker);
    }); // end clusters.forEach
  }, [restaurants, selectedFilters, onRestaurantClick, selectedRestaurantId]);

  // Keep ref in sync so zoomend listener can call the latest version
  useEffect(() => { updateMarkersRef.current = updateMarkers; });
  useEffect(() => { updateMarkers(); }, [updateMarkers]);

  useEffect(() => {
    if (!flyToTarget || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [flyToTarget.lng, flyToTarget.lat],
      zoom: flyToTarget.zoom ?? 13,
      duration: 1200,
    });
  }, [flyToTarget]);

  return <div ref={containerRef} className="w-full h-full" />;
}
