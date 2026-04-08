'use client';
import { use, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Star, MapPin, Phone, Globe, Heart, HeartOff,
  MessageSquare, ChevronDown, ChevronUp, ExternalLink, AlertTriangle, Users
} from 'lucide-react';
import {
  Restaurant, Review, DietaryTag, DIETARY_LABELS, DIETARY_ICONS,
  SAFETY_LABELS, SAFETY_COLORS, ConfidenceLevel, SafetyLevel,
  ReviewDietarySafety,
} from '@/lib/types';
import { SafetyMeter } from '@/components/DietaryBadge';
import { Navbar } from '@/components/Navbar';
import clsx from 'clsx';

const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  llm_derived:    'AI-derived',
  user_verified:  'Community verified',
  owner_verified: 'Owner verified',
};

const PRICE = ['', '$', '$$', '$$$', '$$$$'];

const ALL_DIETARY_TAGS: DietaryTag[] = [
  'gluten_free','dairy_free','vegan','vegetarian','keto',
  'nut_free','soy_free','egg_free','shellfish_free','halal','kosher','low_fodmap',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function StarRating({ value, max = 5, size = 14 }: { value: number; max?: number; size?: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={size}
          className={i < Math.round(value) ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'}
        />
      ))}
    </span>
  );
}

function starAvgToSafetyLevel(avg: number): SafetyLevel {
  if (avg >= 4.5) return 'dedicated';
  if (avg >= 3.5) return 'careful';
  if (avg >= 2.5) return 'has_options';
  return 'risky';
}

/** Compute community-averaged safety level per tag from all review dietary_safety entries. */
function computeCommunityLevels(
  reviews: Review[],
  restaurantTags: Restaurant['dietary_tags']
): { tag: DietaryTag; safety_level: SafetyLevel; count: number; notes?: string | null; confidence: ConfidenceLevel }[] {
  // Aggregate star ratings per tag (skip null/unsure)
  const votes: Record<string, number[]> = {};
  reviews.forEach(rv => {
    (rv.dietary_safety ?? []).forEach(ds => {
      if (ds.star_rating == null) return;
      if (!votes[ds.tag]) votes[ds.tag] = [];
      votes[ds.tag].push(ds.star_rating);
    });
  });

  // Start from restaurant tags as the base set
  const tagSet = new Set<string>([
    ...(restaurantTags ?? []).map(t => t.tag),
    ...Object.keys(votes),
  ]);

  return Array.from(tagSet).map(tag => {
    const tagVotes = votes[tag] ?? [];
    const original = restaurantTags?.find(t => t.tag === tag);

    if (tagVotes.length > 0) {
      const avg = tagVotes.reduce((a, b) => a + b, 0) / tagVotes.length;
      return {
        tag: tag as DietaryTag,
        safety_level: starAvgToSafetyLevel(avg),
        count: tagVotes.length,
        notes: original?.notes,
        confidence: 'user_verified' as ConfidenceLevel,
      };
    }
    // Fall back to original tag
    return {
      tag: tag as DietaryTag,
      safety_level: original?.safety_level ?? 'has_options',
      count: 0,
      notes: original?.notes,
      confidence: original?.confidence ?? 'user_verified',
    };
  }).sort((a, b) => {
    const order: SafetyLevel[] = ['dedicated', 'careful', 'has_options', 'risky'];
    return order.indexOf(a.safety_level) - order.indexOf(b.safety_level);
  });
}

