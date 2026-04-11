'use client';
import { useState, useRef, useEffect } from 'react';
import { DietaryTag, DIETARY_LABELS } from '@/lib/types';
import { Sparkles, SlidersHorizontal, ChevronDown, Star, Map as MapIcon } from 'lucide-react';
import clsx from 'clsx';

const TAGS: DietaryTag[] = [
  'gluten_free', 'dairy_free', 'vegan', 'vegetarian',
  'keto', 'nut_free', 'halal', 'kosher', 'soy_free', 'egg_free', 'shellfish_free', 'low_fodmap',
];

export type SafetyFilter = 'all' | 'allergy_safe' | 'has_options';
export type MapStyleId = 'light' | 'dark' | 'satellite' | 'streets';

export const MAP_STYLES: Record<MapStyleId, { label: string; url: string }> = {
  light:     { label: 'Light',     url: 'mapbox://styles/mapbox/light-v11' },
  dark:      { label: 'Dark',      url: 'mapbox://styles/mapbox/dark-v11' },
  satellite: { label: 'Satellite', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  streets:   { label: 'Streets',   url: 'mapbox://styles/mapbox/streets-v12' },
};

interface Props {
  selected: DietaryTag[];
  onToggleTag: (tag: DietaryTag) => void;
  isPro?: boolean;
  showAI?: boolean;
  onToggleAI?: () => void;
  safetyFilter: SafetyFilter;
  onSafetyFilter: (v: SafetyFilter) => void;
  minRating: number | null;
  onMinRating: (v: number | null) => void;
  maxPrice: number | null;
  onMaxPrice: (v: number | null) => void;
  mapStyle: MapStyleId;
  onMapStyle: (v: MapStyleId) => void;
}

export function FilterBar({
  selected, onToggleTag,
  isPro, showAI = true, onToggleAI,
  safetyFilter, onSafetyFilter,
  minRating, onMinRating,
  maxPrice, onMaxPrice,
  mapStyle, onMapStyle,
}: Props) {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Count active extra filters
  const extraCount = (safetyFilter !== 'all' ? 1 : 0) + (minRating ? 1 : 0) + (maxPrice ? 1 : 0) + (mapStyle !== 'light' ? 1 : 0);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [panelOpen]);

  return (
    <div className="bg-white border-b border-gray-100 relative" ref={panelRef}>
      {/* Main filter row */}
      <div className="flex items-center gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar">
        {isPro && (
          <>
            <button
              onClick={onToggleAI}
              className={clsx(
                'flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border transition-all whitespace-nowrap',
                showAI
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
              )}
            >
              <Sparkles size={11} />
              AI Picks
            </button>
            <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
          </>
        )}

        {TAGS.map(tag => {
          const active = selected.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => onToggleTag(tag)}
              className={clsx(
                'flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-all whitespace-nowrap',
                active
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
              )}
            >
              {DIETARY_LABELS[tag]}
            </button>
          );
        })}

        <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

        {/* Filters button */}
        <button
          onClick={() => setPanelOpen(o => !o)}
          className={clsx(
            'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all whitespace-nowrap',
            panelOpen || extraCount > 0
              ? 'bg-violet-600 text-white border-violet-600'
              : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-600'
          )}
        >
          <SlidersHorizontal size={12} />
          Filters
          {extraCount > 0 && (
            <span className="ml-0.5 bg-white/30 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {extraCount}
            </span>
          )}
          <ChevronDown size={11} className={clsx('transition-transform', panelOpen && 'rotate-180')} />
        </button>
      </div>

      {/* Expanded filter panel */}
      {panelOpen && (
        <div className="absolute top-full left-0 right-0 z-50 bg-white border-b border-gray-100 shadow-lg px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Safety level */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Safety Level</p>
              <div className="flex flex-col gap-1.5">
                {([
                  { val: 'all',          label: 'All venues',      desc: 'Show everything' },
                  { val: 'allergy_safe', label: 'Allergy Safe',    desc: 'Dedicated / careful handling' },
                  { val: 'has_options',  label: 'Has Options',     desc: 'Options available, ask staff' },
                ] as const).map(({ val, label, desc }) => (
                  <button
                    key={val}
                    onClick={() => onSafetyFilter(val)}
                    className={clsx(
                      'flex items-start gap-2 px-3 py-2 rounded-lg border text-left transition-all',
                      safetyFilter === val
                        ? 'bg-violet-50 border-violet-300 text-violet-800'
                        : 'bg-gray-50 border-gray-100 text-gray-600 hover:border-violet-200'
                    )}
                  >
                    <span className={clsx('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', {
                      'all': 'bg-gray-400',
                      'allergy_safe': 'bg-green-500',
                      'has_options': 'bg-amber-500',
                    }[val])} />
                    <div>
                      <p className="text-xs font-semibold">{label}</p>
                      <p className="text-xs text-gray-400">{desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Min rating */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Minimum Rating</p>
              <div className="flex flex-col gap-1.5">
                {([null, 3, 4, 4.5] as (number | null)[]).map(r => (
                  <button
                    key={r ?? 'any'}
                    onClick={() => onMinRating(r)}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all',
                      minRating === r
                        ? 'bg-violet-50 border-violet-300 text-violet-800'
                        : 'bg-gray-50 border-gray-100 text-gray-600 hover:border-violet-200'
                    )}
                  >
                    {r === null ? (
                      <span className="text-xs font-semibold">Any rating</span>
                    ) : (
                      <>
                        <span className="flex items-center gap-0.5">
                          {Array.from({ length: 5 }, (_, i) => (
                            <Star key={i} size={10} className={i < Math.floor(r) ? 'fill-amber-400 text-amber-400' : i < r ? 'fill-amber-200 text-amber-200' : 'fill-gray-200 text-gray-200'} />
                          ))}
                        </span>
                        <span className="text-xs font-semibold">{r}+ stars</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Price level */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Price Level</p>
              <div className="flex flex-col gap-1.5">
                {([
                  { val: null, label: 'Any price' },
                  { val: 1,    label: '$ Budget' },
                  { val: 2,    label: '$$ Moderate' },
                  { val: 3,    label: '$$$ Upscale' },
                ] as { val: number | null; label: string }[]).map(({ val, label }) => (
                  <button
                    key={val ?? 'any'}
                    onClick={() => onMaxPrice(val)}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-xs font-semibold',
                      maxPrice === val
                        ? 'bg-violet-50 border-violet-300 text-violet-800'
                        : 'bg-gray-50 border-gray-100 text-gray-600 hover:border-violet-200'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Map style */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center gap-1.5">
                <MapIcon size={11} />
                Map Style
              </p>
              <div className="flex flex-col gap-1.5">
                {(Object.entries(MAP_STYLES) as [MapStyleId, { label: string }][]).map(([id, { label }]) => (
                  <button
                    key={id}
                    onClick={() => onMapStyle(id)}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all text-xs font-semibold',
                      mapStyle === id
                        ? 'bg-violet-50 border-violet-300 text-violet-800'
                        : 'bg-gray-50 border-gray-100 text-gray-600 hover:border-violet-200'
                    )}
                  >
                    <span className={clsx('w-3 h-3 rounded-sm flex-shrink-0', {
                      light: 'bg-gray-100 border border-gray-300',
                      dark: 'bg-gray-800',
                      satellite: 'bg-green-700',
                      streets: 'bg-blue-100 border border-blue-300',
                    }[id])} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Reset button */}
          {extraCount > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <button
                onClick={() => { onSafetyFilter('all'); onMinRating(null); onMaxPrice(null); onMapStyle('light'); }}
                className="text-xs text-violet-600 font-semibold hover:text-violet-800 transition-colors"
              >
                Reset extra filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
