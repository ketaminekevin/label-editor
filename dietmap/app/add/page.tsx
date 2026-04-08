'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ArrowLeft, X, MapPin, Search, Star, Camera } from 'lucide-react';
import { DietaryTag, DIETARY_LABELS, DIETARY_ICONS, ReviewDietarySafety } from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import clsx from 'clsx';

// ── Cuisine list ──────────────────────────────────────────────────────────────
const CUISINE_LIST = [
  'American', 'Australian', 'Argentine', 'Asian Fusion', 'Bakery',
  'Banh Mi', 'BBQ', 'Brazilian', 'Breakfast & Brunch', 'British',
  'Buffet', 'Burgers', 'Cajun & Creole', 'Cambodian', 'Caribbean',
  'Chinese', 'Café', 'Cantonese', 'Contemporary', 'Cuban',
  'Curry', 'Deli', 'Desserts & Sweets', 'Dim Sum', 'Dumplings',
  'Ethiopian', 'Farm to Table', 'Falafel', 'Filipino', 'Fine Dining',
  'Fish & Chips', 'Food Truck', 'French', 'Fusion', 'German',
  'Greek', 'Gluten-Free', 'Hawaiian', 'Healthy', 'Hong Kong',
  'Ice Cream', 'Indian', 'Indonesian', 'Israeli', 'Italian',
  'Izakaya', 'Japanese', 'Kebab', 'Keto', 'Korean',
  'Lebanese', 'Malaysian', 'Mediterranean', 'Mexican', 'Middle Eastern',
  'Modern Australian', 'Modern European', 'Moroccan', 'Noodles', 'New Nordic',
  'Omakase', 'Organic', 'Oysters', 'Paleo', 'Pakistani',
  'Pasta', 'Peruvian', 'Pho', 'Pizza', 'Pub Food',
  'Ramen', 'Raw Food', 'Salads', 'Sandwiches', 'Seafood',
  'Sichuan', 'Singaporean', 'Smoothies & Bowls', 'Soba', 'Soul Food',
  'Southern', 'Spanish', 'Sri Lankan', 'Steak', 'Sushi',
  'Szechuan', 'Taiwanese', 'Tacos & Burritos', 'Tapas', 'Teppanyaki',
  'Tex-Mex', 'Thai', 'Turkish', 'Udon', 'Vegan',
  'Vegetarian', 'Vietnamese', 'West African', 'Wings', 'Wraps',
];

const ALL_TAGS: DietaryTag[] = [
  'gluten_free', 'dairy_free', 'vegan', 'vegetarian', 'keto',
  'nut_free', 'soy_free', 'egg_free', 'shellfish_free', 'halal', 'kosher', 'low_fodmap',
];

// ── Image compression ─────────────────────────────────────────────────────────
async function compressImage(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const MAX = 900;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round((height / width) * MAX); width = MAX; }
          else { width = Math.round((width / height) * MAX); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── StarPicker ────────────────────────────────────────────────────────────────
function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-1">
      {[1,2,3,4,5].map(n => (
        <Star
          key={n}
          size={22}
          onClick={() => onChange(n)}
          className={clsx(
            'cursor-pointer hover:scale-110 transition-transform',
            n <= value ? 'text-amber-500 fill-amber-500' : 'text-gray-200 fill-gray-200'
          )}
        />
      ))}
    </span>
  );
}

