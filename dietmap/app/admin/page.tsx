'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle, XCircle, Flag, RotateCcw, Search, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

type Tab = 'pending' | 'flagged' | 'all' | 'accounts' | 'activity' | 'settings';

interface AdminRestaurant {
  id: string; name: string; address: string; status: string;
  verified: boolean; report_count: number; source: string;
  created_at: string; added_by_name: string | null; added_by_email: string | null;
  ai_verdict: { verdict: string; confidence: number; reasons: string[] } | null;
  cuisine_type: string[]; review_count: number; avg_rating: number | null;
}

interface AdminReport {
  id: string; restaurant_id: string; restaurant_name: string; address: string;
  restaurant_status: string; reason: string; detail: string | null;
  ai_action: string; ai_summary: string; ai_confidence: number;
  reporter_name: string | null; created_at: string;
}

interface ActivityLog {
  id: string; action: string; target_type: string; target_id: string;
  log_detail: string | null; stage: string; created_at: string;
  actor_id: string | null; actor_name: string | null; actor_email: string | null;
  actor_total_reports: string;
  // Restaurant report
  report_reason: string | null; report_notes: string | null;
  ai_action: string | null; ai_summary: string | null; ai_confidence: number | null;
  rp_resolved_at: string | null; rp_resolver_name: string | null;
  // Review report
  rr_reason: string | null; rr_notes: string | null;
  rr_ai_action: string | null; rr_ai_summary: string | null; rr_ai_confidence: number | null;
  rr_resolved_at: string | null; rr_resolver_name: string | null;
  // Restaurant target
  restaurant_name: string | null; restaurant_address: string | null;
  restaurant_status: string | null; restaurant_cuisine: string[] | null;
  restaurant_report_count: number | null;
  // Review target
  review_rating: number | null; review_body: string | null; review_hidden: boolean | null;
  review_author_name: string | null;
  review_restaurant_id: string | null; review_restaurant_name: string | null;
}

interface AdminUser {
  id: string; name: string; email: string; account_tier: string;
  scans_remaining: number; role: string | null; created_at: string;
  scan_count: string; review_count: string; last_active: string | null;
  active_30d: boolean;
}

interface UserStats {
  total: number; pro_count: number; active_7d: number; active_30d: number;
}

const STATUS_BADGE: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  pending:  'bg-amber-100 text-amber-700',
  flagged:  'bg-red-100 text-red-600',
  removed:  'bg-gray-100 text-gray-500',
};

