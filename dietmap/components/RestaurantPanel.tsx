'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  X, Star, MapPin, Phone, Globe, ExternalLink,
  MessageSquare, ChevronDown, ChevronUp, Plus, Check, List as ListIcon,
  Camera, Trash2, Sparkles, ThumbsUp, ThumbsDown, Flag,
} from 'lucide-react';
import {
  Restaurant, Review, DietaryTag, DIETARY_LABELS, DIETARY_ICONS,
  ReviewDietarySafety, List,
} from '@/lib/types';
import clsx from 'clsx';
import { ExpandablePhotoStrip } from './ExpandablePhotoStrip';

const ALL_DIETARY_TAGS: DietaryTag[] = [
  'gluten_free','dairy_free','vegan','vegetarian','keto',
  'nut_free','soy_free','egg_free','shellfish_free','halal','kosher','low_fodmap',
];

const PRICE = ['', '$', '$$', '$$$', '$$$$'];

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

// ── Community dietary info ────────────────────────────────────────────────────

export function computeDietaryInfo(reviews: Review[]) {
  const data: Record<string, { ratings: number[]; dedicated: boolean }> = {};
  reviews.forEach(rv => {
    (rv.dietary_safety ?? []).forEach(ds => {
      // Only process new-format entries (have star_rating property)
      if (!('star_rating' in ds)) return;
      if (!data[ds.tag]) data[ds.tag] = { ratings: [], dedicated: false };
      if (ds.star_rating != null) data[ds.tag].ratings.push(ds.star_rating);
      if (ds.is_dedicated) data[ds.tag].dedicated = true;
    });
  });
  return Object.entries(data)
    .filter(([, d]) => d.ratings.length > 0)
    .map(([tag, d]) => ({
      tag: tag as DietaryTag,
      avg_stars: d.ratings.reduce((a, b) => a + b, 0) / d.ratings.length,
      is_dedicated: d.dedicated,
      count: d.ratings.length,
    }))
    .sort((a, b) => b.avg_stars - a.avg_stars);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function StarRow({
  value, max = 5, size = 14, color = 'amber',
  interactive = false, onChange,
}: {
  value: number; max?: number; size?: number;
  color?: 'amber' | 'blue';
  interactive?: boolean;
  onChange?: (v: number) => void;
}) {
  const filled = color === 'amber' ? 'text-amber-500 fill-amber-500' : 'text-blue-500 fill-blue-500';
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          size={size}
          onClick={interactive && onChange ? () => onChange(i + 1) : undefined}
          className={clsx(
            i < Math.round(value) ? filled : 'text-gray-200 fill-gray-200',
            interactive && 'cursor-pointer hover:scale-110 transition-transform'
          )}
        />
      ))}
    </span>
  );
}

// ── ReviewCard ────────────────────────────────────────────────────────────────

