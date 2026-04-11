'use client';
import { Star, Sparkles } from 'lucide-react';
import { Restaurant } from '@/lib/types';
import clsx from 'clsx';

interface Props {
  restaurant: Restaurant;
  compact?: boolean;
  hideVerifiedBadge?: boolean;
  onClick?: () => void;
}

const PRICE = ['', '$', '$$', '$$$', '$$$$'];

export function RestaurantCard({ restaurant, compact = false, hideVerifiedBadge = false, onClick }: Props) {
  const isAI = restaurant.source === 'area_scan';

  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white rounded-xl border transition-all duration-150 overflow-hidden',
        isAI
          ? 'border-purple-200 hover:border-purple-400 hover:shadow-sm ring-1 ring-purple-100'
          : 'border-gray-100 hover:border-purple-200 hover:shadow-sm',
        onClick && 'cursor-pointer',
      )}
    >
      {!compact && restaurant.cover_photo_url && (
        <div className="h-32 overflow-hidden bg-gray-100">
          <img
            src={restaurant.cover_photo_url}
            alt={restaurant.name}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {isAI && <Sparkles size={11} className="text-purple-500 flex-shrink-0" />}
              <h3 className="font-semibold text-gray-900 text-sm truncate">{restaurant.name}</h3>
            </div>
            {restaurant.cuisine_type?.length > 0 && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">{restaurant.cuisine_type.join(' · ')}</p>
            )}
            {restaurant.address && (
              <p className="text-xs text-gray-400 truncate mt-0.5">{restaurant.address}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            {restaurant.avg_rating ? (
              <span className="flex items-center gap-0.5 text-xs font-semibold text-gray-700">
                <Star size={11} className="text-amber-500 fill-amber-500" />
                {Number(restaurant.avg_rating).toFixed(1)}
                <span className="font-normal text-gray-400 ml-0.5">({restaurant.review_count ?? 0})</span>
              </span>
            ) : (
              <span className="text-xs text-gray-400">No reviews</span>
            )}
            {restaurant.price_level ? (
              <span className="text-xs text-gray-400">{PRICE[restaurant.price_level]}</span>
            ) : null}
          </div>
        </div>

        {!hideVerifiedBadge && (
          isAI ? (
            <span className="inline-flex items-center gap-1 mt-2 text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
              <Sparkles size={9} />
              Smart Search
            </span>
          ) : !restaurant.verified ? (
            <span className="inline-block mt-2 text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              Community Added
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}
