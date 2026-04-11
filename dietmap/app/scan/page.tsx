'use client';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, MapPin, X, ArrowRight, Loader2, AlertCircle, Clock, Trash2, Map as MapIcon, Check, Lock } from 'lucide-react';
import { DietaryTag, DIETARY_LABELS, DIETARY_ICONS, Scan, User } from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import clsx from 'clsx';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const ALL_TAGS: DietaryTag[] = [
  'gluten_free', 'dairy_free', 'vegan', 'vegetarian', 'keto',
  'nut_free', 'soy_free', 'egg_free', 'shellfish_free', 'halal', 'kosher', 'low_fodmap',
];

const SEARCH_NAME_EXAMPLES = [
  'Toronto Vegan 2026',
  'Bali Gluten Free',
  'New York Halal',
  'Tokyo Dairy Free',
  'Paris Kosher Dining',
  'Bangkok Vegan Spots',
  'Sydney Keto Eats',
  'London Coeliac Guide',
];

const LOCATION_EXAMPLES = [
  'Ubud, Bali, Indonesia',
  'Shibuya, Tokyo, Japan',
  'Midtown Manhattan, New York',
  'Le Marais, Paris, France',
  'Sukhumvit, Bangkok, Thailand',
  'Soho, London, UK',
  'Melbourne CBD, Australia',
  'Barcelona, Spain',
  'Trastevere, Rome, Italy',
  'Toronto, Canada',
];

const LOADING_MESSAGES = [
  'Searching for restaurants in your area…',
  'Checking dietary safety information…',
  'Compiling phrase cards and dish guides…',
  'Building your results…',
];

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'text-green-600 bg-green-50 border-green-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low: 'text-red-600 bg-red-50 border-red-200',
};

