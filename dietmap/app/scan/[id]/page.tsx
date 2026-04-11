'use client';
import { use, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, MapPin, Globe, AlertTriangle,
  CheckCircle, Sparkles, Star, Loader2, MessageSquare, Phone,
} from 'lucide-react';
import {
  Scan, ScanRestaurant, PhraseCard, SafeDish, DangerFood,
  DietaryTag, DIETARY_LABELS,
} from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import { ExpandablePhotoStrip } from '@/components/ExpandablePhotoStrip';
import clsx from 'clsx';

const ScanMap = dynamic(
  () => import('@/components/ScanMap').then(m => ({ default: m.ScanMap })),
  { ssr: false, loading: () => <div className="w-full h-[280px] bg-gray-100 rounded-xl animate-pulse mb-4" /> }
);

const CONFIDENCE_STARS: Record<string, number> = { high: 5, medium: 3, low: 1 };

const RESCAN_MESSAGES = [
  'Searching for more restaurants…',
  'Checking dietary safety information…',
  'Cross-referencing new results…',
  'Adding new finds to your list…',
];

function StarRow({ filled, total = 5, color = 'amber', label }: {
  filled: number; total?: number; color?: 'amber' | 'blue'; label?: string;
}) {
  const cls = color === 'blue' ? 'fill-violet-400 text-violet-400' : 'fill-amber-400 text-amber-400';
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <Star key={i} size={10} className={i < filled ? cls : 'fill-gray-200 text-gray-200'} />
      ))}
      {label && <span className="text-xs text-gray-400 ml-1">{label}</span>}
    </div>
  );
}

const COVERAGE_STARS: Record<string, number> = { high: 5, medium: 3, low: 1 };
const COVERAGE_LABEL: Record<string, string> = { high: 'Great options', medium: 'Some options', low: 'Fewer options' };

type Tab = 'restaurants' | 'dishes' | 'phrases' | 'debug';

// ── Restaurant card ───────────────────────────────────────────────────────────

