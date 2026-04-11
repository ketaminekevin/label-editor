'use client';
import { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, Loader2, Star, MapPin, Bookmark, Check, ChevronDown, Download } from 'lucide-react';
import clsx from 'clsx';
import { List, DIETARY_LABELS, DIETARY_ICONS, DietaryTag } from '@/lib/types';

interface AssistantRestaurant {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  avg_rating: number | null;
  review_count: number;
  cuisine_type: string[];
  dietary_tags: string[];
  recommended_dishes?: string[] | null;
  result_type?: 'own_scan' | 'community' | 'other_pro';
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  restaurants?: AssistantRestaurant[];
  suggestSearch?: boolean;
}

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={10} className={i < Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-200'} />
      ))}
    </div>
  );
}

function RestaurantCard({ r, lists, savedIds, onSave, onViewMap }: {
  r: AssistantRestaurant;
  lists: List[];
  savedIds: Record<string, string[]>;
  onSave: (restaurantId: string, listId: string) => void;
  onViewMap: (r: AssistantRestaurant) => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const saved = savedIds[r.id] ?? [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    };
    if (dropdownOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  return (
    <div className={clsx(
      'rounded-xl border p-3 space-y-2 shadow-sm',
      r.result_type === 'other_pro' ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-100'
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{r.name}</p>
          {r.result_type === 'other_pro' && (
            <p className="text-xs text-gray-400 italic mt-0.5">AI suggestion — not yet community verified</p>
          )}
          {r.cuisine_type?.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">{r.cuisine_type.join(' · ')}</p>
          )}
        </div>
        {r.avg_rating != null && (
          <div className="flex flex-col items-end flex-shrink-0">
            <StarRating value={Number(r.avg_rating)} />
            <span className="text-xs text-gray-400 mt-0.5">{Number(r.avg_rating).toFixed(1)} ({r.review_count})</span>
          </div>
        )}
      </div>

      {r.address && (
        <p className="text-xs text-gray-500 flex items-start gap-1">
          <MapPin size={10} className="mt-0.5 flex-shrink-0 text-gray-300" />
          <span className="truncate">{r.address}</span>
        </p>
      )}

      {r.dietary_tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.dietary_tags.slice(0, 4).map(tag => (
            <span key={tag} className="text-xs px-1.5 py-0.5 bg-violet-50 text-violet-700 rounded-full border border-violet-100">
              {tag.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {r.recommended_dishes && r.recommended_dishes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.recommended_dishes.slice(0, 3).map((dish, i) => (
            <span key={i} className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-100">
              {dish}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-gray-50">
        <button
          onClick={() => onViewMap(r)}
          className="flex items-center gap-1 text-xs text-violet-600 font-medium hover:text-violet-800 transition-colors"
        >
          <MapPin size={11} />
          View on map
        </button>

        {lists.length > 0 && (
          <div className="relative ml-auto" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              className={clsx(
                'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition-all',
                saved.length > 0
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600'
              )}
            >
              {saved.length > 0 ? <Check size={10} /> : <Bookmark size={10} />}
              {saved.length > 0 ? 'Saved' : 'Save to list'}
              <ChevronDown size={9} />
            </button>
            {dropdownOpen && (
              <div className="absolute bottom-full right-0 mb-1 w-44 bg-white rounded-xl border border-gray-100 shadow-xl z-50 overflow-hidden">
                {lists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => { onSave(r.id, list.id); setDropdownOpen(false); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-violet-50 transition-colors"
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: list.color }} />
                    <span className="truncate">{list.name}</span>
                    {saved.includes(list.id) && <Check size={10} className="ml-auto text-green-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lists, setLists] = useState<List[]>([]);
  const [savedIds, setSavedIds] = useState<Record<string, string[]>>({});

  // Dietary confirmation state
  const [dietaryConfirmed, setDietaryConfirmed] = useState(false);
  const [profileTags, setProfileTags] = useState<DietaryTag[]>([]);
  const [confirmedTags, setConfirmedTags] = useState<DietaryTag[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [isPro, setIsPro] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch user profile + lists on open
  useEffect(() => {
    if (!open) return;
    fetch('/api/lists').then(r => r.json()).then((data: List[]) => {
      if (Array.isArray(data)) setLists(data);
    }).catch(() => {});

    if (!dietaryConfirmed) {
      setLoadingProfile(true);
      fetch('/api/users/me').then(r => r.json()).then(user => {
        const profile: Record<string, boolean> = user.dietary_profile ?? {};
        const active = Object.entries(profile).filter(([, v]) => v).map(([k]) => k as DietaryTag);
        setProfileTags(active);
        setConfirmedTags(active);
        setIsPro(user.account_tier === 'pro');
      }).catch(() => {}).finally(() => setLoadingProfile(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const confirmDietary = () => {
    setDietaryConfirmed(true);
    const tagNames = confirmedTags.length
      ? confirmedTags.map(t => DIETARY_LABELS[t] ?? t).join(', ')
      : 'no specific dietary restrictions';
    setMessages([{
      role: 'assistant',
      content: `Got it! I'll filter results for: ${tagNames}. What are you looking for?`,
    }]);
  };

  const toggleProfileTag = (tag: DietaryTag) => {
    setConfirmedTags(t => t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag]);
  };

  const saveToList = async (restaurantId: string, listId: string) => {
    setSavedIds(prev => ({ ...prev, [restaurantId]: [...(prev[restaurantId] ?? []), listId] }));
    try {
      await fetch(`/api/lists/${listId}/restaurants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId }),
      });
    } catch {
      setSavedIds(prev => ({ ...prev, [restaurantId]: (prev[restaurantId] ?? []).filter(id => id !== listId) }));
    }
  };

  const viewOnMap = (r: AssistantRestaurant) => {
    window.dispatchEvent(new CustomEvent('dietmap:fly-to', {
      detail: { restaurantId: r.id, lat: r.lat, lng: r.lng },
    }));
    setOpen(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading || !dietaryConfirmed) return;
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const history = newMessages.slice(1, -1).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, userDietaryTags: confirmedTags }),
      });
      const data = await res.json();
      const rawReply: string = data.reply ?? data.error ?? 'Something went wrong.';
      const suggestSearch = rawReply.includes('[SUGGEST_SEARCH]');
      const cleanReply = rawReply.replace(/\[SUGGEST_SEARCH\]/g, '').trim();
      setMessages(m => [...m, {
        role: 'assistant',
        content: cleanReply,
        restaurants: data.restaurants?.length > 0 ? data.restaurants : undefined,
        suggestSearch,
      }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Connection error — please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const goToScan = () => {
    window.location.href = '/scan';
  };

  const downloadLog = () => {
    const lines: string[] = [`DietMap Assistant Log — ${new Date().toLocaleString()}`, ''];
    for (const m of messages) {
      lines.push(m.role === 'user' ? 'You:' : 'Assistant:');
      lines.push(m.content);
      if (m.restaurants?.length) {
        for (const r of m.restaurants) {
          lines.push(`  • ${r.name}${r.address ? ` — ${r.address}` : ''}${r.avg_rating ? ` (${r.avg_rating}★)` : ''}`);
        }
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dietmap-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const ALL_TAGS = Object.keys(DIETARY_LABELS) as DietaryTag[];

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'fixed bottom-5 right-5 z-50 w-13 h-13 rounded-full shadow-lg flex items-center justify-center transition-all',
          open ? 'bg-violet-700 rotate-90' : 'bg-violet-600 hover:bg-violet-700'
        )}
        title="AI Restaurant Assistant"
      >
        {open ? <X size={20} className="text-white" /> : <Sparkles size={20} className="text-white" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[380px] max-h-[580px] flex flex-col bg-gray-50 rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-violet-600 text-white flex-shrink-0">
            <Sparkles size={16} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Restaurant Assistant</p>
              <p className="text-xs text-violet-200">
                {isPro ? 'Pro — scans + community' : 'Community restaurants'}
              </p>
            </div>
            {messages.length > 1 && (
              <button onClick={downloadLog} title="Download conversation" className="text-violet-200 hover:text-white transition-colors">
                <Download size={15} />
              </button>
            )}
            <button onClick={() => setOpen(false)} className="text-violet-200 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Dietary confirmation screen */}
          {!dietaryConfirmed ? (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {loadingProfile ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-violet-400" />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Confirm your dietary restrictions</p>
                    <p className="text-xs text-gray-400 mt-0.5">Results will be filtered to match these. Tap to toggle.</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {ALL_TAGS.map(tag => {
                      const active = confirmedTags.includes(tag);
                      const isFromProfile = profileTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleProfileTag(tag)}
                          className={clsx(
                            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all',
                            active
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300'
                          )}
                        >
                          <span>{DIETARY_ICONS[tag]}</span>
                          {DIETARY_LABELS[tag]}
                          {isFromProfile && !active && <span className="opacity-40">·</span>}
                        </button>
                      );
                    })}
                  </div>

                  {confirmedTags.length === 0 && (
                    <p className="text-xs text-gray-400 italic">No restrictions selected — results will not be filtered by diet.</p>
                  )}

                  <button
                    onClick={confirmDietary}
                    className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Check size={14} />
                    {confirmedTags.length > 0
                      ? `Search with ${confirmedTags.length} restriction${confirmedTags.length !== 1 ? 's' : ''}`
                      : 'Search without restrictions'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Active dietary tags strip */}
              {confirmedTags.length > 0 && (
                <div className="flex-shrink-0 bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs text-gray-400">Filtering:</span>
                  {confirmedTags.map(tag => (
                    <span key={tag} className="text-xs px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full border border-violet-100 flex items-center gap-1">
                      {DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}
                    </span>
                  ))}
                  <button
                    onClick={() => { setDietaryConfirmed(false); setMessages([]); }}
                    className="ml-auto text-xs text-gray-400 hover:text-violet-600 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
                {messages.map((m, i) => (
                  <div key={i} className={clsx('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                    <div className={clsx(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                      m.role === 'user'
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100 shadow-sm'
                    )}>
                      {m.content}
                    </div>
                    {m.restaurants && m.restaurants.length > 0 && (
                      <div className="w-full mt-2 space-y-2">
                        {m.restaurants.map(r => (
                          <RestaurantCard
                            key={r.id}
                            r={r}
                            lists={lists}
                            savedIds={savedIds}
                            onSave={saveToList}
                            onViewMap={viewOnMap}
                          />
                        ))}
                      </div>
                    )}
                    {m.suggestSearch && !loading && (
                      <button
                        onClick={goToScan}
                        className="mt-2 flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
                      >
                        <Sparkles size={12} />
                        Run an AI scan to find options
                      </button>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2 text-gray-400">
                      <Loader2 size={13} className="animate-spin" />
                      <span className="text-xs">Searching restaurants…</span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="flex-shrink-0 border-t border-gray-100 bg-white px-3 py-2.5 flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask about restaurants…"
                  rows={1}
                  className="flex-1 resize-none text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300 max-h-28 overflow-y-auto"
                  style={{ fieldSizing: 'content' } as React.CSSProperties}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  className="w-9 h-9 flex-shrink-0 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors"
                >
                  <Send size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
