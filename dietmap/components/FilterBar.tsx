'use client';
import { DietaryTag, DIETARY_LABELS } from '@/lib/types';
import { Sparkles } from 'lucide-react';
import clsx from 'clsx';

const TAGS: DietaryTag[] = [
  'gluten_free', 'dairy_free', 'vegan', 'vegetarian',
  'keto', 'nut_free', 'halal', 'kosher', 'soy_free', 'egg_free', 'shellfish_free', 'low_fodmap',
];

interface Props {
  selected: DietaryTag[];
  onToggleTag: (tag: DietaryTag) => void;
  isPro?: boolean;
  showAI?: boolean;
  onToggleAI?: () => void;
}

export function FilterBar({ selected, onToggleTag, isPro, showAI = true, onToggleAI }: Props) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-gray-100 overflow-x-auto no-scrollbar">
      {isPro && (
        <>
          <button
            onClick={onToggleAI}
            className={clsx(
              'flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border transition-all whitespace-nowrap',
              showAI
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
            )}
          >
            <Sparkles size={11} />
            AI Picks
          </button>
          <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
        </>
      )}
      {TAGS.map(tag => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            onClick={() => onToggleTag(tag)}
            className={clsx(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-all whitespace-nowrap',
              active
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
            )}
          >
            {DIETARY_LABELS[tag]}
          </button>
        );
      })}
    </div>
  );
}