function RestaurantCard({ sr, scanId, highlighted, cardRef }: {
  sr: ScanRestaurant;
  scanId: string;
  highlighted?: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const isCommunity = sr.source !== 'area_scan';
  return (
    <div
      ref={cardRef}
      className={clsx(
        'bg-white rounded-xl border p-4 space-y-3 transition-all duration-500',
        highlighted
          ? 'border-violet-400 ring-2 ring-violet-100 bg-violet-50/30'
          : isCommunity ? 'border-amber-100' : 'border-gray-100'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{sr.name}</h3>
            {isCommunity && (
              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-amber-50 text-amber-700 border-amber-200 flex items-center gap-1">
                <Star size={10} className="fill-amber-500 text-amber-500" />
                Community Added
              </span>
            )}
          </div>
          {sr.cuisine_type?.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{sr.cuisine_type.join(' · ')}</p>
          )}
          <div className="mt-1.5">
            {isCommunity && sr.avg_rating != null ? (
              <div className="flex items-center gap-1.5">
                <StarRow filled={Math.round(Number(sr.avg_rating))} color="amber" />
                <span className="text-xs font-semibold text-gray-700">{Number(sr.avg_rating).toFixed(1)}</span>
                <span className="text-xs text-gray-400">({sr.review_count} review{sr.review_count !== 1 ? 's' : ''})</span>
              </div>
            ) : !isCommunity && sr.ai_safety_confidence ? (
              <StarRow
                filled={CONFIDENCE_STARS[sr.ai_safety_confidence] ?? 0}
                color="blue"
                label="AI safety rating"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {sr.address && (
          <p className="text-xs text-gray-500 flex items-start gap-1.5">
            <MapPin size={11} className="mt-0.5 flex-shrink-0 text-gray-300" />
            {sr.address}
          </p>
        )}
        {sr.phone && sr.phone !== 'null' && (
          <a href={`tel:${sr.phone}`} className="text-xs text-gray-400 hover:text-violet-600 flex items-center gap-1 transition-colors">
            <Phone size={10} />
            {sr.phone}
          </a>
        )}
      </div>

      {sr.ai_notes && (
        <p className="text-sm text-gray-700 leading-relaxed">{sr.ai_notes}</p>
      )}

      {sr.recommended_dishes?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sr.recommended_dishes.map((d, i) => (
            <span key={i} className="text-xs px-2 py-1 bg-violet-50 text-blue-700 rounded-full border border-violet-100">
              {d}
            </span>
          ))}
        </div>
      )}

      {sr.warnings?.length > 0 && (
        <div className="space-y-1">
          {sr.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Place photos from Google Places */}
      {sr.menu_photo_urls?.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-gray-400 font-medium">Photos from Google</p>
            <p className="text-xs text-gray-300">· sourced online, may not show dietary-safe dishes</p>
          </div>
          <ExpandablePhotoStrip photos={sr.menu_photo_urls.slice(0, 5)} />
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-gray-50 flex-wrap">
        <Link
          href={`/?restaurant=${sr.restaurant_id}&lat=${sr.lat}&lng=${sr.lng}`}
          className="flex items-center gap-1 text-xs text-violet-600 font-medium hover:text-blue-700 transition-colors"
        >
          <MessageSquare size={11} /> Write Review
        </Link>
        <span className="text-gray-200">·</span>
        <a href={`https://maps.google.com/?q=${encodeURIComponent(sr.name + ' ' + sr.address)}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <MapPin size={11} /> Directions
        </a>
        {sr.website && sr.website !== 'null' && (
          <>
            <span className="text-gray-200">·</span>
            <a href={sr.website} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-violet-600 transition-colors">
              <Globe size={10} /> Website
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ── Dish card ─────────────────────────────────────────────────────────────────

function SafeDishCard({ dish }: { dish: SafeDish }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">{dish.name}</h3>
          {dish.local_name && (
            <p className="text-sm text-gray-500 mt-0.5">{dish.local_name}</p>
          )}
        </div>
        <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
      </div>
      <p className="text-xs text-gray-600 leading-relaxed">{dish.description}</p>
      {dish.safety_notes && (
        <p className="text-xs text-amber-700 flex items-start gap-1.5">
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          {dish.safety_notes}
        </p>
      )}
      {dish.commonly_found_at && (
        <p className="text-xs text-gray-400">Found at: {dish.commonly_found_at}</p>
      )}
    </div>
  );
}

function DangerFoodCard({ food }: { food: DangerFood }) {
  return (
    <div className="bg-red-50 rounded-xl border border-red-100 p-4 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-red-900 text-sm">{food.name}</h3>
          {food.local_name && (
            <p className="text-sm text-red-600/70 mt-0.5">{food.local_name}</p>
          )}
        </div>
        <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
      </div>
      <p className="text-xs text-red-800 leading-relaxed">{food.why_dangerous}</p>
      {food.commonly_found_in && (
        <p className="text-xs text-red-600/70">Commonly in: {food.commonly_found_in}</p>
      )}
    </div>
  );
}

// ── Phrase card ───────────────────────────────────────────────────────────────

function PhraseCardDisplay({ card }: { card: PhraseCard }) {
  return (
    <div className="bg-white rounded-2xl border-2 border-violet-100 p-5 space-y-3 shadow-sm">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{card.context}</p>
      <p className="text-3xl font-bold text-gray-900 leading-snug">{card.local_language}</p>
      {card.transliteration && (
        <p className="text-sm text-violet-600 italic">{card.transliteration}</p>
      )}
      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-500">{card.english}</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScanResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { status } = useSession();
  const router = useRouter();
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('restaurants');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanMsg, setRescanMsg] = useState<string | null>(null);
  const [rescanMsgIdx, setRescanMsgIdx] = useState(0);
  type SortKey = 'safety' | 'distance' | 'newest';
  const [sortKey, setSortKey] = useState<SortKey>('safety');
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const cardRefs   = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const fetchScan = useCallback(async () => {
    const res = await fetch(`/api/scans/${id}`);
    const data = await res.json();
    if (data.error) { router.push('/scan'); return; }
    setScan(data);
    setLoading(false);
    return data as Scan;
  }, [id, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/users/me').then(r => r.json()).then(u => {
      setIsPro(u.account_tier === 'pro' || (u.scans_remaining ?? 0) > 0);
    }).catch(() => setIsPro(false));
  }, [status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetchScan().then(data => {
      if (data?.status === 'processing') {
        // If restaurants already exist it's a Find More rescan — restore loading state
        if ((data?.restaurants?.length ?? 0) > 0) {
          setRescanning(true);
        }
        pollRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/scans/${id}`);
            const contentType = res.headers.get('content-type') ?? '';
            if (!contentType.includes('application/json')) {
              setScan(s => s ? { ...s, status: 'failed', error_message: 'Connection interrupted — please refresh.' } : s);
              clearInterval(pollRef.current!); pollRef.current = null; return;
            }
            const json = await res.json();
            if (json?.client_error || json?.code === 499) {
              setScan(s => s ? { ...s, status: 'failed', error_message: 'Connection interrupted — please refresh.' } : s);
              clearInterval(pollRef.current!); pollRef.current = null; return;
            }
            if (json?.id) setScan(json);
            if (json?.status !== 'processing') {
              clearInterval(pollRef.current!); pollRef.current = null;
              setRescanning(false);
            }
          } catch { /* network hiccup, keep polling */ }
        }, 4000);
      }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, fetchScan, id]);

  // Cycle rescan loading messages
  useEffect(() => {
    if (!rescanning) return;
    const id = setInterval(() => setRescanMsgIdx(i => (i + 1) % RESCAN_MESSAGES.length), 4000);
    return () => clearInterval(id);
  }, [rescanning]);

  const handlePinClick = useCallback((restaurantId: string) => {
    setActiveTab('restaurants');
    // Small delay to let tab switch render before scrolling
    setTimeout(() => {
      cardRefs.current[restaurantId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      setHighlightedId(restaurantId);
      highlightTimer.current = setTimeout(() => setHighlightedId(null), 2000);
    }, 50);
  }, []);

  const handleRescan = async () => {
    if (rescanning) return;
    const prevCount = scan?.restaurants?.length ?? 0;
    setRescanning(true);
    setRescanMsg(null);
    setRescanMsgIdx(0);

    // Poll for live log updates while the rescan runs
    const logPoll = setInterval(async () => {
      try {
        const s = await fetch(`/api/scans/${id}`).then(r => r.json());
        if (s?.id) setScan(prev => prev ? { ...prev, result_summary: s.result_summary } : prev);
      } catch { /* ignore */ }
    }, 1500);

    try {
      const res = await fetch(`/api/scans/${id}/rescan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (res.ok) {
        setScan(s => s ? { ...s, restaurants: data.restaurants } : s);
        const actualAdded = (data.restaurants?.length ?? 0) - prevCount;
        setRescanMsg(actualAdded > 0 ? `Found ${actualAdded} new restaurant${actualAdded !== 1 ? 's' : ''}!` : 'No new restaurants found in this area.');
      } else {
        setRescanMsg(data.error ?? 'Rescan failed — please try again.');
      }
    } catch {
      setRescanMsg('Connection error — please try again.');
    } finally {
      clearInterval(logPoll);
      setRescanning(false);
      setTimeout(() => setRescanMsg(null), 5000);
    }
  };

  if (loading || !scan) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const CONF_SCORE: Record<string, number> = { high: 10, medium: 6, low: 2 };

  // Dedup by normalized name (keep highest confidence/rated entry)
  const allRestaurants = ((scan.restaurants ?? []) as ScanRestaurant[])
    .slice()
    .sort((a, b) => {
      const scoreOf = (r: ScanRestaurant) =>
        CONF_SCORE[r.ai_safety_confidence ?? ''] ?? 0;
      return scoreOf(b) - scoreOf(a);
    })
    .filter((() => {
      const seen: string[] = [];
      return (r: ScanRestaurant) => {
        const key = normName(r.name);
        if (!key) return false;
        const isDup = seen.some(s => s === key);
        if (isDup) return false;
        seen.push(key);
        return true;
      };
    })());

  // Compute median centre for distance sorting
  const medLat = [...allRestaurants].sort((a, b) => a.lat - b.lat)[Math.floor(allRestaurants.length / 2)]?.lat ?? 0;
  const medLng = [...allRestaurants].sort((a, b) => a.lng - b.lng)[Math.floor(allRestaurants.length / 2)]?.lng ?? 0;
  const distFromCentre = (r: ScanRestaurant) => {
    const dlat = (r.lat - medLat) * 111000;
    const dlng = (r.lng - medLng) * 111000 * Math.cos(medLat * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
  };

  const restaurants = [...allRestaurants].sort((a, b) => {
    if (sortKey === 'safety') {
      return (CONF_SCORE[b.ai_safety_confidence ?? ''] ?? 0) - (CONF_SCORE[a.ai_safety_confidence ?? ''] ?? 0);
    }
    if (sortKey === 'distance') return distFromCentre(a) - distFromCentre(b);
    // newest: sort by created_at descending (when added to scan)
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });
  const safeDishes = (scan.safe_dishes ?? []) as SafeDish[];
  const dangerFoods = (scan.danger_foods ?? []) as DangerFood[];
  const phraseCards = (scan.phrase_cards ?? []) as PhraseCard[];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'restaurants', label: 'Restaurants', count: restaurants.length },
    { id: 'dishes', label: 'Dish Guide', count: safeDishes.length + dangerFoods.length },
    { id: 'phrases', label: 'Phrase Cards', count: phraseCards.length },
    { id: 'debug', label: '🛠 Raw' },
  ];

  // Non-pro users: blur the content and show upgrade prompt
  if (isPro === false) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="relative max-w-3xl mx-auto px-4 py-6">
          {/* Blurred background content */}
          <div className="blur-sm pointer-events-none select-none opacity-60 space-y-4">
            <div className="h-10 bg-white rounded-xl" />
            <div className="h-48 bg-white rounded-xl" />
            <div className="h-32 bg-white rounded-xl" />
            <div className="h-32 bg-white rounded-xl" />
            <div className="h-32 bg-white rounded-xl" />
          </div>
          {/* Overlay */}
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-xl p-8 text-center max-w-sm w-full space-y-4">
              <div className="w-14 h-14 bg-violet-50 rounded-full flex items-center justify-center mx-auto">
                <Sparkles size={24} className="text-violet-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Pro Required</h2>
                <p className="text-sm text-gray-500 leading-relaxed">
                  Smart Search results are a Pro feature. Re-enable Pro in your profile to access this search and all your past results.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Link
                  href="/profile"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors"
                >
                  <Sparkles size={14} /> Enable Pro
                </Link>
                <Link href="/scan" className="text-sm text-gray-400 hover:text-gray-600 transition-colors py-1">
                  Back to Smart Search
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Back + header */}
        <div className="flex items-start gap-3 justify-between">
          <Link href="/scan" className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow flex-shrink-0 mt-0.5">
            <ArrowLeft size={14} className="text-gray-600" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles size={16} className="text-violet-600 flex-shrink-0" />
              <h1 className="text-xl font-bold text-gray-900 truncate">{scan.destination}</h1>
              {scan.coverage_confidence && (
                <div className="flex items-center gap-1">
                  <StarRow filled={COVERAGE_STARS[scan.coverage_confidence] ?? 0} color="blue" />
                  <span className="text-xs text-gray-400">{COVERAGE_LABEL[scan.coverage_confidence] ?? scan.coverage_confidence}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              {(scan.dietary_tags ?? []).map(tag => (
                <span key={tag} className="text-xs text-gray-500 bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                  {DIETARY_LABELS[tag as DietaryTag] ?? tag}
                </span>
              ))}

            </div>
            {scan.coverage_note && (
              <p className="text-xs text-gray-400 mt-1 italic">{scan.coverage_note}</p>
            )}
          </div>
          {scan.status === 'completed' && (
            <button
              onClick={handleRescan}
              disabled={rescanning}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-violet-600 border border-violet-200 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors disabled:opacity-50"
            >
              {rescanning ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {rescanning ? RESCAN_MESSAGES[rescanMsgIdx] : 'Find More'}
            </button>
          )}
        </div>
        {rescanMsg && (
          <div className={clsx('text-xs px-3 py-2 rounded-lg border', rescanMsg.includes('new') ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200')}>
            {rescanMsg}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-100 rounded-xl p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-all',
                activeTab === tab.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={clsx(
                  'text-xs px-1.5 py-0.5 rounded-full',
                  activeTab === tab.id ? 'bg-violet-500 text-violet-100' : 'bg-gray-100 text-gray-500'
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab: Restaurants */}
        {activeTab === 'restaurants' && (
          <div className="space-y-4">
            {restaurants.length > 0 && (
              <ScanMap restaurants={restaurants} onPinClick={handlePinClick} />
            )}

            {/* Sort bar */}
            {restaurants.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 font-medium flex-shrink-0">Sort:</span>
                {(['safety', 'distance', 'newest'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => setSortKey(key)}
                    className={clsx(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                      sortKey === key
                        ? 'bg-violet-600 text-white border-violet-600'
                        : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600'
                    )}
                  >
                    {key === 'safety' ? 'Safety' : key === 'distance' ? 'Distance' : 'Newest'}
                  </button>
                ))}
              </div>
            )}
            {scan.coverage_confidence === 'low' && restaurants.length > 0 && (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Limited options in this area</p>
                  <p className="text-xs text-amber-700 mt-0.5">Some results may be from outside your search radius. Confirm availability before visiting.</p>
                </div>
              </div>
            )}
            {rescanning && (
              <div className="flex items-center gap-2.5 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
                <Loader2 size={14} className="text-violet-600 animate-spin flex-shrink-0" />
                <p className="text-xs text-violet-700 font-medium">{RESCAN_MESSAGES[rescanMsgIdx]}</p>
              </div>
            )}
            {restaurants.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
                <p className="text-gray-500 text-sm">No specific restaurants found for this area.</p>
                <p className="text-gray-400 text-xs mt-1">Check the Dish Guide for safe foods to look for.</p>
              </div>
            ) : (
              restaurants.map(sr => (
                <RestaurantCard
                  key={sr.id}
                  sr={sr}
                  scanId={id}
                  highlighted={highlightedId === sr.restaurant_id}
                  cardRef={el => { cardRefs.current[sr.restaurant_id] = el; }}
                />
              ))
            )}
          </div>
        )}

        {/* Tab: Dish Guide */}
        {activeTab === 'dishes' && (
          <div className="space-y-5">
            {scan.cuisine_notes && (
              <div className="bg-violet-50 border border-violet-100 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-violet-900 mb-2">Cuisine Overview</h3>
                <ul className="space-y-1.5">
                  {(scan.cuisine_notes.startsWith('{') && scan.cuisine_notes.endsWith('}')
                    // PostgreSQL array literal format e.g. {"item1","item2"} — parse out quoted strings
                    ? (scan.cuisine_notes.slice(1, -1).match(/"(?:[^"\\]|\\.)*"/g) ?? [scan.cuisine_notes]).map(s => s.replace(/^"|"$/g, '').replace(/\\"/g, '"'))
                    : scan.cuisine_notes.split(/\n|•|-(?=\s)/).map(s => s.trim())
                  ).filter(Boolean)
                    .map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-violet-800 leading-relaxed">
                        <span className="text-violet-400 mt-1 flex-shrink-0">•</span>
                        {point}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {safeDishes.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle size={15} className="text-green-500" />
                  <h2 className="font-semibold text-gray-900">Safe Dishes ({safeDishes.length})</h2>
                </div>
                {safeDishes.map((dish, i) => <SafeDishCard key={i} dish={dish} />)}
              </div>
            )}

            {dangerFoods.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} className="text-red-500" />
                  <h2 className="font-semibold text-gray-900">Foods to Avoid ({dangerFoods.length})</h2>
                </div>
                {dangerFoods.map((food, i) => <DangerFoodCard key={i} food={food} />)}
              </div>
            )}

            {safeDishes.length === 0 && dangerFoods.length === 0 && (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
                <p className="text-gray-400 text-sm">No dish guide available for this scan.</p>
              </div>
            )}
          </div>
        )}

        {/* Tab: Phrase Cards */}
        {activeTab === 'phrases' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-400">
              Show these cards to restaurant staff. Tap to enlarge.
            </p>
            {phraseCards.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
                <p className="text-gray-400 text-sm">No phrase cards available for this scan.</p>
              </div>
            ) : (
              phraseCards.slice(0, 2).map((card, i) => <PhraseCardDisplay key={i} card={card} />)
            )}
          </div>
        )}

        {/* Tab: Debug */}
        {activeTab === 'debug' && (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-6">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Status</p>
                <span className={clsx(
                  'text-xs font-semibold px-2 py-0.5 rounded-full',
                  scan.status === 'completed' && 'bg-green-100 text-green-700',
                  scan.status === 'processing' && 'bg-blue-100 text-blue-700',
                  scan.status === 'failed' && 'bg-red-100 text-red-700',
                  scan.status === 'pending' && 'bg-gray-100 text-gray-600',
                )}>
                  {scan.status === 'processing' && <Loader2 size={10} className="inline mr-1 animate-spin" />}
                  {scan.status}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Tokens</p>
                <p className="text-xs font-mono text-gray-900">{scan.tokens_used || '—'}</p>
              </div>
              {scan.error_message && (
                <div className="flex-1">
                  <p className="text-xs text-gray-400 mb-0.5">Error</p>
                  <p className="text-xs text-red-600">{scan.error_message}</p>
                </div>
              )}
              {scan.status === 'processing' && (
                <p className="text-xs text-violet-500 flex items-center gap-1 ml-auto">
                  <Loader2 size={11} className="animate-spin" />
                  Polling every 4s…
                </p>
              )}
            </div>
            <div className="bg-gray-950 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
                <span className="text-xs text-gray-400 font-mono">Process log</span>
                {scan.status === 'processing' && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
                    live
                  </span>
                )}
              </div>
              <div className="p-4 max-h-[500px] overflow-y-auto">
                <pre className="text-xs text-green-400 whitespace-pre-wrap break-all leading-relaxed font-mono">
                  {scan.result_summary || '(no log yet)'}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-gray-300 py-2">
          <span>Scanned {new Date(scan.created_at).toLocaleDateString()}</span>
          {scan.tokens_used > 0 && <span>{scan.tokens_used.toLocaleString()} tokens used</span>}
        </div>
      </div>
    </div>
  );
}
