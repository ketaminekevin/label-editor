'use client';
import dynamic from 'next/dynamic';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Restaurant, DietaryTag, formatDistance, List } from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import { FilterBar } from '@/components/FilterBar';
import { RestaurantCard } from '@/components/RestaurantCard';
import { RestaurantPanel } from '@/components/RestaurantPanel';
import { ChevronRight, ChevronLeft, X, MapPin } from 'lucide-react';
import clsx from 'clsx';

const Map = dynamic(() => import('@/components/Map').then(m => ({ default: m.Map })), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-gray-100 animate-pulse" />,
});

const RADIUS_OPTIONS = [5, 10, 25, 50];

export default function HomePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<DietaryTag[]>([]);
  const [filtersInitialised, setFiltersInitialised] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [showAI, setShowAI] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<string>('');

  // Lists
  const [lists, setLists] = useState<List[]>([]);

  // Unified search state
  const [searchQuery, setSearchQuery] = useState('');
  const [locationPinned, setLocationPinned] = useState(false); // true when a geocoded location is selected
  const [locationSuggestions, setLocationSuggestions] = useState<{ place_name: string; center: [number, number] }[]>([]);
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
  const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
  const [fixedCenter, setFixedCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [flyToTarget, setFlyToTarget] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [useMiles, setUseMiles] = useState(false);
  useEffect(() => {
    setUseMiles(localStorage.getItem('dietmap_use_miles') === '1');
  }, []);

  // Open a restaurant directly when navigating from the lists page
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const restaurantId = params.get('restaurant');
    const lat = parseFloat(params.get('lat') ?? '');
    const lng = parseFloat(params.get('lng') ?? '');
    if (restaurantId) {
      setSelectedRestaurantId(restaurantId);
      if (!isNaN(lat) && !isNaN(lng)) {
        setFlyToTarget({ lat, lng, zoom: 15 });
      }
    }
  }, []);

  // Auto-select user's dietary restrictions from profile
  useEffect(() => {
    if (!session || filtersInitialised) return;
    fetch('/api/users/me')
      .then(r => r.json())
      .then(user => {
        const profile: Record<string, boolean> = user.dietary_profile ?? {};
        const active = Object.entries(profile)
          .filter(([, v]) => v)
          .map(([k]) => k as DietaryTag);
        if (active.length) setSelectedFilters(active);
        if (user.account_tier === 'pro') setIsPro(true);
        setFiltersInitialised(true);
      })
      .catch(() => setFiltersInitialised(true));
  }, [session, filtersInitialised]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/lists')
      .then(r => r.json())
      .then((data: List[]) => { if (Array.isArray(data)) setLists(data); })
      .catch(() => {});
  }, [session]);

  const restaurantListColor = useMemo(() => {
    const map: Record<string, string> = {};
    lists.forEach(list => {
      (list.restaurant_ids ?? []).forEach(rid => {
        if (!map[rid]) map[rid] = list.color;
      });
    });
    return map;
  }, [lists]);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) { setLocationSuggestions([]); return; }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&types=place,address,poi&limit=5`
      );
      const data = await res.json();
      setLocationSuggestions(data.features?.map((f: { place_name: string; center: [number, number] }) => ({
        place_name: f.place_name,
        center: f.center,
      })) ?? []);
    } catch {
      setLocationSuggestions([]);
    }
  }, []);

  const onSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    setLocationPinned(false); // typing clears pinned state
    setLocationDropdownOpen(true);
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    suggestDebounceRef.current = setTimeout(() => fetchSuggestions(val), 280);
  };

  const selectLocation = (suggestion: { place_name: string; center: [number, number] }) => {
    const [lng, lat] = suggestion.center;
    setSearchQuery(suggestion.place_name.split(',')[0]);
    setLocationPinned(true);
    setLocationDropdownOpen(false);
    setLocationSuggestions([]);
    setFixedCenter({ lat, lng });
    setFlyToTarget({ lat, lng, zoom: 13 });
    lastFetchRef.current = '';
    const radius = selectedRadius ?? 10;
    setSelectedRadius(radius);
    const bbox = bboxFromCenter(lat, lng, radius);
    fetchRestaurantsAt(bbox.swLat, bbox.swLng, bbox.neLat, bbox.neLng);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setLocationPinned(false);
    setFixedCenter(null);
    setSelectedRadius(null);
    setLocationSuggestions([]);
    lastFetchRef.current = '';
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        searchInputRef.current && !searchInputRef.current.contains(e.target as Node) &&
        suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)
      ) setLocationDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Compute a bbox from a centre point + radius in km
  const bboxFromCenter = useCallback((lat: number, lng: number, radiusKm: number) => {
    const latDeg = radiusKm / 111;
    const lngDeg = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
    return { swLat: lat - latDeg, swLng: lng - lngDeg, neLat: lat + latDeg, neLng: lng + lngDeg };
  }, []);

  const fetchRestaurantsAt = useCallback(async (swLat: number, swLng: number, neLat: number, neLng: number) => {
    const key = `${swLat.toFixed(2)},${swLng.toFixed(2)},${neLat.toFixed(2)},${neLng.toFixed(2)}`;
    if (key === lastFetchRef.current) return;
    lastFetchRef.current = key;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        swLat: swLat.toString(), swLng: swLng.toString(),
        neLat: neLat.toString(), neLng: neLng.toString(),
      });
      const res = await fetch(`/api/restaurants?${params}`);
      const data = await res.json();
      setRestaurants(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  // onMapMove passes viewport bounds directly — always fetch what's visible
  const fetchRestaurants = useCallback(async (swLat: number, swLng: number, neLat: number, neLng: number) => {
    await fetchRestaurantsAt(swLat, swLng, neLat, neLng);
  }, [fetchRestaurantsAt]);

  const onRadiusChange = (km: number) => {
    setSelectedRadius(km);
    lastFetchRef.current = '';
    if (fixedCenter) {
      const bbox = bboxFromCenter(fixedCenter.lat, fixedCenter.lng, km);
      fetchRestaurantsAt(bbox.swLat, bbox.swLng, bbox.neLat, bbox.neLng);
    }
  };

  const toggleTag = useCallback((tag: DietaryTag) => {
    setSelectedFilters(f => f.includes(tag) ? f.filter(t => t !== tag) : [...f, tag]);
  }, []);

  const handleRestaurantClick = useCallback((r: Restaurant) => {
    setSelectedRestaurantId(r.id);
  }, []);

  const handleAddClick = useCallback((lat: number, lng: number) => {
    router.push(`/add?lat=${lat}&lng=${lng}`);
  }, [router]);

  // Normalize text: remove accents + lowercase so "cafe" matches "Café"
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // Name filter: only when no location is pinned
  const nameFiltered = (locationPinned || !searchQuery)
    ? restaurants
    : restaurants.filter(r => norm(r.name).includes(norm(searchQuery)));

  // Map gets all restaurants (apply AI filter for pro users)
  const mapRestaurants = useMemo(() => {
    const base = (isPro && !showAI)
      ? nameFiltered.filter(r => r.source !== 'area_scan')
      : nameFiltered;
    return [...base].sort((a, b) => (Number(b.avg_rating) || 0) - (Number(a.avg_rating) || 0));
  }, [nameFiltered, isPro, showAI]);

  // Sidebar shows only dietary-matching restaurants
  const sorted = useMemo(() =>
    selectedFilters.length === 0
      ? mapRestaurants
      : mapRestaurants.filter(r =>
          selectedFilters.some(tag => (r.dietary_tags ?? []).some(dt => dt.tag === tag))
        ),
    [mapRestaurants, selectedFilters]
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar />

      <FilterBar
        selected={selectedFilters}
        onToggleTag={toggleTag}
        isPro={isPro}
        showAI={showAI}
        onToggleAI={() => setShowAI(v => !v)}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div className={clsx(
          'relative flex-shrink-0 bg-white border-r border-gray-100 flex flex-col',
          'transition-all duration-300 overflow-hidden',
          sidebarOpen ? 'w-72' : 'w-0'
        )}>
          {sidebarOpen && (
            <div className="flex flex-col h-full w-72">
              <div className="p-3 border-b border-gray-100 space-y-2">

                {/* Unified search */}
                <div className="relative">
                  <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search restaurants or locations…"
                    value={searchQuery}
                    onChange={onSearchInput}
                    onFocus={() => !locationPinned && searchQuery.length >= 2 && setLocationDropdownOpen(true)}
                    className="w-full pl-8 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  {searchQuery && (
                    <button onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X size={13} />
                    </button>
                  )}
                  {locationDropdownOpen && locationSuggestions.length > 0 && (
                    <div ref={suggestionsRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
                      {locationSuggestions.map((s, i) => (
                        <button
                          key={i}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); selectLocation(s); }}
                          className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-800 transition-colors flex items-start gap-2 border-b border-gray-50 last:border-0"
                        >
                          <MapPin size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                          <span className="line-clamp-1">{s.place_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Radius — only shown when a location is pinned */}
                {fixedCenter && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 font-medium flex-shrink-0">Radius:</span>
                    <div className="flex gap-1 flex-1">
                      {RADIUS_OPTIONS.map(km => (
                        <button
                          key={km}
                          onClick={() => onRadiusChange(km)}
                          className={clsx(
                            'flex-1 py-1 text-xs font-semibold rounded-lg border transition-all',
                            selectedRadius === km
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
                          )}
                        >
                          {formatDistance(km, useMiles)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {fixedCenter && (
                  <p className="text-xs text-blue-600 flex items-center gap-1">
                    <MapPin size={10} />
                    Within {formatDistance(selectedRadius ?? 10, useMiles)} of {searchQuery || 'selected location'}
                  </p>
                )}

                <p className="text-xs text-gray-400 uppercase tracking-wide pt-0.5">
                  {loading ? 'Loading…' : `${sorted.length} restaurant${sorted.length !== 1 ? 's' : ''} in view`}
                </p>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {sorted.length === 0 && !loading && (
                  <div className="text-center py-12 text-gray-400">
                    <div className="text-3xl mb-2">🍽️</div>
                    <p className="text-sm font-medium text-gray-500">No restaurants found</p>
                    <p className="text-xs mt-1">Try adjusting filters or searching a location</p>
                  </div>
                )}
                {sorted.map(r => (
                  <RestaurantCard
                    key={r.id}
                    restaurant={r}
                    compact
                    onClick={() => {
                      setSelectedRestaurantId(r.id);
                      setFlyToTarget({ lat: r.lat, lng: r.lng, zoom: 16 });
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className={clsx(
            'absolute z-20 top-1/2 -translate-y-1/2 w-5 h-12',
            'bg-white border border-gray-200 rounded-r-lg shadow-sm',
            'flex items-center justify-center text-gray-400 hover:text-gray-600',
            'transition-all duration-300',
            sidebarOpen ? 'left-72' : 'left-0'
          )}
        >
          {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
        </button>

        {/* Map */}
        <div className="flex-1 relative">
          <Map
            restaurants={mapRestaurants}
            selectedFilters={selectedFilters}
            onMapMove={fetchRestaurants}
            onRestaurantClick={handleRestaurantClick}
            onAddClick={handleAddClick}
            flyToTarget={flyToTarget}
            restaurantListColor={restaurantListColor}
            selectedRestaurantId={selectedRestaurantId}
          />

          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur text-xs text-gray-500 px-3 py-1.5 rounded-full border border-gray-100 pointer-events-none"
            style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}
          >
            Right-click map to add a restaurant
          </div>

          {/* Restaurant slide-out panel */}
          <RestaurantPanel
            restaurantId={selectedRestaurantId}
            onClose={() => setSelectedRestaurantId(null)}
          />
        </div>
      </div>
    </div>
  );
}
