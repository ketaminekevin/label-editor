'use client';
import { use, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { RestaurantCard } from '@/components/RestaurantCard';
import { Restaurant } from '@/lib/types';
import { ArrowLeft } from 'lucide-react';

interface ListDetail {
  id: string;
  name: string;
  color: string;
}

export default function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status } = useSession();
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/lists" className="w-8 h-8 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow">
            <ArrowLeft size={14} className="text-gray-600" />
          </Link>
          {list && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: list.color }} />
              <h1 className="text-xl font-bold text-gray-900">{list.name}</h1>
            </div>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-white rounded-xl animate-pulse" />)}
          </div>
        ) : restaurants.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🍽️</div>
            <p className="font-medium text-gray-500">No restaurants in this list yet</p>
            <p className="text-sm mt-1">Open a restaurant on the map and add it to this list</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500">{restaurants.length} restaurant{restaurants.length !== 1 ? 's' : ''}</p>
            <div className="space-y-2">
              {restaurants.map(r => (
                <button
                  key={r.id}
                  className="w-full text-left"
                  onClick={() => router.push(`/?restaurant=${r.id}&lat=${r.lat}&lng=${r.lng}`)}
                >
                  <RestaurantCard restaurant={r} compact hideVerifiedBadge />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