export function ReviewCard({ review }: { review: Review & { user_name?: string; user_avatar?: string | null } }) {
  const safetyEntries = (review.dietary_safety ?? []).filter(ds => 'star_rating' in ds);
  const [upvotes, setUpvotes]   = useState(review.upvotes ?? 0);
  const [downvotes, setDownvotes] = useState(review.downvotes ?? 0);
  const [myVote, setMyVote]     = useState<1 | -1 | null>(review.my_vote ?? null);
  const [voting, setVoting]     = useState(false);
  const [showReviewReport, setShowReviewReport] = useState(false);
  const [reviewReportReason, setReviewReportReason] = useState('');
  const [reviewReportDetail, setReviewReportDetail] = useState('');
  const [reviewReportSubmitting, setReviewReportSubmitting] = useState(false);
  const [reviewReportDone, setReviewReportDone] = useState(false);

  const submitReviewReport = async () => {
    if (!reviewReportReason || reviewReportSubmitting) return;
    setReviewReportSubmitting(true);
    try {
      await fetch(`/api/reviews/${review.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reviewReportReason, detail: reviewReportDetail }),
      });
      setReviewReportDone(true);
      setShowReviewReport(false);
      setReviewReportReason('');
      setReviewReportDetail('');
    } finally {
      setReviewReportSubmitting(false);
    }
  };

  const handleVote = async (v: 1 | -1) => {
    if (voting) return;

    // Optimistic update — apply immediately so UI feels instant
    const prevUpvotes = upvotes;
    const prevDownvotes = downvotes;
    const prevMyVote = myVote;

    if (myVote === v) {
      // Toggle off
      setMyVote(null);
      v === 1 ? setUpvotes(u => u - 1) : setDownvotes(d => d - 1);
    } else {
      if (myVote === 1) setUpvotes(u => u - 1);
      if (myVote === -1) setDownvotes(d => d - 1);
      setMyVote(v);
      v === 1 ? setUpvotes(u => u + 1) : setDownvotes(d => d + 1);
    }

    setVoting(true);
    try {
      const res = await fetch(`/api/reviews/${review.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote: v }),
      });
      if (res.ok) {
        const data = await res.json();
        setUpvotes(data.upvotes);
        setDownvotes(data.downvotes);
        setMyVote(data.my_vote);
      } else {
        setUpvotes(prevUpvotes); setDownvotes(prevDownvotes); setMyVote(prevMyVote);
      }
    } catch {
      setUpvotes(prevUpvotes); setDownvotes(prevDownvotes); setMyVote(prevMyVote);
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {review.user_avatar ? (
            <img src={review.user_avatar} alt="" className="w-8 h-8 rounded-full" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700">
              {(review.user_name ?? 'A')[0]}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-gray-800">{review.user_name ?? 'Anonymous'}</p>
            <p className="text-xs text-gray-400">{new Date(review.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StarRow value={review.rating} size={12} color="amber" />
          <span className="text-xs text-gray-400">Overall</span>
        </div>
      </div>

      {safetyEntries.length > 0 && (
        <div className="pt-1">
          <div className="flex items-center gap-3 mb-1.5">
            <span className="text-xs text-gray-400 w-36 flex-shrink-0">Requirements</span>
            <span className="text-xs text-gray-400">Safety Rating</span>
          </div>
          {safetyEntries.map(ds => (
            <div key={ds.tag} className="mb-1.5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-700 w-36 flex-shrink-0">
                  {DIETARY_ICONS[ds.tag as DietaryTag]} {DIETARY_LABELS[ds.tag as DietaryTag]}
                </span>
                {ds.star_rating != null
                  ? <StarRow value={ds.star_rating} size={12} color="blue" />
                  : <span className="text-xs text-gray-400 italic">Unsure</span>
                }
                {ds.is_dedicated && <span className="text-xs text-blue-600 font-medium ml-1">· Dedicated ✓</span>}
              </div>
              {ds.notes && (
                <p className="text-xs text-gray-400 italic ml-0 mt-0.5">&ldquo;{ds.notes}&rdquo;</p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-sm text-gray-700 leading-relaxed">{review.body}</p>

      {review.photos?.length > 0 && (
        <ExpandablePhotoStrip photos={review.photos} />
      )}

      {/* Vote + report buttons */}
      <div className="flex items-center gap-3 pt-1 border-t border-gray-50">
        <button
          onClick={() => handleVote(1)}
          disabled={voting}
          className={`flex items-center gap-1 text-xs transition-colors ${myVote === 1 ? 'text-blue-600 font-semibold' : 'text-gray-400 hover:text-blue-500'}`}
        >
          <ThumbsUp size={12} />
          {upvotes > 0 && <span>{upvotes}</span>}
        </button>
        <button
          onClick={() => handleVote(-1)}
          disabled={voting}
          className={`flex items-center gap-1 text-xs transition-colors ${myVote === -1 ? 'text-red-500 font-semibold' : 'text-gray-400 hover:text-red-400'}`}
        >
          <ThumbsDown size={12} />
          {downvotes > 0 && <span>{downvotes}</span>}
        </button>
        <button
          onClick={() => { setShowReviewReport(f => !f); setReviewReportDone(false); }}
          className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
          title="Report this review"
        >
          <Flag size={11} />
        </button>
      </div>

      {reviewReportDone && (
        <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          Review reported. Thanks for helping keep the community trustworthy.
        </p>
      )}

      {showReviewReport && (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">Report this review</p>
          <select
            value={reviewReportReason}
            onChange={e => setReviewReportReason(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-red-200"
          >
            <option value="">Select a reason…</option>
            <option value="spam">Spam or fake review</option>
            <option value="offensive">Offensive or inappropriate</option>
            <option value="fake_review">Not a genuine experience</option>
            <option value="incorrect_info">Incorrect dietary information</option>
            <option value="other">Other</option>
          </select>
          <textarea
            value={reviewReportDetail}
            onChange={e => setReviewReportDetail(e.target.value)}
            placeholder="Optional: add more detail…"
            rows={2}
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={submitReviewReport}
              disabled={!reviewReportReason || reviewReportSubmitting}
              className="px-2.5 py-1 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-40"
            >
              {reviewReportSubmitting ? 'Sending…' : 'Report'}
            </button>
            <button
              onClick={() => { setShowReviewReport(false); setReviewReportReason(''); setReviewReportDetail(''); }}
              className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ReviewForm ────────────────────────────────────────────────────────────────

function ReviewForm({
  restaurantId, existingReview, onSubmitted, onCancel,
}: {
  restaurantId: string;
  existingReview?: Review | null;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const [body, setBody] = useState(existingReview?.body ?? '');
  const [rating, setRating] = useState(existingReview?.rating ?? 5);
  const [dietaryContext, setDietaryContext] = useState<DietaryTag[]>(
    (existingReview?.dietary_context ?? []) as DietaryTag[]
  );
  const [dietarySafety, setDietarySafety] = useState<ReviewDietarySafety[]>(
    (existingReview?.dietary_safety ?? []).filter(ds => 'star_rating' in ds) as ReviewDietarySafety[]
  );
  const [photos, setPhotos] = useState<string[]>(existingReview?.photos ?? []);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleTag = (tag: DietaryTag) => {
    setDietaryContext(t => {
      if (t.includes(tag)) {
        setDietarySafety(s => s.filter(x => x.tag !== tag));
        return t.filter(x => x !== tag);
      }
      return [...t, tag];
    });
  };

  const getSafety = (tag: DietaryTag) =>
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

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!session) { router.push('/login'); return; }
    setSubmitting(true);
    try {
      await fetch(`/api/restaurants/${restaurantId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, body, dietary_context: dietaryContext, dietary_safety: dietarySafety, photos }),
      });
      onSubmitted();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
      {/* Overall rating */}
      <div>
        <label className="text-xs font-semibold text-gray-600 block mb-1.5">Overall Rating</label>
        <StarRow value={rating} size={24} color="amber" interactive onChange={setRating} />
      </div>

      {/* Dietary restrictions */}
      <div>
        <label className="text-xs font-semibold text-gray-600 block mb-1.5">My dietary restrictions</label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_DIETARY_TAGS.map(tag => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-full border transition-all',
                dietaryContext.includes(tag)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
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
          {dietaryContext.map(tag => {
            const s = getSafety(tag);
            return (
              <div key={tag} className="bg-white rounded-xl border border-gray-100 p-3 space-y-2.5">
                <p className="text-sm font-semibold text-gray-800">{DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}</p>

                <div>
                  <p className="text-xs text-gray-500 mb-1.5">Allergy Safety</p>
                  <div className="flex items-center gap-3">
                    <StarRow
                      value={s.star_rating ?? 0}
                      size={22}
                      color="amber"
                      interactive
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
                  <span className="text-xs text-gray-600">
                    Mark as dedicated {DIETARY_LABELS[tag].toLowerCase()} location
                  </span>
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
        placeholder="Share your experience…"
        rows={3}
        required
        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
      />

      {/* Photos */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-xs text-gray-500 font-medium">Photos ({photos.length}/4)</p>
          {photos.length < 4 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
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
                <button
                  type="button"
                  onClick={() => setPhotos(ps => ps.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {submitting ? 'Saving…' : existingReview ? 'Update Review' : 'Submit Review'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

interface Props {
  restaurantId: string | null;
  onClose: () => void;
}

export function RestaurantPanel({ restaurantId, onClose }: Props) {
  const { data: session } = useSession();

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [reviews, setReviews] = useState<(Review & { user_name?: string; user_avatar?: string | null })[]>([]);
  const [loading, setLoading] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);

  const [lists, setLists] = useState<List[]>([]);
  const [showListPicker, setShowListPicker] = useState(false);
  const [listPickerLoading, setListPickerLoading] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState('#3b82f6');
  const [showNewListForm, setShowNewListForm] = useState(false);

  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetail, setReportDetail] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  const prevIdRef = useRef<string | null>(null);
  const loadingIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async (id: string) => {
    loadingIdRef.current = id;
    try {
      const [rest, revs] = await Promise.all([
        fetch(`/api/restaurants/${id}`).then(r => r.json()),
        fetch(`/api/restaurants/${id}/reviews`).then(r => r.json()),
      ]);
      if (loadingIdRef.current !== id) return;
      setRestaurant(rest?.id ? rest : null);
      setReviews(Array.isArray(revs) ? revs : []);
    } catch {
      if (loadingIdRef.current !== id) return;
      setRestaurant(null);
      setReviews([]);
    } finally {
      if (loadingIdRef.current === id) {
        setLoading(false);
        setShowReviewForm(false);
        setShowReportForm(false);
        setReportDone(false);
        setTimeout(() => setContentVisible(true), 20);
      }
    }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!restaurantId) {
      setContentVisible(false);
      setRestaurant(null);
      setReviews([]);

      prevIdRef.current = null;
      return;
    }
    if (restaurantId === prevIdRef.current) return;
    prevIdRef.current = restaurantId;

    if (restaurant) {
      setContentVisible(false);
      timerRef.current = setTimeout(() => { setLoading(true); loadData(restaurantId); }, 180);
    } else {
      setLoading(true);
      loadData(restaurantId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const loadLists = useCallback(async () => {
    if (!session) return;
    setListPickerLoading(true);
    try {
      const data = await fetch('/api/lists').then(r => r.json());
      setLists(Array.isArray(data) ? data : []);
    } finally {
      setListPickerLoading(false);
    }
  }, [session]);

  const toggleList = async (list: List) => {
    if (!restaurantId) return;
    const isIn = list.restaurant_ids?.includes(restaurantId);
    await fetch(`/api/lists/${list.id}/restaurants`, {
      method: isIn ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId }),
    });
    loadLists();
  };

  const createList = async () => {
    if (!newListName.trim()) return;
    await fetch('/api/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newListName.trim(), color: newListColor }),
    });
    setNewListName('');
    setShowNewListForm(false);
    loadLists();
  };

  const submitReport = async () => {
    if (!reportReason || !restaurantId || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      const res = await fetch(`/api/restaurants/${restaurantId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reportReason, detail: reportDetail }),
      });
      if (!res.ok) throw new Error('Failed to submit report');
      setReportDone(true);
      setShowReportForm(false);
      setReportReason('');
      setReportDetail('');
    } catch {
      alert('Something went wrong submitting your report. Please try again.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const userReview = session ? reviews.find(r => r.user_id === session.user?.id) : undefined;
  const dietaryInfo = restaurant ? computeDietaryInfo(reviews) : [];

  const LIST_COLORS_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899'];

  return (
    <>
    <div
      className={clsx(
        'absolute right-0 top-0 bottom-0 z-30 bg-white border-l border-gray-200 flex flex-col',
        'transition-transform duration-300 ease-out w-[42%] min-w-[340px]',
        restaurantId ? 'translate-x-0' : 'translate-x-full'
      )}
      style={{ boxShadow: '-4px 0 30px rgba(0,0,0,0.144)' }}
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 shadow-sm transition-colors"
      >
        <X size={14} />
      </button>

      {/* Loading dots — outside the opacity wrapper so they're always visible */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-blue-600"
                style={{ animation: `dot-bounce 0.55s ease-in-out ${i * 0.14}s infinite alternate` }}
              />
            ))}
          </div>
        </div>
      )}

      <div
        className="flex flex-col flex-1 overflow-hidden transition-opacity duration-150"
        style={{ opacity: contentVisible ? 1 : 0 }}
      >
        {!loading && restaurant ? (
          <>
            {/* Hero */}
            <div className="relative h-40 flex-shrink-0 bg-gray-100">
              {restaurant.cover_photo_url ? (
                <>
                  <img src={restaurant.cover_photo_url} alt={restaurant.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4 pr-12">
                    <h2 className="text-xl font-bold text-white leading-tight">{restaurant.name}</h2>
                    {restaurant.cuisine_type?.length > 0 && (
                      <p className="text-white/70 text-xs mt-0.5">{restaurant.cuisine_type.join(' · ')}</p>
                    )}
                  </div>
                </>
              ) : (
                <div className="w-full h-full bg-gradient-to-b from-gray-100 to-gray-50 flex items-end pb-4 px-4">
                  <div className="pr-12">
                    <h2 className="text-xl font-bold text-gray-900 leading-tight">{restaurant.name}</h2>
                    {restaurant.cuisine_type?.length > 0 && (
                      <p className="text-gray-500 text-xs mt-0.5">{restaurant.cuisine_type.join(' · ')}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* Info */}
              <div className="p-4 bg-white border-b border-gray-100 space-y-3">
                {Number(restaurant.review_count) > 0 ? (
                  <div className="flex items-center gap-2">
                    <StarRow value={Number(restaurant.avg_rating) || 0} size={13} color="amber" />
                    <span className="text-sm font-semibold text-gray-700">{Number(restaurant.avg_rating).toFixed(1)}</span>
                    <span className="text-xs text-gray-400">· {restaurant.review_count} review{Number(restaurant.review_count) !== 1 ? 's' : ''}</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No ratings yet</p>
                )}

                <div className="space-y-1.5">
                  {restaurant.address && (
                    <div className="flex items-start gap-2">
                      <MapPin size={12} className="text-gray-400 mt-0.5 flex-shrink-0" />
                      <span className="text-xs text-gray-600">{restaurant.address}</span>
                    </div>
                  )}
                  {restaurant.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={12} className="text-gray-400 flex-shrink-0" />
                      <a href={`tel:${restaurant.phone}`} className="text-xs text-gray-600 hover:text-blue-600">{restaurant.phone}</a>
                    </div>
                  )}
                  {restaurant.website && (
                    <div className="flex items-center gap-2">
                      <Globe size={12} className="text-gray-400 flex-shrink-0" />
                      <a href={restaurant.website} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-blue-600 flex items-center gap-1 truncate">
                        {restaurant.website.replace(/https?:\/\/(www\.)?/, '')}
                        <ExternalLink size={10} className="flex-shrink-0" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {restaurant.price_level ? <span className="text-xs text-gray-500 font-medium">{PRICE[restaurant.price_level]}</span> : null}
                    {restaurant.source === 'area_scan' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                        <Sparkles size={9} /> Smart Search
                      </span>
                    ) : restaurant.source === 'seed' ? (
                      <span className="text-xs text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">Unverified</span>
                    ) : !restaurant.verified ? (
                      <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">Community Added</span>
                    ) : null}
                  </div>
                  {session && (
                    <button
                      onClick={() => { setShowReportForm(f => !f); setReportDone(false); }}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors flex-shrink-0"
                      title="Report this listing"
                    >
                      <Flag size={11} />
                      <span>Report</span>
                    </button>
                  )}
                </div>

                {/* Restaurant report form — shown below info box */}
                {reportDone && (
                  <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mx-0 mt-2">
                    Thanks for your report. Our team will review it.
                  </p>
                )}
                {showReportForm && (
                  <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3 mt-2">
                    <p className="text-xs font-semibold text-gray-700">Report this listing</p>
                    <select
                      value={reportReason}
                      onChange={e => setReportReason(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-red-200"
                    >
                      <option value="">Select a reason…</option>
                      <option value="wrong_info">Wrong information</option>
                      <option value="fake_listing">Fake or duplicate listing</option>
                      <option value="offensive_content">Offensive content</option>
                      <option value="incorrect_dietary_tags">Incorrect dietary tags</option>
                      <option value="other">Other</option>
                    </select>
                    <textarea
                      value={reportDetail}
                      onChange={e => setReportDetail(e.target.value)}
                      placeholder="Optional: add more detail…"
                      rows={2}
                      className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200 bg-white resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitReport}
                        disabled={!reportReason || reportSubmitting}
                        className="px-3 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 transition-colors disabled:opacity-40"
                      >
                        {reportSubmitting ? 'Sending…' : 'Submit Report'}
                      </button>
                      <button
                        onClick={() => { setShowReportForm(false); setReportReason(''); setReportDetail(''); }}
                        className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Dietary Info — auto-expanded */}
              {dietaryInfo.length > 0 && (
                <DietaryInfoSection dietaryInfo={dietaryInfo} />
              )}

              {/* Add to List */}
              {session && (
                <div className="bg-white border-b border-gray-100">
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between text-left"
                    onClick={() => { setShowListPicker(v => { if (!v) loadLists(); return !v; }); }}
                  >
                    <div className="flex items-center gap-2">
                      <ListIcon size={13} className="text-gray-400" />
                      <span className="text-sm font-semibold text-gray-800">Add to List</span>
                    </div>
                    {showListPicker ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>
                  {showListPicker && (
                    <div className="px-4 pb-3 space-y-1.5">
                      {listPickerLoading && <p className="text-xs text-gray-400">Loading…</p>}
                      {!listPickerLoading && lists.length === 0 && !showNewListForm && (
                        <p className="text-xs text-gray-400">No lists yet.</p>
                      )}
                      {lists.map(list => {
                        const isIn = list.restaurant_ids?.includes(restaurantId ?? '');
                        return (
                          <button
                            key={list.id}
                            onClick={() => toggleList(list)}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
                          >
                            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: list.color }} />
                            <span className="text-sm text-gray-700 flex-1">{list.name}</span>
                            {isIn && <Check size={13} className="text-blue-600" />}
                          </button>
                        );
                      })}
                      {showNewListForm ? (
                        <div className="flex flex-col gap-2 pt-1">
                          <input
                            type="text"
                            value={newListName}
                            onChange={e => setNewListName(e.target.value)}
                            placeholder="List name…"
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
                            autoFocus
                          />
                          <div className="flex gap-1.5 flex-wrap">
                            {LIST_COLORS_PALETTE.map(c => (
                              <button key={c} type="button" onClick={() => setNewListColor(c)}
                                className={clsx('w-6 h-6 rounded-full border-2 transition-transform', newListColor === c ? 'border-gray-900 scale-110' : 'border-transparent')}
                                style={{ background: c }}
                              />
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button onClick={createList} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700">Create</button>
                            <button onClick={() => { setShowNewListForm(false); setNewListName(''); }} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setShowNewListForm(true)} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium pt-1">
                          <Plus size={12} /> New list
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Seed data prompt */}
              {restaurant.source === 'seed' && (
                <div className="mx-4 mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-1">
                  <p className="text-xs font-semibold text-slate-700">No dietary info yet</p>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    This restaurant was imported from OpenStreetMap and hasn&apos;t been verified by the community.
                    Add a review below to share what dietary options are available.
                  </p>
                </div>
              )}

              {/* Reviews */}
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Reviews ({reviews.length})</h3>
                    <button
                    onClick={() => setShowReviewForm(f => !f)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-blue-600 text-blue-600 text-xs font-semibold rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <MessageSquare size={11} />
                    {userReview ? 'Edit Review' : 'Write Review'}
                  </button>
                </div>

                {showReviewForm && (
                  <ReviewForm
                    restaurantId={restaurantId!}
                    existingReview={userReview}
                    onSubmitted={async () => {
                      setShowReviewForm(false);
                      const revs = await fetch(`/api/restaurants/${restaurantId}/reviews`).then(r => r.json());
                      setReviews(Array.isArray(revs) ? revs : []);
                    }}
                    onCancel={() => setShowReviewForm(false)}
                  />
                )}

                {reviews.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 py-6">No reviews yet. Be the first!</p>
                ) : (
                  reviews.map(r => <ReviewCard key={r.id} review={r} />)
                )}
              </div>

              {/* Smart Search Notes — shown only for AI-found restaurants */}
              {restaurant.scan_notes && (
                <div className="mx-4 mb-4 rounded-xl border-2 border-purple-200 bg-purple-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles size={14} className="text-purple-600 flex-shrink-0" />
                    <span className="text-sm font-bold text-purple-900">Smart Search Notes</span>
                    <span className="text-xs text-purple-500 ml-auto">AI · not community verified</span>
                  </div>
                  <p className="text-xs text-purple-700 leading-relaxed">
                    From your scan of <span className="font-semibold">{restaurant.scan_notes.scan_destination}</span>
                  </p>
                  {restaurant.scan_notes.ai_notes && (
                    <p className="text-sm text-purple-900 leading-relaxed">{restaurant.scan_notes.ai_notes}</p>
                  )}
                  {restaurant.scan_notes.recommended_dishes?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-purple-800 mb-1.5">Recommended dishes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {restaurant.scan_notes.recommended_dishes.map((d, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full border border-purple-200">{d}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {restaurant.scan_notes.warnings?.length > 0 && (
                    <div className="space-y-1">
                      {restaurant.scan_notes.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-800 flex items-start gap-1.5 bg-amber-50 rounded-lg px-2 py-1.5">
                          <span className="flex-shrink-0">⚠</span> {w}
                        </p>
                      ))}
                    </div>
                  )}
                  {restaurant.scan_notes.ai_safety_confidence && (
                    <p className="text-xs text-purple-600">
                      AI safety rating: <span className={
                        restaurant.scan_notes.ai_safety_confidence === 'high' ? 'font-semibold text-green-700' :
                        restaurant.scan_notes.ai_safety_confidence === 'medium' ? 'font-semibold text-amber-700' :
                        'font-semibold text-red-700'
                      }>{restaurant.scan_notes.ai_safety_confidence}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
    </>
  );
}

// ── Dietary Info section (separate component to keep panel tidy) ──────────────

export function DietaryInfoSection({ dietaryInfo }: {
  dietaryInfo: { tag: DietaryTag; avg_stars: number; is_dedicated: boolean; count: number }[]
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="bg-white border-b border-gray-100">
      <button
        className="w-full px-4 py-3 flex items-center justify-between text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-sm font-semibold text-gray-800">Dietary Info</span>
        {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2.5">
          {dietaryInfo.map(dt => (
            <div key={dt.tag}>
              <div className="flex items-center gap-2">
                <span className="text-base">{DIETARY_ICONS[dt.tag]}</span>
                <span className="text-xs text-gray-700 flex-1 font-medium">{DIETARY_LABELS[dt.tag]}</span>
                <StarRow value={dt.avg_stars} size={12} color="amber" />
                <span className="text-xs text-gray-400">
                  {dt.avg_stars.toFixed(1)} · {dt.count} rating{dt.count !== 1 ? 's' : ''}
                </span>
              </div>
              {dt.is_dedicated && (
                <p className="text-xs text-blue-600 font-medium mt-0.5 ml-7">
                  ✓ Marked as dedicated {DIETARY_LABELS[dt.tag].toLowerCase()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
