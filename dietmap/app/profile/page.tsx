'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, DietaryTag, DIETARY_LABELS, DIETARY_ICONS } from '@/lib/types';
import { Navbar } from '@/components/Navbar';
import { Save, Star, ExternalLink, Trash2, Sparkles } from 'lucide-react';
import clsx from 'clsx';

const ALL_TAGS: DietaryTag[] = [
  'gluten_free','dairy_free','vegan','vegetarian','keto',
  'nut_free','soy_free','egg_free','shellfish_free','halal','kosher','low_fodmap',
];

interface UserReview {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  restaurant_cuisine: string[];
  rating: number;
  safety_rating: number | null;
  dietary_context: string[];
  body: string;
  created_at: string;
}

function StarRow({ value, color = 'amber', size = 13 }: { value: number; color?: 'amber' | 'teal'; size?: number }) {
  const filled = color === 'amber' ? 'text-amber-400 fill-amber-400' : 'text-violet-500 fill-violet-500';
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} size={size} className={i < Math.round(value) ? filled : 'text-slate-200 fill-slate-200'} />
      ))}
    </span>
  );
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [useMiles, setUseMiles] = useState(false);
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null);
  const [togglingPro, setTogglingPro] = useState(false);

  useEffect(() => {
    setUseMiles(localStorage.getItem('dietmap_use_miles') === '1');
  }, []);

  const toggleDistanceUnit = () => {
    const next = !useMiles;
    setUseMiles(next);
    localStorage.setItem('dietmap_use_miles', next ? '1' : '0');
  };

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/users/me').then(r => r.json()).then(u => {
      setUser(u);
      setProfile(u.dietary_profile ?? {});
    });
    fetch('/api/users/me/reviews').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setReviews(data);
    });
  }, [session]);

  const toggleDiet = (tag: DietaryTag) => {
    setProfile(p => ({ ...p, [tag]: !p[tag] }));
  };

  const togglePro = async () => {
    if (!user) return;
    const nextPro = user.account_tier !== 'pro';
    setTogglingPro(true);
    const res = await fetch('/api/users/me/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pro: nextPro }),
    });
    const data = await res.json();
    setUser(u => u ? { ...u, account_tier: data.account_tier, scans_remaining: data.scans_remaining } : u);
    setTogglingPro(false);
  };

  const deleteReview = async (id: string) => {
    if (!confirm('Delete this review? This cannot be undone.')) return;
    setDeletingReviewId(id);
    await fetch(`/api/reviews/${id}`, { method: 'DELETE' });
    setReviews(r => r.filter(x => x.id !== id));
    setDeletingReviewId(null);
  };

  const save = async () => {
    setSaving(true);
    await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dietary_profile: profile }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!user) return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-xl mx-auto px-4 py-12 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-16 bg-white rounded-xl animate-pulse" />)}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-xl font-bold text-gray-900">Profile & Settings</h1>

        {/* User info */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4">
          {session?.user?.image ? (
            <img src={session.user.image} alt="" className="w-14 h-14 rounded-full" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-violet-100 flex items-center justify-center text-xl font-bold text-violet-700">
              {user.name[0]}
            </div>
          )}
          <div>
            <p className="font-semibold text-gray-900">{user.name}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span className={clsx(
              'inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium',
              user.subscription_tier === 'premium'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-500'
            )}>
              {user.subscription_tier === 'premium' ? '⭐ Premium' : 'Free Plan'}
            </span>
          </div>
        </div>

        {/* Pro features toggle */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-blue-600" />
                <h2 className="font-semibold text-gray-900">Pro Features</h2>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {user.account_tier === 'pro'
                  ? `Pro — unlimited scans (${user.scans_remaining} credits)`
                  : 'Enable to test AI Area Scanner'}
              </p>
            </div>
            <button
              onClick={togglePro}
              disabled={togglingPro}
              className={clsx(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50',
                user.account_tier === 'pro' ? 'bg-violet-600' : 'bg-gray-200'
              )}
            >
              <span className={clsx(
                'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                user.account_tier === 'pro' ? 'translate-x-6' : 'translate-x-1'
              )} />
            </button>
          </div>
        </div>

        {/* Dietary profile */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">My Dietary Profile</h2>
              <p className="text-xs text-gray-500 mt-0.5">Used to personalise your map filters by default</p>
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-semibold rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50"
            >
              <Save size={12} />
              {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ALL_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleDiet(tag)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all',
                  profile[tag]
                    ? 'bg-violet-50 border-violet-300 text-violet-800'
                    : 'bg-gray-50 border-gray-100 text-gray-500 hover:border-gray-200'
                )}
              >
                <span className="text-lg">{DIETARY_ICONS[tag]}</span>
                <span className="text-sm font-medium">{DIETARY_LABELS[tag]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Display settings */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">Display Settings</h2>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium text-gray-800">Distance unit</p>
              <p className="text-xs text-gray-400 mt-0.5">Used for search radius on the map</p>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => { if (useMiles) toggleDistanceUnit(); }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  !useMiles ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                km
              </button>
              <button
                onClick={() => { if (!useMiles) toggleDistanceUnit(); }}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  useMiles ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                miles
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-400">
            {useMiles
              ? 'Showing distances in miles (5 mi · 10 mi · 25 mi · 50 mi)'
              : 'Showing distances in kilometres (5 km · 10 km · 25 km · 50 km)'}
          </p>
        </div>

        {/* My Reviews */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">My Reviews ({reviews.length})</h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-gray-400">You haven&apos;t written any reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {reviews.map(rv => (
                <div key={rv.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/restaurant/${rv.restaurant_id}`}
                        className="text-sm font-semibold text-gray-800 hover:text-violet-700 flex items-center gap-1"
                      >
                        {rv.restaurant_name}
                        <ExternalLink size={11} className="text-gray-400" />
                      </Link>
                      {rv.restaurant_cuisine?.length > 0 && (
                        <p className="text-xs text-gray-400">{rv.restaurant_cuisine.join(' · ')}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <p className="text-xs text-gray-400">{new Date(rv.created_at).toLocaleDateString()}</p>
                      <button
                        onClick={() => deleteReview(rv.id)}
                        disabled={deletingReviewId === rv.id}
                        className="p-1 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50"
                        title="Delete review"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <StarRow value={rv.rating} color="amber" />
                      <span className="text-xs text-gray-400">Overall</span>
                    </div>
                    {rv.safety_rating != null && (
                      <div className="flex items-center gap-1.5">
                        <StarRow value={rv.safety_rating} color="teal" />
                        <span className="text-xs text-gray-400">Safety</span>
                      </div>
                    )}
                  </div>
                  {rv.dietary_context?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {rv.dietary_context.map(tag => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-md border border-violet-100">
                          {DIETARY_ICONS[tag as DietaryTag]} {DIETARY_LABELS[tag as DietaryTag]}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-sm text-gray-700 leading-relaxed">{rv.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
