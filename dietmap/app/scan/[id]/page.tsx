'use client';
import { use, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowLeft, MapPin, Globe, AlertTriangle,
  CheckCircle, Sparkles, Star, Loader2, ExternalLink, MessageSquare,
} from 'lucide-react';
import {
  Scan, ScanRestaurant, PhraseCard, SafeDish, DangerFood,
  DietaryTag, DIETARY_LABELS,
} from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import clsx from 'clsx';

const ScanMap = dynamic(
  () => import('@/components/ScanMap').then(m => ({ default: m.ScanMap })),
  { ssr: false, loading: () => <div className="w-full h-[280px] bg-gray-100 rounded-xl animate-pulse mb-4" /> }
);

const CONFIDENCE_STARS: Record<string, number> = { high: 5, medium: 3, low: 1 };

function StarRow({ filled, total = 5, color = 'amber', label }: {
  filled: number; total?: number; color?: 'amber' | 'blue'; label?: string;
}) {
  const cls = color === 'blue' ? 'fill-blue-400 text-blue-400' : 'fill-amber-400 text-amber-400';
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
          ? 'border-blue-400 ring-2 ring-blue-100 bg-blue-50/30'
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
                Community Pick
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
        {sr.website && (
          <a href={sr.website} target="_blank" rel="noopener noreferrer"
            className="flex-shrink-0 text-gray-300 hover:text-blue-500 transition-colors">
            <Globe size={15} />
          </a>
        )}
      </div>

      {sr.address && (
        <p className="text-xs text-gray-500 flex items-start gap-1.5">
          <MapPin size={11} className="mt-0.5 flex-shrink-0 text-gray-300" />
          {sr.address}
        </p>
      )}

      {sr.ai_notes && (
        <p className="text-sm text-gray-700 leading-relaxed">{sr.ai_notes}</p>
      )}

      {sr.recommended_dishes?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sr.recommended_dishes.map((d, i) => (
            <span key={i} className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-100">
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

      {sr.source_urls?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sr.source_urls.slice(0, 3).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-blue-500 flex items-center gap-1 transition-colors">
              <ExternalLink size={10} />
              Source {i + 1}
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
        <Link
          href={`/?restaurant=${sr.restaurant_id}&lat=${sr.lat}&lng=${sr.lng}`}
          className="flex items-center gap-1 text-xs text-blue-600 font-medium hover:text-blue-700 transition-colors"
        >
          <MessageSquare size={11} /> Write Review
        </Link>
        <span className="text-gray-200">·</span>
        <a href={`https://maps.google.com/?q=${encodeURIComponent(sr.name + ' ' + sr.address)}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
          <MapPin size={11} /> Directions
        </a>
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
    <div className="bg-white rounded-2xl border-2 border-blue-100 p-5 space-y-3 shadow-sm">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{card.context}</p>
      <p className="text-3xl font-bold text-gray-900 leading-snug">{card.local_language}</p>
      {card.transliteration && (
        <p className="text-sm text-blue-600 italic">{card.transliteration}</p>
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
  const [activeTab, setActiveTab] = useState<Tab>('restaurants');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
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
    fetchScan().then(data => {
      if (data?.status === 'processing') {
        pollRef.current = setInterval(async () => {
          try {
            const res = await fetch(`/api/scans/${id}`);
            const contentType = res.headers.get('content-type') ?? '';
            if (!contentType.includes('application/json')) {
              // 499 / non-JSON = connection interrupted
              setScan(s => s ? { ...s, status: 'failed', error_message: 'Connection interrupted — please refresh.' } : s);
              clearInterval(pollRef.current!); pollRef.current = null; return;
            }
            const json = await res.json();
            if (json?.client_error || json?.code === 499) {
              setScan(s => s ? { ...s, status: 'failed', error_message: 'Connection interrupted — please refresh.' } : s);
              clearInterval(pollRef.current!); pollRef.current = null; return;
            }
            if (json?.id) setScan(json);
            if (json?.status !== 'processing') { clearInterval(pollRef.current!); pollRef.current = null; }
          } catch { /* network hiccup, keep polling */ }
        }, 4000);
      }
    });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, fetchScan, id]);

  // Auto-switch to debug tab when processing so user sees the live log
  useEffect(() => {
    if (scan?.status === 'processing') setActiveTab('debug');
  }, [scan?.status]);

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

  const CONF_SCORE: Record<string, number> = { high: 10, medium: 6, low: 2 };
  const restaurants = ((scan.restaurants ?? []) as ScanRestaurant[]).slice().sort((a, b) => {
    // Community picks: score = 8 + (avg_rating / 5) * 2  → range 8–10
    // AI restaurants: score based on confidence → 10 / 6 / 2
    const scoreOf = (r: ScanRestaurant) =>
      r.source !== 'area_scan'
        ? 8 + (Number(r.avg_rating ?? 0) / 5) * 2
        : CONF_SCORE[r.ai_safety_confidence ?? ''] ?? 0;
    return scoreOf(b) - scoreOf(a);
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Back + header */}
        <div className="flex items-start gap-3">
          <Link href="/scan" className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow flex-shrink-0 mt-0.5">
            <ArrowLeft size={14} className="text-gray-600" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Sparkles size={16} className="text-blue-600 flex-shrink-0" />
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
              {scan.travel_dates_start && (
                <span className="text-xs text-gray-400">
                  {scan.travel_dates_start} — {scan.travel_dates_end}
                </span>
              )}
            </div>
            {scan.coverage_note && (
              <p className="text-xs text-gray-400 mt-1 italic">{scan.coverage_note}</p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-100 rounded-xl p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg transition-all',
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={clsx(
                  'text-xs px-1.5 py-0.5 rounded-full',
                  activeTab === tab.id ? 'bg-blue-500 text-blue-100' : 'bg-gray-100 text-gray-500'
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
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">Cuisine Overview</h3>
                <ul className="space-y-1.5">
                  {scan.cuisine_notes
                    .split(/\n|•|-(?=\s)/)
                    .map(s => s.trim())
                    .filter(Boolean)
                    .map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-blue-800 leading-relaxed">
                        <span className="text-blue-400 mt-1 flex-shrink-0">•</span>
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
                <p className="text-xs text-blue-500 flex items-center gap-1 ml-auto">
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
