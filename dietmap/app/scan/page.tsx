'use client';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, MapPin, Calendar, Search, X, ArrowRight, Loader2, AlertCircle, Clock, Trash2, Map as MapIcon, Check } from 'lucide-react';
import { DietaryTag, DIETARY_LABELS, DIETARY_ICONS, Scan, User } from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import clsx from 'clsx';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const ALL_TAGS: DietaryTag[] = [
  'gluten_free', 'dairy_free', 'vegan', 'vegetarian', 'keto',
  'nut_free', 'soy_free', 'egg_free', 'shellfish_free', 'halal', 'kosher', 'low_fodmap',
];

const LOADING_MESSAGES = [
  'Searching for restaurants in your destination…',
  'Checking dietary safety information…',
  'Compiling phrase cards and dish guides…',
  'Building your trip guide…',
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
  const [tripName, setTripName] = useState('');
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedTags, setSelectedTags] = useState<DietaryTag[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [error, setError] = useState('');

  // Location suggestions
  const [suggestions, setSuggestions] = useState<{ place_name: string; center: [number, number] }[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Payment success message
  const paymentResult = searchParams.get('payment');

  // Cycle loading messages
  useEffect(() => {
    if (!submitting) return;
    const id = setInterval(() => setLoadingMsgIdx(i => (i + 1) % LOADING_MESSAGES.length), 4500);
    return () => clearInterval(id);
  }, [submitting]);

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        suggestRef.current && !suggestRef.current.contains(e.target as Node)
      ) setSuggestOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&types=poi,place,locality,neighborhood&language=en&limit=6`
      );
      const data = await res.json();
      setSuggestions(data.features?.map((f: { place_name: string; center: [number, number] }) => ({
        place_name: f.place_name, center: f.center,
      })) ?? []);
    } catch { setSuggestions([]); }
  };

  const onDestinationInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDestination(e.target.value);
    setSelectedCoords(null); // clear coords when user types manually
    setSuggestOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(e.target.value), 280);
  };

  const selectSuggestion = (s: { place_name: string; center: [number, number] }) => {
    setDestination(s.place_name.split(',').slice(0, 2).join(',').trim());
    setSelectedCoords({ lat: s.center[1], lng: s.center[0] });
    setSuggestions([]);
    setSuggestOpen(false);
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const mapPickerContainerRef = useRef<HTMLDivElement>(null);
  const mapPickerRef = useRef<mapboxgl.Map | null>(null);
  const mapMarkerRef = useRef<mapboxgl.Marker | null>(null);

  const deleteScan = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this trip? This cannot be undone.')) return;
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
    if (!destination.trim()) { setError('Please enter a destination.'); return; }
    if (!selectedTags.length) { setError('Please select at least one dietary requirement.'); return; }
    setError('');
    setSubmitting(true);
    setLoadingMsgIdx(0);

    try {
      // Optimistically add a processing scan to the list immediately
      const tempId = `temp-${Date.now()}`;
      const optimisticScan: Scan = {
        id: tempId,
        user_id: '',
        destination: destination.trim(),
        country: null,
        dietary_tags: selectedTags,
        travel_dates_start: startDate || null,
        travel_dates_end: endDate || null,
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
          tripName: tripName.trim() || undefined,
          dietaryTags: selectedTags,
          lat: selectedCoords?.lat,
          lng: selectedCoords?.lng,
          travelDatesStart: startDate || undefined,
          travelDatesEnd: endDate || undefined,
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
          <Sparkles size={20} className="text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Plan a Trip</h1>
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
          <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center mx-auto">
            <Sparkles size={24} className="text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Pro Feature</h2>
            <p className="text-sm text-gray-500">
              Enable Pro in your profile settings to use the AI Area Scanner.
            </p>
          </div>
          <Link
            href="/profile"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
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
                ? 'bg-blue-50 text-blue-700 border-blue-200'
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

          {/* Trip name */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-2">
            <div>
              <h2 className="font-semibold text-gray-900">Trip Name <span className="text-gray-400 font-normal text-xs">(optional)</span></h2>
            </div>
            <input
              type="text"
              value={tripName}
              onChange={e => setTripName(e.target.value)}
              placeholder="e.g. Bali Holiday 2025"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>

          {/* Destination */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Destination</h2>
              <button
                type="button"
                onClick={() => setShowMapPicker(v => !v)}
                className={clsx(
                  'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-all',
                  showMapPicker
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600'
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
                onChange={onDestinationInput}
                onFocus={() => suggestions.length && setSuggestOpen(true)}
                placeholder="e.g. Tianhe Marriott Hotel — Chongqing — Bali"
                required
                className="w-full pl-8 pr-8 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              {destination && (
                <button type="button" onClick={() => { setDestination(''); setSelectedCoords(null); setSuggestions([]); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={13} />
                </button>
              )}
              {suggestOpen && suggestions.length > 0 && (
                <div ref={suggestRef} className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                      className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-blue-50 flex items-start gap-2 border-b border-gray-50 last:border-0"
                    >
                      <Search size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                      {s.place_name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Map picker */}
            {showMapPicker && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">Click anywhere on the map to pin your location. Drag the pin to refine.</p>
                <div ref={mapPickerContainerRef} className="w-full h-56 rounded-xl overflow-hidden border border-gray-200" />
                {selectedCoords && (
                  <p className="text-xs text-blue-600 flex items-center gap-1">
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
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  )}
                >
                  <span>{DIETARY_ICONS[tag]}</span>
                  {DIETARY_LABELS[tag]}
                </button>
              ))}
            </div>
          </div>

          {/* Travel dates (optional) */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
            <div>
              <h2 className="font-semibold text-gray-900">Travel Dates</h2>
              <p className="text-xs text-gray-400 mt-0.5">Optional — helps with seasonal recommendations</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  <Calendar size={11} className="inline mr-1" />From
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1">
                  <Calendar size={11} className="inline mr-1" />To
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
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
              This may take 15–30 seconds while AI researches your destination…
            </p>
          )}
        </form>
      )}

      {/* Past scans */}
      {scans.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-gray-900">Past Trips</h2>
          <div className="space-y-2">
            {scans.map(scan => (
              <div key={scan.id} className="relative group">
                <Link
                  href={`/scan/${scan.id}`}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 hover:border-blue-200 hover:shadow-sm transition-all pr-10"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">{scan.destination}</p>
                      {scan.status === 'processing' && (
                        <span className="text-xs text-blue-500 flex items-center gap-1">
                          <Loader2 size={10} className="animate-spin" /> Processing
                        </span>
                      )}
                      {scan.status === 'failed' && (
                        <span className="text-xs text-red-500">Failed</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
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
                          {scan.coverage_confidence} coverage
                        </span>
                      )}
                    </div>
                    {scan.dietary_tags?.length > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {scan.dietary_tags.map(t => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')}
                      </p>
                    )}
                  </div>
                </Link>
                <button
                  onClick={e => deleteScan(e, scan.id)}
                  disabled={deletingId === scan.id}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-40"
                  title="Delete trip"
                >
                  {deletingId === scan.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Trash2 size={13} />}
                </button>
              </div>
            ))}
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