const REASON_LABELS: Record<string, string> = {
  wrong_info: 'Wrong info',
  fake_listing: 'Fake listing',
  offensive_content: 'Offensive content',
  incorrect_dietary_tags: 'Incorrect dietary tags',
  other: 'Other',
};

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('activity');
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [actioning, setActioning] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ pending: number; flagged: number; activity: number } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userTierFilter, setUserTierFilter] = useState('');
  const [userActioning, setUserActioning] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [seedCity, setSeedCity] = useState('');
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedLog, setSeedLog] = useState<string[]>([]);
  const [clearingSeeds, setClearingSeeds] = useState(false);
  const [seedSuggestions, setSeedSuggestions] = useState<{ display_name: string; place_id: number }[]>([]);
  const [showSeedSuggestions, setShowSeedSuggestions] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    if (status === 'authenticated' && session.user.role !== 'admin' && session.user.role !== 'moderator') {
      router.push('/');
    }
    if (status === 'authenticated') {
      fetch('/api/admin/counts').then(r => r.json()).then(d => {
        if (d && typeof d.pending === 'number') setCounts(d);
      }).catch(() => {});
    }
  }, [status, session, router]);

  const fetchRestaurants = useCallback(async (s = statusFilter, q = search) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (s) params.set('status', s);
    if (q) params.set('q', q);
    const data = await fetch(`/api/admin/restaurants?${params}`).then(r => r.json());
    if (Array.isArray(data)) setRestaurants(data);
    setLoading(false);
  }, [statusFilter, search]);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/admin/reports').then(r => r.json());
    if (Array.isArray(data)) setReports(data);
    setLoading(false);
  }, []);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    const data = await fetch('/api/admin/activity').then(r => r.json());
    if (Array.isArray(data)) setActivity(data);
    setLoading(false);
  }, []);

  const fetchUsers = useCallback(async (q = userSearch, tier = userTierFilter) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tier) params.set('tier', tier);
    const data = await fetch(`/api/admin/users?${params}`).then(r => r.json());
    if (data.users) { setUsers(data.users); setUserStats(data.stats); }
    setLoading(false);
  }, [userSearch, userTierFilter]);

  const fetchFlags = useCallback(async () => {
    const data = await fetch('/api/admin/feature-flags').then(r => r.json()).catch(() => []);
    if (Array.isArray(data)) {
      setFlags(Object.fromEntries(data.map((f: { key: string; enabled: boolean }) => [f.key, f.enabled])));
    }
  }, []);

  const toggleFlag = async (key: string, enabled: boolean) => {
    setFlags(f => ({ ...f, [key]: enabled }));
    await fetch('/api/admin/feature-flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, enabled }),
    });
  };

  const runSeed = async () => {
    if (!seedCity.trim() || seedLoading) return;
    setSeedLoading(true);
    setSeedLog([]);
    setShowSeedSuggestions(false);
    const res = await fetch('/api/admin/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: seedCity }),
    });
    const data = await res.json();
    setSeedLog(data.log ?? (data.error ? [`[!!] ${data.error}`] : ['[!!] Unknown error']));
    setSeedLoading(false);
  };

  const clearSeeds = async () => {
    if (!confirm('Remove all seed restaurants with no community reviews? This cannot be undone.')) return;
    setClearingSeeds(true);
    const res = await fetch('/api/admin/seed', { method: 'DELETE' });
    const data = await res.json();
    setClearingSeeds(false);
    alert(`Removed ${data.deleted} seed restaurants.`);
  };

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (tab === 'pending') fetchRestaurants('pending', '');
    else if (tab === 'flagged') fetchReports();
    else if (tab === 'all') fetchRestaurants(statusFilter, search);
    else if (tab === 'accounts') fetchUsers('', '');
    else if (tab === 'activity') fetchActivity();
    else if (tab === 'settings') fetchFlags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status]);

  const refreshCounts = useCallback(() => {
    fetch('/api/admin/counts').then(r => r.json()).then(d => {
      if (d && typeof d.pending === 'number') setCounts(d);
    }).catch(() => {});
  }, []);

  const restaurantAction = async (id: string, action: string) => {
    setActioning(id);
    await fetch('/api/admin/restaurants', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    setRestaurants(r => r.filter(x => x.id !== id));
    setActioning(null);
    refreshCounts();
  };

  const reportAction = async (reportId: string, action: string) => {
    setActioning(reportId);
    await fetch('/api/admin/reports', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId, action }),
    });
    setReports(r => r.filter(x => x.id !== reportId));
    setActioning(null);
    refreshCounts();
  };

  const userAction = async (userId: string, action: string) => {
    setUserActioning(userId);
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    });
    await fetchUsers(userSearch, userTierFilter);
    setUserActioning(null);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'activity', label: 'Activity Log',   count: tab === 'activity' ? activity.length : (counts?.activity ?? undefined) },
    { id: 'pending',  label: 'Pending',        count: tab === 'pending'  ? restaurants.length : (counts?.pending ?? undefined) },
    { id: 'flagged',  label: 'Flagged',        count: tab === 'flagged'  ? reports.length    : (counts?.flagged ?? undefined) },
    { id: 'all',      label: 'Restaurants' },
    { id: 'accounts', label: 'Accounts' },
    { id: 'settings', label: 'Settings' },
  ];

  if (status === 'loading') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="animate-spin text-gray-400" size={28} />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-xs text-gray-400">{session?.user?.email}</p>
        </div>
        <a href="/" className="text-sm text-violet-600 hover:text-violet-700">← Back to app</a>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t.label}
              {t.count != null && (
                <span className={clsx('ml-1.5 text-xs px-1.5 py-0.5 rounded-full',
                  t.count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
                )}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">

        {/* ── Pending ── */}
        {tab === 'pending' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">New submissions the AI wasn&apos;t confident about. Review and approve or reject.</p>
            {loading && <Loader2 className="animate-spin text-gray-400 mx-auto mt-8" size={24} />}
            {!loading && restaurants.length === 0 && (
              <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-100">
                <CheckCircle size={28} className="mx-auto mb-2 text-green-400" />
                <p className="font-medium">Queue is clear</p>
              </div>
            )}
            {restaurants.map(r => (
              <RestaurantCard key={r.id} r={r} actioning={actioning}
                onAction={restaurantAction}
                actions={[
                  { label: 'Approve', action: 'approve', icon: <CheckCircle size={13} />, cls: 'bg-green-600 text-white hover:bg-green-700' },
                  { label: 'Reject',  action: 'reject',  icon: <XCircle size={13} />,    cls: 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100' },
                ]}
              />
            ))}
          </div>
        )}

        {/* ── Flagged ── */}
        {tab === 'flagged' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Reports the AI assessed as credible. Dismiss, restore, or permanently remove the listing.</p>
            {loading && <Loader2 className="animate-spin text-gray-400 mx-auto mt-8" size={24} />}
            {!loading && reports.length === 0 && (
              <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-100">
                <CheckCircle size={28} className="mx-auto mb-2 text-green-400" />
                <p className="font-medium">No flagged reports</p>
              </div>
            )}
            {reports.map(rp => (
              <div key={rp.id} className="bg-white rounded-xl border border-red-100 p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{rp.restaurant_name}</p>
                    <p className="text-xs text-gray-400">{rp.address}</p>
                  </div>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_BADGE[rp.restaurant_status] ?? STATUS_BADGE.pending)}>
                    {rp.restaurant_status}
                  </span>
                </div>
                <div className="bg-red-50 rounded-lg p-3 space-y-1">
                  <p className="text-xs font-semibold text-red-700">{REASON_LABELS[rp.reason] ?? rp.reason}</p>
                  {rp.detail && <p className="text-xs text-red-600">{rp.detail}</p>}
                </div>
                <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
                  <Flag size={12} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-gray-600">{rp.ai_summary}</p>
                    <p className="text-xs text-gray-400 mt-0.5">AI confidence: {rp.ai_confidence}% · {new Date(rp.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  {actioning === rp.id
                    ? <Loader2 size={14} className="animate-spin text-gray-400" />
                    : <>
                        <button onClick={() => reportAction(rp.id, 'dismiss')}
                          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                          Dismiss
                        </button>
                        <button onClick={() => reportAction(rp.id, 'restore')}
                          className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg border border-green-200 transition-colors flex items-center gap-1">
                          <RotateCcw size={11} /> Restore
                        </button>
                        <button onClick={() => reportAction(rp.id, 'remove')}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors flex items-center gap-1">
                          <XCircle size={11} /> Remove
                        </button>
                      </>
                  }
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── All Restaurants ── */}
        {tab === 'all' && (
          <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text" placeholder="Search name or address…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchRestaurants(statusFilter, search)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); fetchRestaurants(e.target.value, search); }}
                  className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="flagged">Flagged</option>
                  <option value="removed">Removed</option>
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <button
                onClick={() => fetchRestaurants(statusFilter, search)}
                className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
              >
                Search
              </button>
            </div>
            {loading && <Loader2 className="animate-spin text-gray-400 mx-auto mt-8" size={24} />}
            {!loading && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">Restaurant</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Reports</th>
                      <th className="px-4 py-3 text-left">Date Added</th>
                      <th className="px-4 py-3 text-left">Added By</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {restaurants.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{r.name}</p>
                          <p className="text-xs text-gray-400">{r.address}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_BADGE[r.status] ?? STATUS_BADGE.pending)}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{r.report_count}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(r.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.added_by_name
                            ? <><p className="font-medium text-gray-700">{r.added_by_name}</p>
                                {r.added_by_email && <p className="text-gray-400">{r.added_by_email}</p>}</>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {actioning === r.id
                            ? <Loader2 size={13} className="animate-spin text-gray-400" />
                            : <RestaurantActionDropdown r={r} onAction={restaurantAction} />
                          }
                        </td>
                      </tr>
                    ))}
                    {restaurants.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No results</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Accounts ── */}
        {tab === 'accounts' && (
          <div className="space-y-5">
            {/* Summary stats */}
            {userStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Accounts', value: userStats.total },
                  { label: 'Pro Users',       value: userStats.pro_count,  accent: 'text-violet-600' },
                  { label: 'Active (7 days)', value: userStats.active_7d,  accent: 'text-green-600' },
                  { label: 'Active (30 days)',value: userStats.active_30d, accent: 'text-blue-600' },
                ].map(s => (
                  <div key={s.label} className="bg-white rounded-xl border border-gray-100 px-4 py-3">
                    <p className={clsx('text-2xl font-bold', s.accent ?? 'text-gray-900')}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text" placeholder="Search name or email…"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchUsers(userSearch, userTierFilter)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300"
                />
              </div>
              <div className="relative">
                <select
                  value={userTierFilter}
                  onChange={e => { setUserTierFilter(e.target.value); fetchUsers(userSearch, e.target.value); }}
                  className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white"
                >
                  <option value="">All plans</option>
                  <option value="pro">Pro</option>
                  <option value="free">Free</option>
                </select>
                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              <button
                onClick={() => fetchUsers(userSearch, userTierFilter)}
                className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors"
              >
                Search
              </button>
            </div>

            {loading && <Loader2 className="animate-spin text-gray-400 mx-auto mt-8" size={24} />}
            {!loading && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left">Plan</th>
                      <th className="px-4 py-3 text-left">Role</th>
                      <th className="px-4 py-3 text-left">Scans</th>
                      <th className="px-4 py-3 text-left">Reviews</th>
                      <th className="px-4 py-3 text-left">Active 30d</th>
                      <th className="px-4 py-3 text-left">Last Active</th>
                      <th className="px-4 py-3 text-left">Joined</th>
                      <th className="px-4 py-3 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{u.name || <span className="text-gray-400 italic">No name</span>}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                            u.account_tier === 'pro' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
                          )}>
                            {u.account_tier === 'pro' ? 'Pro' : 'Free'}
                          </span>
                          {u.account_tier === 'free' && u.scans_remaining > 0 && (
                            <span className="ml-1 text-xs text-gray-400">({u.scans_remaining} left)</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {u.role ? (
                            <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                              u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            )}>
                              {u.role}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.scan_count}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{u.review_count}</td>
                        <td className="px-4 py-3 text-xs">
                          <span className={clsx('font-medium', u.active_30d ? 'text-green-600' : 'text-gray-300')}>
                            {u.active_30d ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {u.last_active ? new Date(u.last_active).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          {userActioning === u.id
                            ? <Loader2 size={13} className="animate-spin text-gray-400" />
                            : <UserActionDropdown user={u} onAction={userAction} />
                          }
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Activity Log ── */}
        {tab === 'activity' && (
          <ActivityLogTab activity={activity} loading={loading} onRefresh={fetchActivity} />
        )}

        {/* ── Settings ── */}
        {tab === 'settings' && (
          <div className="space-y-6 max-w-xl">

            {/* Feature Flags */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Feature Flags</h2>
                <p className="text-xs text-gray-400 mt-0.5">Toggle features on or off without a deployment.</p>
              </div>
              <div className="flex items-start justify-between gap-4 py-3 border-t border-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">Seed Data</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Show OpenStreetMap restaurants on the community map. These have no dietary info until the community verifies them.
                  </p>
                  {flags['seed_data'] && (
                    <p className="text-xs text-amber-600 mt-1">
                      Currently visible to all users. Disable to hide from the map instantly.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => toggleFlag('seed_data', !flags['seed_data'])}
                  className={clsx(
                    'relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200',
                    flags['seed_data'] ? 'bg-violet-600' : 'bg-gray-200'
                  )}
                >
                  <span className={clsx(
                    'absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200',
                    flags['seed_data'] ? 'translate-x-5' : 'translate-x-1'
                  )} />
                </button>
              </div>
            </div>

            {/* Seed Restaurants */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Seed Restaurants</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Import restaurants from OpenStreetMap for a city. Only adds restaurants not already in the database.
                  Enable the Seed Data flag above to show them on the map.
                </p>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="City name, e.g. Auckland, New Zealand"
                    value={seedCity}
                    onChange={async e => {
                      const val = e.target.value;
                      setSeedCity(val);
                      if (val.trim().length < 2) { setSeedSuggestions([]); setShowSeedSuggestions(false); return; }
                      try {
                        const res = await fetch(
                          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(val)}&format=json&limit=5`,
                          { headers: { 'User-Agent': 'DietMap/1.0' } }
                        );
                        const data = await res.json();
                        setSeedSuggestions(data);
                        setShowSeedSuggestions(data.length > 0);
                      } catch { setSeedSuggestions([]); setShowSeedSuggestions(false); }
                    }}
                    onKeyDown={e => { if (e.key === 'Enter') { setShowSeedSuggestions(false); runSeed(); } if (e.key === 'Escape') setShowSeedSuggestions(false); }}
                    onBlur={() => setTimeout(() => setShowSeedSuggestions(false), 150)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300"
                  />
                  {showSeedSuggestions && seedSuggestions.length > 0 && (
                    <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {seedSuggestions.map(s => (
                        <li
                          key={s.place_id}
                          onMouseDown={() => { setSeedCity(s.display_name); setShowSeedSuggestions(false); }}
                          className="px-3 py-2 text-xs text-gray-700 hover:bg-violet-50 cursor-pointer truncate"
                        >
                          {s.display_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={runSeed}
                  disabled={!seedCity.trim() || seedLoading}
                  className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-40 flex items-center gap-1.5"
                >
                  {seedLoading ? <><Loader2 size={13} className="animate-spin" /> Seeding…</> : 'Seed'}
                </button>
              </div>
              {seedLog.length > 0 && (
                <div className="font-mono text-xs bg-gray-950 text-gray-100 rounded-lg p-3 space-y-0.5 max-h-48 overflow-y-auto">
                  {seedLog.map((line, i) => (
                    <p key={i} className={clsx(
                      line.startsWith('[!!]') ? 'text-red-400' :
                      line.startsWith('[OK]') ? 'text-green-400' :
                      line.startsWith('[--]') ? 'text-gray-400' :
                      line.startsWith('[..]') ? 'text-blue-300' :
                      'text-gray-300'
                    )}>{line}</p>
                  ))}
                </div>
              )}
              <div className="pt-2 border-t border-gray-50">
                <button
                  onClick={clearSeeds}
                  disabled={clearingSeeds}
                  className="text-xs text-red-500 hover:text-red-600 transition-colors"
                >
                  {clearingSeeds ? 'Removing…' : 'Remove all seed restaurants with no community reviews'}
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ── Restaurant card component (used in Pending tab) ───────────────────────────

function RestaurantCard({ r, actioning, onAction, actions }: {
  r: AdminRestaurant;
  actioning: string | null;
  onAction: (id: string, action: string) => void;
  actions: { label: string; action: string; icon: React.ReactNode; cls: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900">{r.name}</p>
          <p className="text-xs text-gray-400">{r.address}</p>
          {r.cuisine_type?.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{r.cuisine_type.join(' · ')}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_BADGE[r.status] ?? STATUS_BADGE.pending)}>
            {r.status}
          </span>
          <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* AI verdict */}
      {r.ai_verdict && (
        <div className={clsx('rounded-lg p-3 space-y-1', r.ai_verdict.verdict === 'review' ? 'bg-amber-50' : 'bg-gray-50')}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-700">AI verdict:</span>
            <span className={clsx('text-xs font-bold', {
              approve: 'text-green-600', review: 'text-amber-600', reject: 'text-red-600'
            }[r.ai_verdict.verdict])}>
              {r.ai_verdict.verdict.toUpperCase()}
            </span>
            <span className="text-xs text-gray-400">{r.ai_verdict.confidence}% confidence</span>
          </div>
          {r.ai_verdict.reasons.length > 0 && (
            <ul className="space-y-0.5">
              {r.ai_verdict.reasons.map((reason, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                  <span className="text-gray-300 mt-0.5">•</span>{reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {r.added_by_name && (
        <p className="text-xs text-gray-400">Submitted by: {r.added_by_name}</p>
      )}

      <button
        onClick={() => setExpanded(v => !v)}
        className="text-xs text-violet-600 hover:text-violet-700"
      >
        {expanded ? 'Hide details' : 'Show full listing details'}
      </button>
      {expanded && (
        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
          <p><span className="font-medium">Source:</span> {r.source}</p>
          <p><span className="font-medium">Reviews:</span> {r.review_count} {r.avg_rating != null ? `· avg ${r.avg_rating}★` : ''}</p>
          <p><span className="font-medium">Reports:</span> {r.report_count}</p>
        </div>
      )}

      <div className="flex gap-2 pt-1 border-t border-gray-50">
        {actioning === r.id
          ? <Loader2 size={14} className="animate-spin text-gray-400" />
          : actions.map(a => (
              <button key={a.action}
                onClick={() => onAction(r.id, a.action)}
                className={clsx('flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors', a.cls)}
              >
                {a.icon}{a.label}
              </button>
            ))
        }
      </div>
    </div>
  );
}

// ── RestaurantActionDropdown ──────────────────────────────────────────────────

function RestaurantActionDropdown({ r, onAction }: {
  r: AdminRestaurant;
  onAction: (id: string, action: string) => void;
}) {
  const [val, setVal] = useState('');
  return (
    <select
      value={val}
      onChange={e => {
        const action = e.target.value;
        if (!action) return;
        if (action === 'delete' && !confirm(`Permanently delete "${r.name}"? This cannot be undone.`)) {
          setVal(''); return;
        }
        onAction(r.id, action);
        setVal('');
      }}
      className="appearance-none pl-2.5 pr-7 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer"
    >
      <option value="">Actions ▾</option>
      {r.status !== 'active'   && <option value="approve">Approve</option>}
      {r.status === 'removed'  && <option value="restore">Restore</option>}
      {r.status !== 'removed'  && <option value="archive">Archive (hide from map)</option>}
      {r.status !== 'flagged'  && <option value="flag">Flag for review</option>}
      <option value="delete">Delete permanently</option>
    </select>
  );
}

// ── UserActionDropdown ────────────────────────────────────────────────────────

function UserActionDropdown({ user: u, onAction }: {
  user: AdminUser;
  onAction: (id: string, action: string) => void;
}) {
  const [val, setVal] = useState('');
  return (
    <select
      value={val}
      onChange={e => {
        const action = e.target.value;
        if (!action) return;
        if (action === 'delete_account' && !confirm(`Delete account for ${u.email}? This cannot be undone.`)) {
          setVal(''); return;
        }
        onAction(u.id, action);
        setVal('');
      }}
      className="appearance-none pl-2.5 pr-7 py-1 text-xs border border-gray-200 rounded-lg bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-300 cursor-pointer"
    >
      <option value="">Actions ▾</option>
      {u.account_tier !== 'pro' && <option value="make_pro">Make Pro</option>}
      {u.account_tier === 'pro'  && <option value="make_free">Make Free User</option>}
      <option value="make_moderator">Make Moderator</option>
      <option value="make_admin">Make Admin</option>
      {u.role && <option value="remove_role">Remove Role</option>}
      <option value="delete_account">Delete Account</option>
    </select>
  );
}

// ── ActivityCard ──────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  restaurant_submitted:  'Restaurant Submitted',
  review_submitted:      'Review Submitted',
  restaurant_reported:   'Restaurant Reported',
  review_reported:       'Review Reported',
  report_restore:        'Report Restored',
  admin_approve:         'Restaurant Approved',
  admin_reject:          'Restaurant Rejected',
  admin_remove:          'Restaurant Removed',
  admin_archive:         'Restaurant Archived',
  admin_restore:         'Restaurant Restored',
  admin_flag:            'Restaurant Flagged',
  admin_delete:          'Restaurant Deleted',
  admin_review_removed:  'Review Removed',
  admin_review_restored: 'Review Restored',
  dismiss:               'Report Dismissed',
  user_upgraded_pro:     'User Upgraded to Pro',
  user_downgraded_free:  'User Downgraded to Free',
  user_role_changed:     'Role Changed',
  user_deleted:          'Account Deleted',
};

const REVIEW_REASON_LABELS: Record<string, string> = {
  wrong_info:             'Wrong info',
  fake_listing:           'Fake listing',
  offensive_content:      'Offensive content',
  incorrect_dietary_tags: 'Incorrect dietary tags',
  spam:                   'Spam or fake review',
  offensive:              'Offensive or inappropriate',
  fake_review:            'Not a genuine experience',
  incorrect_info:         'Incorrect dietary information',
  other:                  'Other',
};


// ── Helpers: parse AI verdict from log_detail ────────────────────────────────

function parseRestaurantSubmissionAI(detail: string | null) {
  if (!detail) return null;
  if (detail.includes('bypassed AI check')) return { action: 'admin_bypass' as const, confidence: null as number | null };
  const m = detail.match(/AI: (approve|review|reject) \((\d+)%\)/);
  if (!m) return null;
  return { action: m[1] as 'approve' | 'review' | 'reject', confidence: parseInt(m[2]) };
}

function parseReviewSubmissionAI(detail: string | null) {
  if (!detail) return null;
  const m = detail.match(/AI: (approve|flag|remove) \((\d+)%\) — (.+?)(?:\s*—\s*auto-hidden)?\s*$/);
  if (!m) return null;
  return { action: m[1] as 'approve' | 'flag' | 'remove', confidence: parseInt(m[2]), summary: m[3].trim() };
}

// Group restaurant_submitted entries with their matching review_submitted
function groupActivities(activity: ActivityLog[]): { main: ActivityLog; linkedReview?: ActivityLog }[] {
  const linkedReviewIds = new Set<string>();
  const reviewPairs = new Map<string, ActivityLog>();
  for (const a of activity) {
    if (a.action === 'restaurant_submitted' && a.target_id) {
      const review = activity.find(b =>
        b.action === 'review_submitted' && b.review_restaurant_id === a.target_id
      );
      if (review) { reviewPairs.set(a.id, review); linkedReviewIds.add(review.id); }
    }
  }
  return activity
    .filter(a => !linkedReviewIds.has(a.id))
    .map(a => ({ main: a, linkedReview: reviewPairs.get(a.id) }));
}

// ── ActivityLogTab (with auto-refresh while entries are processing) ────────────

function ActivityLogTab({ activity, loading, onRefresh }: {
  activity: ActivityLog[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const hasProcessing = activity.some(a => a.stage === 'received' || a.stage === 'ai_reviewing');

  useEffect(() => {
    if (!hasProcessing) return;
    const t = setInterval(onRefresh, 4000);
    return () => clearInterval(t);
  }, [hasProcessing, onRefresh]);

  return (
    <div className="space-y-3">
      {loading && activity.length === 0 && <Loader2 className="animate-spin text-gray-400 mx-auto mt-8" size={24} />}
      {!loading && activity.length === 0 && (
        <div className="text-center py-16 text-gray-400">No activity yet</div>
      )}
      {hasProcessing && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Loader2 size={12} className="animate-spin flex-shrink-0" />
          AI review in progress — refreshing automatically…
        </div>
      )}
      {groupActivities(activity).map(({ main, linkedReview }) => (
        <ActivityCard key={main.id} a={main} linkedReview={linkedReview} onRefresh={onRefresh} />
      ))}
    </div>
  );
}

function ActivityCard({ a, linkedReview, onRefresh }: { a: ActivityLog; linkedReview?: ActivityLog; onRefresh: () => void }) {
  const [actioning, setActioning] = useState(false);
  const isReport = a.action === 'restaurant_reported' || a.action === 'review_reported';
  const isSubmission = a.action === 'restaurant_submitted' || a.action === 'review_submitted';
  const reason = a.report_reason ?? a.rr_reason;
  const notes  = a.report_notes  ?? a.rr_notes;
  const totalReports = parseInt(a.actor_total_reports ?? '0');
  // Unify AI fields across both report types
  const aiAction     = a.ai_action     ?? a.rr_ai_action;
  const aiSummary    = a.ai_summary    ?? a.rr_ai_summary;
  const aiConfidence = a.ai_confidence ?? a.rr_ai_confidence;
  const resolvedAt   = a.rp_resolved_at   ?? a.rr_resolved_at;
  const resolverName = a.rp_resolver_name ?? a.rr_resolver_name;

  // Timeline steps
  const steps: { label: string; sub?: string; done: boolean; loading?: boolean; color?: string }[] = [
    {
      label: `Report placed by ${a.actor_name ?? 'Unknown'}`,
      sub: `${a.actor_email ?? ''}${totalReports > 1 ? ` · ${totalReports} total reports` : ''}${notes ? ` · "${notes}"` : ''}`,
      done: true,
      color: 'bg-blue-500',
    },
    {
      label: a.stage === 'received' ? 'Waiting for AI review…'
           : a.stage === 'ai_reviewing' ? 'AI reviewing…'
           : a.stage === 'error' ? 'AI review failed'
           : aiAction
             ? `AI reviewed — ${aiAction === 'dismiss' ? 'No violation found' : aiAction === 'flag' ? 'Flagged for review' : 'Removal recommended'}`
             : 'AI reviewed',
      sub: aiAction
        ? `${aiConfidence != null ? `${aiConfidence}% confidence · ` : ''}${aiSummary ?? ''}`
        : a.stage === 'error' ? (a.log_detail ?? '') : undefined,
      done: a.stage === 'complete' || a.stage === 'error',
      loading: a.stage === 'ai_reviewing',
      color: a.stage === 'error' ? 'bg-red-400'
           : aiAction === 'dismiss' ? 'bg-green-500'
           : aiAction === 'flag'    ? 'bg-amber-500'
           : aiAction === 'remove'  ? 'bg-red-500'
           : 'bg-gray-300',
    },
  ];

  if (resolvedAt) {
    const isRemoved = a.review_hidden;
    steps.push({
      label: isRemoved ? 'Review removed by admin' : `Report resolved by ${resolverName ?? 'admin'}`,
      sub: new Date(resolvedAt).toLocaleString(),
      done: true,
      color: 'bg-gray-500',
    });
  }

  // ── Submission timeline steps ─────────────────────────────────────────────
  const submissionSteps: typeof steps = [];
  if (isSubmission) {
    if (a.action === 'restaurant_submitted') {
      const ai = parseRestaurantSubmissionAI(a.log_detail);
      submissionSteps.push({
        label: `Restaurant submitted by ${a.actor_name ?? 'Unknown'}`,
        sub: a.actor_email ?? undefined,
        done: true,
        color: 'bg-blue-500',
      });
      if (ai) {
        if (ai.action === 'admin_bypass') {
          submissionSteps.push({ label: 'Admin bypass — no AI check', done: true, color: 'bg-gray-400' });
        } else {
          const verdictColor = ai.action === 'approve' ? 'bg-green-500' : ai.action === 'review' ? 'bg-amber-500' : 'bg-red-500';
          const verdictLabel = ai.action === 'approve'
            ? `AI approved (${ai.confidence}%) — listed on map`
            : ai.action === 'review'
            ? `AI flagged for review (${ai.confidence}%) — pending`
            : `AI rejected (${ai.confidence}%)`;
          submissionSteps.push({ label: verdictLabel, sub: a.restaurant_status ? `Status: ${a.restaurant_status}` : undefined, done: true, color: verdictColor });
        }
      }
      if (linkedReview) {
        const reviewAI = parseReviewSubmissionAI(linkedReview.log_detail);
        const isPending = linkedReview.stage === 'received' || linkedReview.stage === 'ai_reviewing';
        submissionSteps.push({
          label: `Review submitted${linkedReview.review_rating != null ? ` (${linkedReview.review_rating}★)` : ''}`,
          sub: linkedReview.review_body ? `"${linkedReview.review_body.slice(0, 100)}${linkedReview.review_body.length > 100 ? '…' : ''}"` : undefined,
          done: true,
          color: 'bg-blue-400',
        });
        submissionSteps.push({
          label: isPending
            ? (linkedReview.stage === 'ai_reviewing' ? 'AI reviewing…' : 'AI screening pending…')
            : reviewAI
              ? (reviewAI.action === 'approve' ? `AI approved review (${reviewAI.confidence}%)`
                : reviewAI.action === 'flag'   ? `AI flagged review (${reviewAI.confidence}%)`
                :                                `AI removed review (${reviewAI.confidence}%)`)
              : 'AI screened',
          sub: reviewAI?.summary ?? (linkedReview.review_hidden ? 'Review auto-hidden' : undefined),
          done: !isPending,
          loading: linkedReview.stage === 'ai_reviewing',
          color: isPending ? 'bg-gray-300'
               : reviewAI?.action === 'approve' ? 'bg-green-500'
               : reviewAI?.action === 'flag'    ? 'bg-amber-500'
               : reviewAI?.action === 'remove'  ? 'bg-red-500'
               : 'bg-gray-400',
        });
      }
    } else {
      // Standalone review_submitted
      const reviewAI = parseReviewSubmissionAI(a.log_detail);
      const isPending = a.stage === 'received' || a.stage === 'ai_reviewing';
      submissionSteps.push({
        label: `Review submitted${a.review_rating != null ? ` (${a.review_rating}★)` : ''} by ${a.actor_name ?? 'Unknown'}`,
        sub: a.review_body ? `"${a.review_body.slice(0, 100)}${a.review_body.length > 100 ? '…' : ''}"` : undefined,
        done: true,
        color: 'bg-blue-500',
      });
      submissionSteps.push({
        label: isPending
          ? (a.stage === 'ai_reviewing' ? 'AI reviewing…' : 'AI screening pending…')
          : reviewAI
            ? (reviewAI.action === 'approve' ? `AI approved (${reviewAI.confidence}%)`
              : reviewAI.action === 'flag'   ? `AI flagged (${reviewAI.confidence}%)`
              :                                `AI removed (${reviewAI.confidence}%)`)
            : 'AI screened',
        sub: reviewAI?.summary ?? (a.review_hidden ? 'Review auto-hidden' : undefined),
        done: !isPending,
        loading: a.stage === 'ai_reviewing',
        color: isPending ? 'bg-gray-300'
             : reviewAI?.action === 'approve' ? 'bg-green-500'
             : reviewAI?.action === 'flag'    ? 'bg-amber-500'
             : reviewAI?.action === 'remove'  ? 'bg-red-500'
             : 'bg-gray-400',
      });
    }
  }

  const doReviewAction = async (action: 'remove' | 'restore' | 'dismiss') => {
    setActioning(true);
    await fetch('/api/admin/reviews', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewId: a.target_id, action, reportId: a.id }),
    });
    setActioning(false);
    onRefresh();
  };

  return (
    <div className={clsx('bg-white rounded-xl border p-4 space-y-3', a.stage === 'error' ? 'border-red-100' : 'border-gray-100')}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full">
            {ACTION_LABELS[a.action] ?? a.action}
          </span>
          {reason && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {REVIEW_REASON_LABELS[reason] ?? reason}
            </span>
          )}
          {a.target_type === 'review' && a.review_hidden && (
            <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Review hidden</span>
          )}
        </div>
        <p className="text-xs text-gray-400 flex-shrink-0">{new Date(a.created_at).toLocaleString()}</p>
      </div>

      {/* Review details (only for review reports — submissions show body in timeline) */}
      {a.target_type === 'review' && a.review_body && !isSubmission && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          {a.review_restaurant_name && (
            <p className="text-xs font-semibold text-gray-700">{a.review_restaurant_name}</p>
          )}
          <div className="flex items-center gap-2">
            {a.review_rating != null && (
              <span className="text-amber-500 text-xs">{'★'.repeat(a.review_rating)}{'☆'.repeat(5 - a.review_rating)}</span>
            )}
            {a.review_author_name && <span className="text-xs text-gray-400">by {a.review_author_name}</span>}
          </div>
          {a.review_body && <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{a.review_body}</p>}
        </div>
      )}

      {/* Restaurant details */}
      {a.target_type === 'restaurant' && a.restaurant_name && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-700">{a.restaurant_name}</p>
          {a.restaurant_address && <p className="text-xs text-gray-400">{a.restaurant_address}</p>}
          <div className="flex items-center gap-2">
            {a.restaurant_status && (
              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_BADGE[a.restaurant_status] ?? STATUS_BADGE.pending)}>
                {a.restaurant_status}
              </span>
            )}
            {a.restaurant_report_count != null && (
              <span className="text-xs text-gray-400">{a.restaurant_report_count} report{a.restaurant_report_count !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      {(isReport || isSubmission) && (
        <div className="space-y-0">
          {(isReport ? steps : submissionSteps).map((step, i) => {
            const allSteps = isReport ? steps : submissionSteps;
            return (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5',
                  step.loading ? 'bg-amber-400 animate-pulse' : step.done ? step.color ?? 'bg-gray-400' : 'bg-gray-200'
                )} />
                {i < allSteps.length - 1 && <div className="w-px flex-1 bg-gray-200 my-1" />}
              </div>
              <div className="pb-3 min-w-0">
                <p className={clsx('text-xs font-medium', step.done ? 'text-gray-800' : 'text-gray-400')}>
                  {step.loading && <Loader2 size={10} className="inline animate-spin mr-1" />}
                  {step.label}
                </p>
                {step.sub && <p className="text-xs text-gray-400 mt-0.5">{step.sub}</p>}
              </div>
            </div>
          ); })}
        </div>
      )}

      {/* Admin actions for review reports */}
      {a.action === 'review_reported' && a.stage === 'complete' && (
        <div className="flex gap-2 pt-1 border-t border-gray-50">
          {actioning
            ? <Loader2 size={13} className="animate-spin text-gray-400" />
            : <>
                {!a.review_hidden
                  ? <button onClick={() => doReviewAction('remove')}
                      className="px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors">
                      Remove review
                    </button>
                  : <button onClick={() => doReviewAction('restore')}
                      className="px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors">
                      Restore review
                    </button>
                }
                {!resolvedAt && (
                  <button onClick={() => doReviewAction('dismiss')}
                    className="px-2.5 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    Dismiss report
                  </button>
                )}
              </>
          }
        </div>
      )}
    </div>
  );
}