function ScanForm() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [loadingUser, setLoadingUser] = useState(true);

  // Form state
  const [destination, setDestination] = useState('');
  const [searchName, setSearchName] = useState('');
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedTags, setSelectedTags] = useState<DietaryTag[]>([]);
  const [searchLevels, setSearchLevels] = useState({ high: true, medium: true, low: false });
  const [maxDistanceKm, setMaxDistanceKm] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [error, setError] = useState('');

  const [nameExIdx, setNameExIdx] = useState(0);
  const [nameExVisible, setNameExVisible] = useState(true);
  const [locExIdx, setLocExIdx] = useState(0);
  const [locExVisible, setLocExVisible] = useState(true);

  useEffect(() => {
    const cycle = (setIdx: (fn: (i: number) => number) => void, setVisible: (v: boolean) => void, len: number) => {
      setVisible(false);
      const t = setTimeout(() => {
        setIdx(i => (i + 1) % len);
        setVisible(true);
      }, 350);
      return t;
    };
    const nameId = setInterval(() => cycle(setNameExIdx, setNameExVisible, SEARCH_NAME_EXAMPLES.length), 2800);
    const locId  = setInterval(() => cycle(setLocExIdx,  setLocExVisible,  LOCATION_EXAMPLES.length),  3300);
    return () => { clearInterval(nameId); clearInterval(locId); };
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);
  const newScanIdRef = useRef<string | null>(null);
  const scanItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [glowingScanId, setGlowingScanId] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetch('/api/users/me').then(r => r.json()),
      fetch('/api/scans').then(r => r.json()),
    ]).then(([u, s]) => {
      setUser(u);
      if (Array.isArray(s)) setScans(s);
      // Pre-select dietary profile
      const profile: Record<string, boolean> = u.dietary_profile ?? {};
      const active = Object.entries(profile).filter(([, v]) => v).map(([k]) => k as DietaryTag);
      if (active.length) setSelectedTags(active);
    }).finally(() => setLoadingUser(false));
  }, [session]);

  // Scroll + glow when a new scan is added
  useEffect(() => {
    if (!newScanIdRef.current) return;
    const el = scanItemRefs.current[newScanIdRef.current];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setGlowingScanId(newScanIdRef.current);
      newScanIdRef.current = null;
      setTimeout(() => setGlowingScanId(null), 3000);
    }
  }, [scans]);

  // Payment success message
  const paymentResult = searchParams.get('payment');

  // Cycle loading messages
  useEffect(() => {
    if (!submitting) return;
    const id = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MESSAGES.length), 4500);
    return () => clearInterval(id);
  }, [submitting]);

  // Google Places Autocomplete for destination input
  // Depends on loadingUser so it re-runs once the form (and inputRef) is rendered
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey || !inputRef.current) return;

    function initAC() {
      if (!inputRef.current || !window.google?.maps?.places) return;
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        fields: ['geometry', 'name', 'formatted_address'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (place.geometry?.location) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const name = place.name || place.formatted_address?.split(',').slice(0, 2).join(',').trim() || '';
          setDestination(name);
          setSelectedCoords({ lat, lng });
        }
      });
    }

    if (window.google?.maps?.places) { initAC(); return; }
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      const iv = setInterval(() => { if (window.google?.maps?.places) { clearInterval(iv); initAC(); } }, 200);
      return () => clearInterval(iv);
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = initAC;
    document.head.appendChild(script);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingUser]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const mapPickerContainerRef = useRef<HTMLDivElement>(null);
  const mapPickerRef = useRef<mapboxgl.Map | null>(null);
  const mapMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const deleteScan = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this search? This cannot be undone.')) return;
    setDeletingId(id);
    await fetch(`/api/scans/${id}`, { method: 'DELETE' });
    setScans(s => s.filter(x => x.id !== id));
    setDeletingId(null);
  };

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    setSelectedCoords({ lat, lng });
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) { setDestination(`${lat.toFixed(5)}, ${lng.toFixed(5)}`); return; }
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&types=poi,place,locality,neighborhood&language=en&limit=1`
      );
      const data = await res.json();
      const name = data.features?.[0]?.place_name?.split(',').slice(0, 3).join(',').trim()
        ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      setDestination(name);
    } catch {
      setDestination(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    }
  }, []);

  // Map picker init/cleanup
  useEffect(() => {
    if (!showMapPicker || !mapPickerContainerRef.current || mapPickerRef.current) return;
    mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
    const map = new mapboxgl.Map({
      container: mapPickerContainerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: selectedCoords ? [selectedCoords.lng, selectedCoords.lat] : [104.0, 30.0],
      zoom: selectedCoords ? 13 : 3,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('click', (e) => {
      const { lat, lng } = e.lngLat;
      if (mapMarkerRef.current) {
        mapMarkerRef.current.setLngLat([lng, lat]);
      } else {
        mapMarkerRef.current = new mapboxgl.Marker({ draggable: true, color: '#2563EB' })
          .setLngLat([lng, lat])
          .addTo(map);
        mapMarkerRef.current.on('dragend', () => {
          const pos = mapMarkerRef.current!.getLngLat();
          reverseGeocode(pos.lat, pos.lng);
        });
      }
      reverseGeocode(lat, lng);
    });

    // Place existing marker if coords already set
    if (selectedCoords && !mapMarkerRef.current) {
      mapMarkerRef.current = new mapboxgl.Marker({ draggable: true, color: '#2563EB' })
        .setLngLat([selectedCoords.lng, selectedCoords.lat])
        .addTo(map);
      mapMarkerRef.current.on('dragend', () => {
        const pos = mapMarkerRef.current!.getLngLat();
        reverseGeocode(pos.lat, pos.lng);
      });
    }

    mapPickerRef.current = map;
    return () => {
      map.remove();
      mapPickerRef.current = null;
      mapMarkerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker]);

  const toggleTag = (tag: DietaryTag) => {
    setSelectedTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) { setError('Please enter a location.'); return; }
    if (!selectedTags.length) { setError('Please select at least one dietary requirement.'); return; }
    setError('');
    setSubmitting(true);
    setLoadingMsgIdx(0);

    try {
      // Optimistically add a processing scan to the list immediately
      const tempId = `temp-${Date.now()}`;
      newScanIdRef.current = tempId;
      const optimisticScan: Scan = {
        id: tempId,
        user_id: '',
        destination: destination.trim(),
        trip_name: searchName.trim() || null,
        country: null,
        dietary_tags: selectedTags,
        travel_dates_start: null,
        travel_dates_end: null,
        status: 'processing',
        result_summary: null,
        phrase_cards: [],
        safe_dishes: [],
        danger_foods: [],
        cuisine_notes: null,
        coverage_confidence: null,
        coverage_note: null,
        error_message: null,
        tokens_used: 0,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      setScans(s => [optimisticScan, ...s]);

      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: destination.trim(),
          tripName: searchName.trim() || undefined,
          dietaryTags: selectedTags,
          lat: selectedCoords?.lat,
          lng: selectedCoords?.lng,
          searchLevels,
          maxDistanceKm,
        }),
      });

      let data: Record<string, unknown>;
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        throw new Error(`Server error: ${text.slice(0, 200)}`);
      }

      // Check for 499 client disconnect
      if ((data as { code?: number }).code === 499 || (data as { client_error?: boolean }).client_error) {
        throw new Error('Connection was interrupted — please try again.');
      }

      if (!res.ok) throw new Error((data.error as string) ?? 'Scan failed');

      // Replace temp scan with real one
      setScans(s => s.map(x => x.id === tempId ? { ...optimisticScan, id: data.id as string } : x));
      router.push(`/scan/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  };

  const canScan = user && (user.account_tier === 'pro' || user.scans_remaining > 0);

  if (loadingUser || status === 'loading') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={20} className="text-violet-600" />
          <h1 className="text-2xl font-bold text-gray-900">Smart Search</h1>
        </div>
        <p className="text-sm text-gray-500">AI-powered restaurant research for your dietary needs</p>
      </div>

      {paymentResult === 'success' && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-xl">
          Payment successful! Your scans are ready to use.
        </div>
      )}

      {/* Paywall for free users with no credits */}
      {!canScan ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4 text-center">
          <div className="w-14 h-14 bg-violet-50 rounded-full flex items-center justify-center mx-auto">
            <Sparkles size={24} className="text-violet-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Pro Feature</h2>
            <p className="text-sm text-gray-500">
              Enable Pro in your profile settings to use the AI Area Scanner.
            </p>
          </div>
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
          >
            Go to Profile Settings
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Credits */}
          <div className="flex items-center gap-2 text-sm">
            <span className={clsx(
              'px-2.5 py-1 rounded-full text-xs font-semibold border',
              user?.account_tier === 'pro'
                ? 'bg-violet-50 text-violet-700 border-violet-200'
                : 'bg-gray-50 text-gray-600 border-gray-200'
            )}>
              {user?.account_tier === 'pro'
                ? `✦ Pro — ${user.scans_remaining} credits`
                : `${user?.scans_remaining ?? 0} scans remaining`}
            </span>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Search name */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
            <div>
              <h2 className="font-semibold text-gray-900">Search Name <span className="text-gray-400 font-normal text-xs">(optional)</span></h2>
            </div>
            <input
              type="text"
              value={searchName}
              onChange={e => setSearchName(e.target.value)}
              placeholder="Give your search a name…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            {!searchName && (
              <p className="text-xs text-gray-400 mt-1.5 transition-opacity duration-300" style={{ opacity: nameExVisible ? 1 : 0 }}>
                e.g. <span className="text-gray-400 font-medium">{SEARCH_NAME_EXAMPLES[nameExIdx]}</span>
              </p>
            )}
          </div>

          {/* Location */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Location</h2>
              <button
                type="button"
                onClick={() => setShowMapPicker(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all',
                  showMapPicker
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600'
                )}
              >
                <MapIcon size={11} />
                {showMapPicker ? 'Hide map' : 'Pin on map'}
              </button>
            </div>

            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={destination}
                onChange={e => { setDestination(e.target.value); if (!e.target.value) setSelectedCoords(null); }}
                placeholder="City, neighbourhood, or hotel…"
                required
                className="w-full pl-8 pr-8 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
              {!destination && (
                <p className="text-xs text-gray-400 mt-1.5 transition-opacity duration-300 pl-1" style={{ opacity: locExVisible ? 1 : 0 }}>
                  e.g. <span className="text-gray-400 font-medium">{LOCATION_EXAMPLES[locExIdx]}</span>
                </p>
              )}
              {destination && (
                <button type="button" onClick={() => { setDestination(''); setSelectedCoords(null); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Map picker */}
            {showMapPicker && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">Click anywhere on the map to pin your location. Drag the pin to refine.</p>
                <div ref={mapPickerContainerRef} className="w-full h-56 rounded-xl overflow-hidden border border-gray-200" />
                {selectedCoords && (
                  <p className="text-xs text-violet-600 flex items-center gap-1">
                    <Check size={11} />
                    Pinned: {selectedCoords.lat.toFixed(5)}, {selectedCoords.lng.toFixed(5)}
                    {destination && ` — ${destination}`}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Dietary tags */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <h2 className="font-semibold text-gray-900">Your Dietary Requirements</h2>
            <div className="flex flex-wrap gap-2">
              {ALL_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all',
                    selectedTags.includes(tag)
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                  )}
                >
                  <span>{DIETARY_ICONS[tag]}</span>
                  {DIETARY_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>

          {/* Max distance */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div>
              <h2 className="font-semibold text-gray-900">Search Radius</h2>
              <p className="text-xs text-gray-400 mt-0.5">Maximum distance from your location</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[5, 10, 25, 50].map(km => (
                <button
                  key={km}
                  type="button"
                  onClick={() => setMaxDistanceKm(km)}
                  className={clsx(
                    'px-4 py-2 rounded-xl text-sm font-semibold border transition-all',
                    maxDistanceKm === km
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-600'
                  )}
                >
                  {km} km
                </button>
              ))}
            </div>
          </div>

          {/* Search options */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div>
              <h2 className="font-semibold text-gray-900">Search For</h2>
              <p className="text-xs text-gray-400 mt-0.5">Select which restaurant types to include in results</p>
            </div>
            <div className="flex flex-col gap-2">
              {([
                { key: 'high',   label: 'Allergy Safe',      desc: 'Dedicated options, fully confirmed safe',         border: 'border-green-400',  bg: 'bg-green-50',  text: 'text-green-800',  dot: 'bg-green-500'  },
                { key: 'medium', label: 'Options Available', desc: 'Has options — may need to ask staff',             border: 'border-amber-400',  bg: 'bg-amber-50',  text: 'text-amber-800',  dot: 'bg-amber-500'  },
                { key: 'low',    label: 'Limited Options',   desc: 'Few or no direct options — use as last resort',  border: 'border-red-400',    bg: 'bg-red-50',    text: 'text-red-800',    dot: 'bg-red-500'    },
              ] as const).map(({ key, label, desc, border, bg, text, dot }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={searchLevels[key]}
                    onChange={e => setSearchLevels(s => ({ ...s, [key]: e.target.checked }))}
                    className="rounded border-gray-300 text-violet-600 focus:ring-violet-300"
                  />
                  <span className={clsx('flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-opacity', border, bg, text, !searchLevels[key] && 'opacity-40')}>
                    <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', dot)} />
                    {label}
                  </span>
                  <span className="text-xs text-gray-400 hidden sm:block">{desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {LOADING_MESSAGES[loadingMsgIdx]}
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Scan this area
              </>
            )}
          </button>

          {submitting && (
            <p className="text-center text-xs text-gray-400">
              We're researching your location — we'll open your results when they're ready…
            </p>
          )}
        </form>
      )}

      {/* Past scans */}
      {scans.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-900">My Smart Searches</h2>
          <div className="space-y-2">
            {scans.map(scan => {
              const isTemp = scan.id.startsWith('temp-');
              const displayName = scan.trip_name || scan.destination;
              const showLocation = scan.trip_name && scan.trip_name !== scan.destination;
              const inner = (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-gray-900 truncate">{displayName}</p>
                    {scan.status === 'processing' && (
                      <span className="text-xs text-violet-500 flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Processing
                      </span>
                    )}
                    {scan.status === 'failed' && (
                      <span className="text-xs text-red-500">Failed</span>
                    )}
                  </div>
                  {showLocation && (
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                      <MapPin size={10} />
                      {scan.destination}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(scan.created_at).toLocaleDateString()}
                    </span>
                    {(scan.restaurant_count ?? 0) > 0 && (
                      <span className="text-xs text-gray-400">
                        · {scan.restaurant_count} restaurant{scan.restaurant_count !== 1 ? 's' : ''}
                      </span>
                    )}
                    {scan.coverage_confidence && (
                      <span className={clsx(
                        'text-xs px-1.5 py-0.5 rounded-full border',
                        CONFIDENCE_COLORS[scan.coverage_confidence] ?? 'text-gray-500 bg-gray-50 border-gray-200'
                      )}>
                        {{ high: 'Great options', medium: 'Some options', low: 'Fewer options' }[scan.coverage_confidence] ?? scan.coverage_confidence}
                      </span>
                    )}
                  </div>
                  {scan.dietary_tags?.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {scan.dietary_tags.map(t => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')}
                    </p>
                  )}
                </div>
              );
              const isGlowing = glowingScanId === scan.id;
              const isLocked = !canScan && !isTemp;
              return (
                <div key={scan.id} className="relative group" ref={el => { scanItemRefs.current[scan.id] = el; }}>
                  {isTemp ? (
                    <div className={clsx(
                      'flex items-center justify-between bg-white rounded-xl border px-4 py-3 pr-10 opacity-70 cursor-default transition-all duration-500',
                      isGlowing ? 'border-violet-400 ring-2 ring-violet-200 shadow-[0_0_0_4px_rgba(139,92,246,0.15)]' : 'border-gray-100'
                    )}>
                      {inner}
                    </div>
                  ) : isLocked ? (
                    <div className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 pr-10 opacity-50 cursor-not-allowed select-none">
                      <div className="min-w-0 flex-1 blur-[2px]">{inner}</div>
                      <Lock size={14} className="text-gray-400 ml-2 flex-shrink-0" />
                    </div>
                  ) : (
                    <Link
                      href={`/scan/${scan.id}`}
                      className={clsx(
                        'flex items-center justify-between bg-white rounded-xl border px-4 py-3 hover:border-violet-200 hover:shadow-sm transition-all pr-10',
                        isGlowing ? 'border-violet-400 ring-2 ring-violet-200 shadow-[0_0_0_4px_rgba(139,92,246,0.15)]' : 'border-gray-100'
                      )}
                    >
                      {inner}
                    </Link>
                  )}
                  {!isTemp && !isLocked && (
                    <button
                      onClick={e => deleteScan(e, scan.id)}
                      disabled={deletingId === scan.id}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                      title="Delete search"
                    >
                      {deletingId === scan.id
                        ? <Loader2 size={13} className="animate-spin" />
                        : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScanPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading…</div>}>
        <ScanForm />
      </Suspense>
    </div>
  );
}
