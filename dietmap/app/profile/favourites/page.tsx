'use client';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Restaurant } from '@/lib/types';
import { RestaurantCard } from '@/components/RestaurantCard';
import { Navbar } from '@/components/Navbar';
import { Heart } from 'lucide-react';
import Link from 'next/link';

export default function FavouritesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [favourites, setFavourites] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/users/me/favourites').then(r => r.json()).then(data => {
      setFavourites(Array.isArray(data) ? data : []);
    }).finally(() => setLoading(false));
  }, [session]);

  return (
    <div className="min-h-screen bg-[#fafaf7]">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
          <Heart size={20} className="text-red-400 fill-red-400" />
          My Favourites
        </h1>

        {loading && (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />)}
          </div>
        )}

        {!loading && favourites.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <div className="text-4xl mb-3">💔</div>
            <p className="font-medium">No favourites yet</p>
            <p className="text-sm mt-1 mb-4">Tap the heart icon on any restaurant to save it</p>
            <Link href="/" className="inline-block px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 transition-colors">
              Browse Restaurants
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {favourites.map(r => <RestaurantCard key={r.id} restaurant={r} />)}
        </div>
      </div>
    </div>
  );
}