// ── Cuisine tag autocomplete ──────────────────────────────────────────────────
function CuisineSelector({ selected, onAdd, onRemove }: {
  selected: string[]; onAdd: (c: string) => void; onRemove: (c: string) => void;
}) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const suggestions = CUISINE_LIST.filter(c =>
    norm(c).includes(norm(input)) && !selected.includes(c)
  ).slice(0, 8);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const commit = (value: string) => {
    const v = value.trim();
    if (!v || selected.includes(v)) return;
    onAdd(v); setInput(''); setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map(c => (
            <span key={c} className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium rounded-full">
              {c}
              <button type="button" onClick={() => onRemove(c)} className="hover:text-blue-600 ml-0.5"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) commit(suggestions[0]); else commit(input); }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="e.g. Italian, Vegan, Sushi…"
          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>
      {open && (input.length > 0 || suggestions.length > 0) && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
          {suggestions.map(c => (
            <button key={c} type="button" onMouseDown={e => { e.preventDefault(); commit(c); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-800 transition-colors">
              {c}
            </button>
          ))}
          {input.trim() && !CUISINE_LIST.some(c => norm(c) === norm(input.trim())) && (
            <button type="button" onMouseDown={e => { e.preventDefault(); commit(input); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 border-t border-gray-50 italic">
              Add &quot;{input.trim()}&quot;
            </button>
          )}
          {suggestions.length === 0 && !input.trim() && (
            <p className="px-3 py-2 text-xs text-gray-400">Start typing to search cuisine types…</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────
function AddForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();

  const initLat = searchParams.get('lat');
  const initLng = searchParams.get('lng');
  const fromMap = !!initLat && !!initLng;

  const [name, setName] = useState('');
  const [lat, setLat] = useState(initLat ?? '');
  const [lng, setLng] = useState(initLng ?? '');
  const [locationReady, setLocationReady] = useState(fromMap);
  const [website, setWebsite] = useState('');
  const [priceLevel, setPriceLevel] = useState('');
  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([]);

  // Dietary & review
  const [selectedTags, setSelectedTags] = useState<DietaryTag[]>([]);
  const [dietarySafety, setDietarySafety] = useState<ReviewDietarySafety[]>([]);
  const [tagNotes, setTagNotes] = useState<Record<string, string>>({});

  // Review
  const [overallRating, setOverallRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const addressRef = useRef<HTMLInputElement>(null);

  // Reverse geocode lat/lng from map pin to get real address
  useEffect(() => {
    if (!fromMap || !initLat || !initLng) return;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${initLng},${initLat}.json?access_token=${token}&types=address,neighborhood,place&limit=1`
    )
      .then(r => r.json())
      .then(data => {
        const place = data.features?.[0];
        if (place?.place_name && addressRef.current) {
          addressRef.current.value = place.place_name;
        }
      })
      .catch(() => { /* non-fatal, fallback to coordinates already shown */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Google Places autocomplete
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey || typeof window === 'undefined') return;

    function initAC() {
      if (!addressRef.current || !window.google?.maps?.places) return;
      const ac = new window.google.maps.places.Autocomplete(addressRef.current, {
        types: ['establishment', 'geocode'],
        fields: ['formatted_address', 'geometry', 'name'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (place.geometry?.location) {
          setLat(place.geometry.location.lat().toString());
          setLng(place.geometry.location.lng().toString());
          setLocationReady(true);
          if (!name && place.name) setName(place.name);
        }
      });
    }

    if (window.google?.maps?.places) { initAC(); return; }
    if (document.querySelector(`script[src*="maps.googleapis.com"]`)) {
      const interval = setInterval(() => {
        if (window.google?.maps?.places) { clearInterval(interval); initAC(); }
      }, 200);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = initAC;
    document.head.appendChild(script);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTag = (tag: DietaryTag) => {
    setSelectedTags(t => {
      if (t.includes(tag)) {
        setDietarySafety(s => s.filter(x => x.tag !== tag));
        setTagNotes(n => { const next = { ...n }; delete next[tag]; return next; });
        return t.filter(x => x !== tag);
      }
      return [...t, tag];
    });
  };

  const getSafety = (tag: DietaryTag): ReviewDietarySafety =>
    dietarySafety.find(x => x.tag === tag) ?? { tag, star_rating: null, is_dedicated: false };

  const setSafetyField = (tag: DietaryTag, field: 'star_rating' | 'is_dedicated', value: number | null | boolean) => {
    setDietarySafety(s => {
      const existing = s.find(x => x.tag === tag);
      if (existing) return s.map(x => x.tag === tag ? { ...x, [field]: value } : x);
      return [...s, { tag, star_rating: null, is_dedicated: false, [field]: value }];
    });
  };

  const handlePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 4 - photos.length);
    const compressed = await Promise.all(files.map(compressImage));
    setPhotos(p => [...p, ...compressed]);
    e.target.value = '';
  };

  if (!session) {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-gray-600">You need to be logged in to add restaurants.</p>
        <Link href="/login" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold">Log In</Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const addressValue = addressRef.current?.value ?? '';
    if (!name || !addressValue) { setError('Restaurant name and address are required.'); return; }
    if (!locationReady || !lat || !lng) { setError('Please select an address from the dropdown to confirm the location.'); return; }
    if (!reviewBody.trim()) { setError('Please write a short review of your experience.'); return; }

    setSubmitting(true);
    try {
      // 1. Create restaurant
      const res = await fetch('/api/restaurants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address: addressValue,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          website: website || undefined,
          price_level: priceLevel ? parseInt(priceLevel) : undefined,
          cuisine_type: selectedCuisines,
          dietary_tags: selectedTags.map(tag => ({
            tag,
            safety_level: 'has_options',
            notes: tagNotes[tag] || '',
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to add restaurant');

      // 2. Post review (always, since we require body)
      await fetch(`/api/restaurants/${data.id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: overallRating,
          body: reviewBody.trim(),
          dietary_context: selectedTags,
          dietary_safety: dietarySafety,
          photos,
        }),
      });

      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow">
          <ArrowLeft size={14} className="text-gray-600" />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Add a Restaurant</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">{error}</div>
      )}

      {/* Basic info */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
        <h2 className="font-semibold text-gray-800">Restaurant Information</h2>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Restaurant Name *</label>
          <input
            required type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. The Green Fork"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Address *</label>
          <div className="relative">
            <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none z-10" />
            <input
              ref={addressRef}
              type="text"
              required
              defaultValue={fromMap ? `Pin dropped at ${parseFloat(initLat!).toFixed(5)}, ${parseFloat(initLng!).toFixed(5)}` : ''}
              onChange={() => setLocationReady(false)}
              placeholder="Search for restaurant or address"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          {locationReady ? (
            <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" /> Location confirmed
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">Select an address from the dropdown to confirm location</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
            <input
              type="url" value={website} onChange={e => setWebsite(e.target.value)}
              placeholder="https://…"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Price Level</label>
            <select
              value={priceLevel} onChange={e => setPriceLevel(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">Select</option>
              <option value="1">$ Budget</option>
              <option value="2">$$ Moderate</option>
              <option value="3">$$$ Upscale</option>
              <option value="4">$$$$ Fine Dining</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cuisine Types</label>
          <CuisineSelector
            selected={selectedCuisines}
            onAdd={c => setSelectedCuisines(p => [...p, c])}
            onRemove={c => setSelectedCuisines(p => p.filter(x => x !== c))}
          />
        </div>
      </div>

      {/* Dietary options + allergy safety (combined) */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-800">Dietary Options</h2>
          <p className="text-xs text-gray-500 mt-0.5">Select what this restaurant caters to, then rate how safely they handled each restriction.</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ALL_TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={clsx(
                'text-sm px-3 py-1.5 rounded-full border transition-all',
                selectedTags.includes(tag)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              )}
            >
              {DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}
            </button>
          ))}
        </div>

        {selectedTags.length > 0 && (
          <div className="space-y-3 pt-1">
            {selectedTags.map(tag => {
              const s = getSafety(tag);
              return (
                <div key={tag} className="border border-gray-100 rounded-xl p-3 space-y-2.5">
                  <p className="text-sm font-semibold text-gray-800">{DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}</p>

                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">Allergy Safety</p>
                    <div className="flex items-center gap-3">
                      <StarPicker
                        value={s.star_rating ?? 0}
                        onChange={v => setSafetyField(tag, 'star_rating', v)}
                      />
                      <button
                        type="button"
                        onClick={() => setSafetyField(tag, 'star_rating', null)}
                        className={clsx(
                          'text-xs px-2 py-1 rounded-lg border transition-colors',
                          s.star_rating == null
                            ? 'bg-gray-100 text-gray-500 border-gray-300'
                            : 'bg-white text-gray-300 border-gray-200 hover:text-gray-500'
                        )}
                      >
                        Unsure
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={s.is_dedicated}
                      onChange={e => setSafetyField(tag, 'is_dedicated', e.target.checked)}
                      className="rounded border-gray-300 text-blue-600"
                    />
                    <span className="text-xs text-gray-600">Mark as dedicated {DIETARY_LABELS[tag].toLowerCase()} location</span>
                  </label>

                  <div>
                    <label className="text-xs font-medium text-gray-500 block mb-1">Notes (optional)</label>
                    <input
                      type="text"
                      value={tagNotes[tag] ?? ''}
                      onChange={e => setTagNotes(n => ({ ...n, [tag]: e.target.value }))}
                      placeholder="e.g. Separate fryer, ask staff to confirm"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Your Review */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-800">Your Review</h2>
          <p className="text-xs text-gray-500 mt-0.5">Share your experience visiting this restaurant.</p>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1.5">Overall Rating</label>
          <StarPicker value={overallRating} onChange={setOverallRating} />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Your Experience *</label>
          <textarea
            value={reviewBody}
            onChange={e => setReviewBody(e.target.value)}
            placeholder="Describe your experience, especially around dietary safety…"
            rows={4}
            required
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Photos */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-xs font-medium text-gray-600">Photos ({photos.length}/4)</label>
            {photos.length < 4 && (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Camera size={12} /> Add photo
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handlePhotos} />
          </div>
          {photos.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-100" />
                  <button type="button" onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Add Restaurant & Submit Review'}
      </button>
    </form>
  );
}

export default function AddPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading…</div>}>
        <AddForm />
      </Suspense>
    </div>
  );
}
