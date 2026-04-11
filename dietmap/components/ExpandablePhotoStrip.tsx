'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';

export function ExpandablePhotoStrip({ photos }: { photos: string[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  // Keep lastIdx so the image stays visible during the collapse animation
  const [lastIdx, setLastIdx] = useState(0);

  if (!photos.length) return null;

  const open = (i: number) => { setLastIdx(i); setExpandedIdx(i); };
  const close = () => setExpandedIdx(null);
  const prev = (e: React.MouseEvent) => {
    e.stopPropagation();
    const i = ((lastIdx - 1) + photos.length) % photos.length;
    setLastIdx(i); setExpandedIdx(i);
  };
  const next = (e: React.MouseEvent) => {
    e.stopPropagation();
    const i = (lastIdx + 1) % photos.length;
    setLastIdx(i); setExpandedIdx(i);
  };

  return (
    <div className="space-y-2">
      {/* Expanded image — always rendered so collapse can animate */}
      <div
        className={clsx(
          'overflow-hidden transition-all duration-300 ease-in-out',
          expandedIdx !== null ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
        )}
      >
        <div className="relative rounded-xl overflow-hidden bg-gray-100 w-[70%]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photos[lastIdx]}
            alt=""
            className="w-full object-cover cursor-pointer"
            style={{ aspectRatio: '4/3' }}
            onClick={close}
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />

          {/* Prev / Next arrows */}
          {photos.length > 1 && (
            <>
              <button
                onClick={prev}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-7 h-7 flex items-center justify-center transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={next}
                className="absolute right-9 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full w-7 h-7 flex items-center justify-center transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}

          {/* Close */}
          <button
            onClick={e => { e.stopPropagation(); close(); }}
            className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center transition-colors"
          >
            <X size={11} />
          </button>

          {/* Dot indicators */}
          {photos.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={e => { e.stopPropagation(); open(i); }}
                  className={clsx(
                    'w-1.5 h-1.5 rounded-full transition-colors',
                    i === lastIdx ? 'bg-white' : 'bg-white/50 hover:bg-white/80'
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((photo, i) => (
          <button
            key={i}
            onClick={() => expandedIdx === i ? close() : open(i)}
            className={clsx(
              'flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border transition-all duration-200',
              expandedIdx === i
                ? 'border-violet-400 ring-2 ring-violet-200 scale-95'
                : 'border-gray-100 hover:border-violet-300'
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt=""
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
