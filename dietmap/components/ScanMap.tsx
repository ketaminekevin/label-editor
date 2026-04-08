'use client';
import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ScanRestaurant } from '@/lib/types';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

const AI_COLOR        = '#7c3aed'; // purple  — area_scan
const COMMUNITY_COLOR = '#f59e0b'; // amber   — community pick

interface Props {
  restaurants: ScanRestaurant[];
  onPinClick: (restaurantId: string) => void;
}

export function ScanMap({ restaurants, onPinClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const markersRef   = useRef<mapboxgl.Marker[]>([]);

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !restaurants.length) return;

    // Compute bounding box
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
      // Fit to bounds with padding
      map.fitBounds(
        [[minLng, minLat], [maxLng, maxLat]],
        { padding: 60, maxZoom: 14, duration: 0 }
      );

      // Add markers
      restaurants.forEach(r => {
        const isAI    = r.source === 'area_scan';
        const color   = isAI ? AI_COLOR : COMMUNITY_COLOR;
        const size    = 18;

        const wrapper = document.createElement('div');
        wrapper.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;

        const circle = document.createElement('div');
        circle.style.cssText = `
          width:${size}px;height:${size}px;
          background:${color};border:2.5px solid #fff;border-radius:50%;
          box-shadow:0 2px 8px ${isAI ? 'rgba(124,58,237,0.4)' : 'rgba(245,158,11,0.4)'};
          transition:transform 0.15s,box-shadow 0.15s;
          display:flex;align-items:center;justify-content:center;
        `;

        if (isAI) {
          const svgSize = Math.round(size * 0.55);
          circle.innerHTML = `<svg width="${svgSize}" height="${svgSize}" viewBox="0 0 24 24" fill="white" style="display:block"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm0 10l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>`;
        }

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
        wrapper.addEventListener('click', () => onPinClick(r.restaurant_id));

        const marker = new mapboxgl.Marker({ element: wrapper, anchor: 'center' })
          .setLngLat([r.lng, r.lat])
          .addTo(map);
        markersRef.current.push(marker);
      });
    });

    mapRef.current = map;
    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '280px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #f3f4f6' }} />;
}
