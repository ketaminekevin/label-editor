'use client';
import { use, useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Navbar } from '@/components/Navbar';
import { Restaurant, ScanRestaurant, Review, DietaryTag, DIETARY_LABELS, DIETARY_ICONS } from '@/lib/types';
import { ReviewCard, computeDietaryInfo, DietaryInfoSection } from '@/components/RestaurantPanel';
import {
  ArrowLeft, Star, Phone, Globe, MapPin, ChevronDown,
  Sparkles, AlertTriangle, UtensilsCrossed, MessageSquare, ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';

const ScanMap = dynamic(
  () => import('@/components/ScanMap').then(m => ({ default: m.ScanMap })),
  { ssr: false, loading: () => <div className="w-full h-[280px] bg-gray-100 rounded-xl animate-pulse mb-4" /> }
);

interface ListDetail {
  id: string;
  name: string;
  color: string;
  scan_id?: string | null;
}

type SortKey = 'rating' | 'distance' | 'newest';

const REVIEWS_PER_PAGE = 3;
const PRICE = ['', '$', '$$', '$$$', '$$$$'];

function toScanRestaurant(r: Restaurant): ScanRestaurant {
  return {
    id: r.id,
    scan_id: '',
    restaurant_id: r.id,
    ai_notes: null,
    ai_safety_confidence: null,
    recommended_dishes: [],
    warnings: [],
    source_urls: [],
    menu_photo_urls: [],
    created_at: r.created_at,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    cuisine_type: r.cuisine_type ?? [],
    price_level: r.price_level,
    website: r.website,
    phone: r.phone,
    visibility: r.visibility ?? 'public',
    source: r.source,
    avg_rating: r.avg_rating ?? null,
    review_count: r.review_count ?? 0,
  };
}

function RestaurantListItem({ r, onOpenMap }: { r: Restaurant; onOpenMap: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviews, setReviews] = useState<(Review & { user_name?: string; user_avatar?: string | null })[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(REVIEWS_PER_PAGE);

  const reviewCount = r.review_count ?? 0;
  const dietaryInfo = useMemo(() => computeDietaryInfo(reviews), [reviews]);

  const toggleReviews = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!reviewsOpen && reviews.length === 0 && reviewCount > 0) {
      setReviewsLoading(true);
      fetch(`/api/restaurants/${r.id}/reviews`)
        .then(res => res.json())
        .then(data => setReviews(Array.isArray(data) ? data : []))
        .finally(() => setReviewsLoading(false));
    }
    setReviewsOpen(o => !o);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:border-purple-200 hover:shadow-sm transition-all duration-150">

      {/* Card header — click toggles expand */}
      <button className="w-full text-left" onClick={() => setExpanded(o => !o)}>
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                {r.source === 'area_scan' && <Sparkles size={11} className="text-purple-500 flex-shrink-0" />}
                <h3 className="font-semibold text-gray-900 text-sm truncate">{r.name}</h3>
              </div>
              {r.cuisine_type?.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5 truncate">{r.cuisine_type.join(' · ')}</p>
              )}
              {r.address && (
                <p className="text-xs text-gray-400 truncate mt-0.5">{r.address}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex flex-col items-end gap-0.5">
                {r.avg_rating ? (
                  <span className="flex items-center gap-0.5 text-xs font-semibold text-gray-700">
                    <Star size={11} className="text-amber-500 fill-amber-500" />
                    {Number(r.avg_rating).toFixed(1)}
                    <span className="font-normal text-gray-400 ml-0.5">({reviewCount})</span>
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">No reviews</span>
                )}
                {r.price_level ? <span className="text-xs text-gray-400">{PRICE[r.price_level]}</span> : null}
              </div>
              <ChevronDown
                size={14}
                className={clsx('text-gray-400 transition-transform duration-300 flex-shrink-0', expanded && 'rotate-180')}
              />
            </div>
          </div>
        </div>
      </button>

      {/* Expandable detail */}
      <div className={clsx(
        'overflow-hidden transition-all duration-300 ease-in-out',
        expanded ? 'max-h-[9999px] opacity-100' : 'max-h-0 opacity-0'
      )}>

        {/* Cover photo hero */}
        {r.cover_photo_url && (
          <div className="relative h-36 bg-gray-100 flex-shrink-0">
            <img src={r.cover_photo_url} alt={r.name} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          </div>
        )}

        {/* Info block — mirrors panel style */}
        <div className="px-4 py-3 border-t border-gray-100 space-y-2.5">

          {/* Star rating row */}
          {reviewCount > 0 ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-0.5">
                {[1,2,3,4,5].map(i => (
                  <Star key={i} size={13}
                    className={i <= Math.round(Number(r.avg_rating)) ? 'text-amber-500 fill-amber-500' : 'text-gray-200 fill-gray-200'} />
                ))}
              </span>
              <span className="text-sm font-semibold text-gray-700">{Number(r.avg_rating).toFixed(1)}</span>
              <span className="text-xs text-gray-400">· {reviewCount} review{reviewCount !== 1 ? 's' : ''}</span>
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No ratings yet</p>
          )}

          {/* Address / phone / website */}
          <div className="space-y-1.5">
            {r.address && (
              <div className="flex items-start gap-2">
                <MapPin size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <span className="text-xs text-gray-600">{r.address}</span>
              </div>
            )}
            {r.phone && r.phone !== 'null' && (
              <div className="flex items-center gap-2">
                <Phone size={12} className="text-gray-400 flex-shrink-0" />
                <a href={`tel:${r.phone}`} onClick={e => e.stopPropagation()}
                  className="text-xs text-gray-600 hover:text-blue-600">{r.phone}</a>
              </div>
            )}
            {r.website && r.website !== 'null' && (
              <div className="flex items-center gap-2">
                <Globe size={12} className="text-gray-400 flex-shrink-0" />
                <a href={r.website} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-xs text-gray-600 hover:text-blue-600 flex items-center gap-1 truncate">
                  {r.website.replace(/https?:\/\/(www\.)?/, '')}
                  <ExternalLink size={10} className="flex-shrink-0" />
                </a>
              </div>
            )}
          </div>

          {/* Source badge */}
          <div className="flex items-center gap-2">
            {r.price_level ? <span className="text-xs text-gray-500 font-medium">{PRICE[r.price_level]}</span> : null}
            {r.source === 'area_scan' ? (
              <span className="inline-flex items-center gap-1 text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                <Sparkles size={9} /> Smart Search
              </span>
            ) : !r.verified ? (
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">Community Added</span>
            ) : null}
          </div>
        </div>

        {/* Dietary tags from restaurant record */}
        {r.dietary_tags && r.dietary_tags.length > 0 && (
          <div className="px-4 pb-3 flex flex-wrap gap-1.5 border-t border-gray-50 pt-3">
            {r.dietary_tags.map(t => (
              <span key={t.tag} className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                {DIETARY_ICONS[t.tag as DietaryTag]} {DIETARY_LABELS[t.tag as DietaryTag] ?? t.tag}
              </span>
            ))}
          </div>
        )}

        {/* Dietary info computed from reviews (shown once reviews load) */}
        {dietaryInfo.length > 0 && (
          <div className="border-t border-gray-100">
            <DietaryInfoSection dietaryInfo={dietaryInfo} />
          </div>
        )}

        {/* Smart Search Notes */}
        {r.scan_notes && (
          <div className="mx-4 mb-3 mt-1 rounded-xl border border-purple-200 bg-purple-50 p-3 space-y-2">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-purple-600 flex-shrink-0" />
              <span className="text-xs font-bold text-purple-900">Smart Search Notes</span>
              <span className="text-xs text-purple-400 ml-auto">AI · not verified</span>
            </div>
            {r.scan_notes.ai_notes && (
              <p className="text-xs text-purple-800 leading-relaxed">{r.scan_notes.ai_notes}</p>
            )}
            {r.scan_notes.recommended_dishes.length > 0 && (
              <div className="flex items-start gap-1.5">
                <UtensilsCrossed size={11} className="text-purple-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-purple-700">{r.scan_notes.recommended_dishes.join(', ')}</p>
              </div>
            )}
            {r.scan_notes.warnings.length > 0 && (
              <div className="flex items-start gap-1.5">
                <AlertTriangle size={11} className="text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700">{r.scan_notes.warnings.join(', ')}</p>
              </div>
            )}
          </div>
        )}

        {/* Reviews section */}
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">

          {/* Toggle button */}
          <button
            onClick={toggleReviews}
            className={clsx(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-medium transition-colors',
              reviewsOpen
                ? 'bg-amber-50 border-amber-200 text-amber-700'
                : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-amber-200 hover:text-amber-600'
            )}
          >
            <span className="flex items-center gap-1.5">
              <MessageSquare size={12} />
              {reviewCount > 0
                ? `View ${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}`
                : 'No reviews yet'}
            </span>
            {reviewCount > 0 && (
              <ChevronDown size={12} className={clsx('transition-transform duration-200', reviewsOpen && 'rotate-180')} />
            )}
          </button>

          {/* Review cards */}
          {reviewsOpen && (
            reviewsLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            ) : reviews.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">No reviews yet</p>
            ) : (
              <div className="space-y-3">
                {reviews.slice(0, visibleCount).map(rv => (
                  <ReviewCard key={rv.id} review={rv} />
                ))}
                {visibleCount < reviews.length && (
                  <button
                    onClick={e => { e.stopPropagation(); setVisibleCount(c => c + REVIEWS_PER_PAGE); }}
                    className="w-full py-2 text-xs text-violet-600 font-medium hover:text-violet-700 transition-colors border border-violet-200 rounded-lg"
                  >
                    Load more ({reviews.length - visibleCount} remaining)
                  </button>
                )}
              </div>
            )
          )}
        </div>

        {/* Open on map */}
        <div className="px-4 pb-4">
          <button
            onClick={e => { e.stopPropagation(); onOpenMap(); }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors"
          >
            <MapPin size={12} /> Open on map
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status } = useSession();
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch(`/api/lists/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { router.push('/lists'); return; }
        setList(data.list);
        setRestaurants(Array.isArray(data.restaurants) ? data.restaurants : []);
      })
      .finally(() => setLoading(false));
  }, [id, status, router]);

  const { medLat, medLng } = useMemo(() => {
    if (!restaurants.length) return { medLat: 0, medLng: 0 };
    const sl = [...restaurants].sort((a, b) => a.lat - b.lat);
    const sg = [...restaurants].sort((a, b) => a.lng - b.lng);
    const mid = Math.floor(restaurants.length / 2);
    return { medLat: sl[mid].lat, medLng: sg[mid].lng };
  }, [restaurants]);

  const distFromCentre = (r: Restaurant) => {
    const dlat = (r.lat - medLat) * 111000;
    const dlng = (r.lng - medLng) * 111000 * Math.cos(medLat * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
  };

  const sorted = useMemo(() => {
    const list = [...restaurants];
    if (sortKey === 'rating') return list.sort((a, b) => (Number(b.avg_rating) || 0) - (Number(a.avg_rating) || 0));
    if (sortKey === 'distance') return list.sort((a, b) => distFromCentre(a) - distFromCentre(b));
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurants, sortKey, medLat, medLng]);

  const mapRestaurants = useMemo(() => restaurants.map(toScanRestaurant), [restaurants]);

  const handlePinClick = (restaurantId: string) => {
    const r = restaurants.find(x => x.id === restaurantId);
    if (r) router.push(`/?restaurant=${r.id}&lat=${r.lat}&lng=${r.lng}`);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/lists" className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow flex-shrink-0">
            <ArrowLeft size={14} className="text-gray-600" />
          </Link>
          {list && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: list.color }} />
              <h1 className="text-xl font-bold text-gray-900 truncate">{list.name}</h1>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
          </div>
        ) : restaurants.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🍽️</div>
            <p className="font-medium text-gray-500">No restaurants in this list yet</p>
            <p className="text-sm mt-1">Open a restaurant on the map and add it to this list</p>
          </div>
        ) : (
          <>
            {/* Minimap */}
            <ScanMap
              restaurants={mapRestaurants}
              onPinClick={handlePinClick}
              listColor={list?.scan_id ? undefined : (list?.color ?? undefined)}
            />

            {/* Sort bar */}
            {restaurants.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 font-medium flex-shrink-0">Sort:</span>
                {(['newest', 'rating', 'distance'] as SortKey[]).map(key => (
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
                    {key === 'newest' ? 'Newest' : key === 'rating' ? 'Rating' : 'Distance'}
                  </button>
                ))}
                <span className="ml-auto text-xs text-gray-400">
                  {restaurants.length} restaurant{restaurants.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* Restaurant cards */}
            <div className="space-y-3">
              {sorted.map(r => (
                <RestaurantListItem
                  key={r.id}
                  r={r}
                  onOpenMap={() => router.push(`/?restaurant=${r.id}&lat=${r.lat}&lng=${r.lng}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