// ── Review card ───────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: Review & { user_name?: string; user_avatar?: string | null } }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {review.user_avatar ? (
            <img src={review.user_avatar} alt="" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center text-sm font-bold text-teal-700">
              {(review.user_name ?? 'A')[0]}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-slate-800">{review.user_name ?? 'Anonymous'}</p>
            <p className="text-xs text-slate-400">{new Date(review.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <StarRating value={review.rating} size={13} />
      </div>

      {review.dietary_context?.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {review.dietary_context.map(tag => (
            <span key={tag} className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded-md border border-teal-100">
              {DIETARY_ICONS[tag as DietaryTag]} {DIETARY_LABELS[tag as DietaryTag]}
            </span>
          ))}
        </div>
      )}

      <p className="text-sm text-slate-700 leading-relaxed">{review.body}</p>

      {review.dietary_safety?.length > 0 && (
        <div className="pt-2 border-t border-slate-50 space-y-1.5">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Allergy Safety</p>
          {review.dietary_safety.map(ds => (
            <div key={ds.tag} className="flex items-center gap-2">
              <span className="text-sm">{DIETARY_ICONS[ds.tag as DietaryTag]}</span>
              <span className="text-xs text-slate-600 flex-1">{DIETARY_LABELS[ds.tag as DietaryTag]}</span>
              {ds.star_rating != null ? (
                <StarRating value={ds.star_rating} size={11} />
              ) : (
                <span className="text-xs text-slate-400 italic">Unsure</span>
              )}
              {ds.is_dedicated && (
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100">
                  Dedicated
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Review form ───────────────────────────────────────────────────────────────

function ReviewForm({
  restaurantId,
  onSubmitted,
  onCancel,
}: {
  restaurantId: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(5);
  const [safetyRating, setSafetyRating] = useState(5);
  const [dietaryContext, setDietaryContext] = useState<DietaryTag[]>([]);
  const [dietarySafety, setDietarySafety] = useState<ReviewDietarySafety[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (tag: DietaryTag) => {
    setDietaryContext(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
    // Remove safety assessment if tag deselected
    setDietarySafety(s => s.filter(x => x.tag !== tag));
  };

  const setSafetyForTag = (tag: DietaryTag, starRating: number | null, isDedicated?: boolean) => {
    setDietarySafety(s => {
      const existing = s.find(x => x.tag === tag);
      if (existing) return s.map(x => x.tag === tag ? {
        ...x,
        star_rating: starRating,
        is_dedicated: isDedicated ?? x.is_dedicated,
      } : x);
      return [...s, { tag, star_rating: starRating, is_dedicated: isDedicated ?? false }];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) { router.push('/login'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/restaurants/${restaurantId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, safety_rating: safetyRating, body, dietary_context: dietaryContext, dietary_safety: dietarySafety }),
      });
      if (res.ok) onSubmitted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 border-b border-slate-100 space-y-4 bg-teal-50/60">
      {/* Overall rating */}
      <div className="flex gap-4 flex-wrap">
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1.5">Overall Rating</label>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <button key={n} type="button" onClick={() => setRating(n)}>
                <Star size={20} className={n <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600 block mb-1.5">Overall Safety</label>
          <div className="flex gap-1">
            {[1,2,3,4,5].map(n => (
              <button key={n} type="button" onClick={() => setSafetyRating(n)}>
                <Star size={20} className={n <= safetyRating ? 'text-teal-500 fill-teal-500' : 'text-slate-200 fill-slate-200'} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dietary restrictions I have */}
      <div>
        <label className="text-xs font-semibold text-slate-600 block mb-1.5">My dietary restrictions</label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DIETARY_TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-full border transition-all',
                dietaryContext.includes(tag)
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-teal-300'
              )}
            >
              {DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}
            </button>
          ))}
        </div>
      </div>

      {/* Per-tag allergy safety */}
      {dietaryContext.length > 0 && (
        <div className="space-y-3">
          <label className="text-xs font-semibold text-slate-600 block">
            Allergy safety per restriction
          </label>
          {dietaryContext.map(tag => {
            const entry = dietarySafety.find(s => s.tag === tag);
            const currentStars = entry?.star_rating ?? null;
            const isDedicated = entry?.is_dedicated ?? false;
            return (
              <div key={tag} className="bg-white rounded-xl border border-slate-100 p-3 space-y-2">
                <p className="text-sm font-semibold text-slate-800">
                  {DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}
                </p>
                <div className="flex items-center gap-1">
                  {[1,2,3,4,5].map(n => (
                    <button key={n} type="button" onClick={() => setSafetyForTag(tag, n)}>
                      <Star size={18} className={currentStars != null && n <= currentStars ? 'text-teal-500 fill-teal-500' : 'text-slate-200 fill-slate-200'} />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSafetyForTag(tag, null)}
                    className={clsx('ml-2 text-xs px-2 py-0.5 rounded-full border transition-colors', currentStars === null && entry ? 'bg-slate-100 text-slate-600 border-slate-300' : 'text-slate-400 border-slate-200 hover:border-slate-300')}
                  >
                    Unsure
                  </button>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={isDedicated} onChange={e => setSafetyForTag(tag, currentStars, e.target.checked)} className="rounded" />
                  Dedicated kitchen / separate prep
                </label>
              </div>
            );
          })}
        </div>
      )}

      {/* Review body */}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Share your experience, especially around dietary safety…"
        rows={3}
        required
        className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white"
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Review'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RestaurantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const router = useRouter();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [reviews, setReviews] = useState<(Review & { user_name?: string; user_avatar?: string | null })[]>([]);
  const [isFavourited, setIsFavourited] = useState(false);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadReviews = () =>
    fetch(`/api/restaurants/${id}/reviews`).then(r => r.json()).then(d => setReviews(Array.isArray(d) ? d : []));

  useEffect(() => {
    Promise.all([
      fetch(`/api/restaurants/${id}`).then(r => r.json()),
      fetch(`/api/restaurants/${id}/reviews`).then(r => r.json()),
    ]).then(([r, rv]) => {
      setRestaurant(r);
      setReviews(Array.isArray(rv) ? rv : []);
    }).finally(() => setLoading(false));
  }, [id]);

  const toggleFavourite = async () => {
    if (!session) { router.push('/login'); return; }
    const method = isFavourited ? 'DELETE' : 'POST';
    await fetch(`/api/restaurants/${id}/favourite`, { method });
    setIsFavourited(f => !f);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf7]">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-[#fafaf7]">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-500">
          <p className="text-xl font-semibold">Restaurant not found</p>
          <Link href="/" className="text-teal-600 text-sm mt-2 inline-block">← Back to map</Link>
        </div>
      </div>
    );
  }

  const communityLevels = computeCommunityLevels(reviews, restaurant.dietary_tags);

  return (
    <div className="min-h-screen bg-[#fafaf7]">
      <Navbar />

      {/* Hero */}
      <div className="relative h-52 bg-slate-200 overflow-hidden">
        {restaurant.cover_photo_url ? (
          <img src={restaurant.cover_photo_url} alt={restaurant.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-teal-100 to-teal-200 flex items-center justify-center">
            <span className="text-6xl">🍽️</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h1 className="text-2xl font-bold text-white">{restaurant.name}</h1>
          <p className="text-white/80 text-sm mt-0.5">{restaurant.cuisine_type?.join(' · ')}</p>
        </div>
        <Link href="/" className="absolute top-4 left-4 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow">
          <ArrowLeft size={14} className="text-slate-700" />
        </Link>
        <button onClick={toggleFavourite} className="absolute top-4 right-4 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow">
          {isFavourited
            ? <Heart size={14} className="text-red-500 fill-red-500" />
            : <HeartOff size={14} className="text-slate-600" />
          }
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* Info card */}
        <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {restaurant.avg_rating ? (
                <div className="flex items-center gap-1.5">
                  <StarRating value={Number(restaurant.avg_rating)} />
                  <span className="text-sm font-semibold text-slate-700">{Number(restaurant.avg_rating).toFixed(1)}</span>
                  <span className="text-xs text-slate-400">({restaurant.review_count} review{Number(restaurant.review_count) !== 1 ? 's' : ''})</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <StarRating value={0} />
                  <span className="text-xs text-slate-400">No reviews yet</span>
                </div>
              )}
              {restaurant.price_level && (
                <span className="text-sm text-slate-500 font-medium">{PRICE[restaurant.price_level]}</span>
              )}
            </div>
            {!restaurant.verified && (
              <span className="text-xs px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg font-medium">
                Community Added
              </span>
            )}
          </div>
          <div className="space-y-1.5 text-sm text-slate-600">
            <div className="flex items-start gap-2">
              <MapPin size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
              <span>{restaurant.address}</span>
            </div>
            {restaurant.phone && (
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-slate-400" />
                <a href={`tel:${restaurant.phone}`} className="hover:text-teal-600">{restaurant.phone}</a>
              </div>
            )}
            {restaurant.website && (
              <div className="flex items-center gap-2">
                <Globe size={14} className="text-slate-400" />
                <a href={restaurant.website} target="_blank" rel="noopener noreferrer" className="hover:text-teal-600 flex items-center gap-1">
                  {restaurant.website.replace(/https?:\/\/(www\.)?/, '')}
                  <ExternalLink size={10} />
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Dietary Safety Panel */}
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Dietary Safety</h2>
              {reviews.length > 0 && (
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                  <Users size={10} /> Averaged from {reviews.filter(r => r.dietary_safety?.length > 0).length} reviewer assessment{reviews.filter(r => r.dietary_safety?.length > 0).length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-lg border border-amber-100">
              <AlertTriangle size={11} />
              Always confirm with staff
            </div>
          </div>

          {communityLevels.length > 0 ? (
            <div className="divide-y divide-slate-50">
              {communityLevels.map(dt => {
                const isExpanded = expandedTags.has(dt.tag);
                return (
                  <div key={dt.tag}>
                    <button
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors text-left"
                      onClick={() => setExpandedTags(s => {
                        const next = new Set(s);
                        next.has(dt.tag) ? next.delete(dt.tag) : next.add(dt.tag);
                        return next;
                      })}
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <span className="text-xl">{DIETARY_ICONS[dt.tag]}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{DIETARY_LABELS[dt.tag]}</p>
                          <SafetyMeter level={dt.safety_level} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ color: SAFETY_COLORS[dt.safety_level], background: SAFETY_COLORS[dt.safety_level] + '1a' }}
                        >
                          {SAFETY_LABELS[dt.safety_level]}
                        </span>
                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-3 bg-slate-50 space-y-1">
                        {dt.notes && <p className="text-sm text-slate-700">{dt.notes}</p>}
                        <p className="text-xs text-slate-400">
                          {dt.count > 0
                            ? `Based on ${dt.count} reviewer ${dt.count === 1 ? 'assessment' : 'assessments'}`
                            : CONFIDENCE_LABELS[dt.confidence]
                          }
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-slate-400">
              <p className="text-sm">No dietary information yet.</p>
              <p className="text-xs mt-1">Write a review to add dietary safety info!</p>
            </div>
          )}
        </div>

        {/* Reviews */}
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Reviews ({reviews.length})</h2>
            <button
              onClick={() => setShowReviewForm(f => !f)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 transition-colors"
            >
              <MessageSquare size={12} />
              Write Review
            </button>
          </div>

          {showReviewForm && (
            <ReviewForm
              restaurantId={id}
              onSubmitted={async () => {
                setShowReviewForm(false);
                await loadReviews();
              }}
              onCancel={() => setShowReviewForm(false)}
            />
          )}

          <div className="p-4 space-y-3">
            {reviews.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-6">No reviews yet. Be the first!</p>
            ) : (
              reviews.map(r => <ReviewCard key={r.id} review={r} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
