'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Camera, Upload, AlertTriangle, CheckCircle, XCircle,
  HelpCircle, MessageSquare, RefreshCw,
  Globe, Sparkles, X, Clock,
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { DietaryTag, DIETARY_LABELS, DIETARY_ICONS } from '@/lib/types';
import type { MenuDish, MenuScanResult } from '@/lib/menu-scanner';
import clsx from 'clsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_TAGS: DietaryTag[] = [
  'gluten_free', 'dairy_free', 'vegan', 'vegetarian', 'keto',
  'nut_free', 'soy_free', 'egg_free', 'shellfish_free', 'halal', 'kosher', 'low_fodmap',
];

const LOADING_MESSAGES = [
  'Reading your menu…',
  'Detecting language…',
  'Analysing ingredients…',
  'Checking for hidden risks…',
  'Almost there…',
];

type ScanPhase = 'idle' | 'preview' | 'scanning' | 'results' | 'error';

// ── Image compression ─────────────────────────────────────────────────────────

async function compressImage(file: File, maxBytes = 2 * 1024 * 1024): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    if (file.size <= maxBytes) {
      const reader = new FileReader();
      reader.onload = () => resolve({
        base64: (reader.result as string).split(',')[1],
        mimeType: file.type || 'image/jpeg',
      });
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const scale = Math.sqrt(maxBytes / file.size) * 0.9;
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── Dish card ─────────────────────────────────────────────────────────────────

function DishCard({ dish, category }: { dish: MenuDish; category: 'safe' | 'options' | 'risky' | 'unidentified' }) {
  const borderColor = {
    safe:         'border-green-100',
    options:      'border-amber-100',
    risky:        'border-red-100',
    unidentified: 'border-gray-100',
  }[category];

  const confBadge = {
    hard:        { label: 'Labelled ✓', cls: 'bg-green-50 text-green-700 border-green-200' },
    conditional: { label: 'Ask Staff',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    inferred:    { label: 'Verify with staff', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  }[dish.confidence];

  const showOriginal = dish.original_name && dish.english_name &&
    dish.original_name.toLowerCase() !== dish.english_name.toLowerCase();

  return (
    <div className={clsx('bg-white rounded-xl border p-4 space-y-2.5', borderColor)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-sm leading-tight">
            {dish.english_name || dish.original_name}
          </p>
          {showOriginal && (
            <p className="text-xs text-gray-400 mt-0.5 italic">"{dish.original_name}"</p>
          )}
          {dish.description && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{dish.description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {dish.annotation && (
            <span className="text-xs font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded font-mono">
              {dish.annotation}
            </span>
          )}
          <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap', confBadge.cls)}>
            {confBadge.label}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-700 leading-relaxed">{dish.reason}</p>

      {dish.hidden_risks && dish.hidden_risks.length > 0 && (
        <div className="space-y-1">
          {dish.hidden_risks.map((risk, i) => (
            <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
              <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
              {risk}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({
  icon, label, count, countCls,
}: { icon: React.ReactNode; label: string; count: number; countCls: string }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2 mt-6 mb-2.5">
      {icon}
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      <span className={clsx('ml-auto text-xs font-medium px-2 py-0.5 rounded-full border', countCls)}>
        {count}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MenuScanPage() {
  const { status } = useSession();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageData, setImageData] = useState<{ base64: string; mimeType: string } | null>(null);
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>([]);
  const [result, setResult] = useState<MenuScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUpgrade, setIsUpgrade] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [isPro, setIsPro] = useState<boolean | null>(null); // null = not yet loaded
  const [scansUsed, setScansUsed] = useState(0);
  const [history, setHistory] = useState<Array<{
    id: string;
    restaurant_name: string | null;
    cuisine_type: string | null;
    dietary_tags: string[];
    detected_language: string;
    created_at: string;
    safe_count: number;
    options_count: number;
    risky_count: number;
    total_count: number;
  }>>([]);
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/users/me').then(r => r.json()).then(user => {
      if (user.dietary_profile && typeof user.dietary_profile === 'object') {
        const tags = Object.entries(user.dietary_profile as Record<string, boolean>)
          .filter(([, v]) => v)
          .map(([k]) => k as DietaryTag);
        if (tags.length) setDietaryTags(tags);
      }
      setIsPro(user.account_tier === 'pro');
    }).catch(() => {});
    fetch('/api/menu-scan/usage').then(r => r.json()).then(d => {
      setScansUsed(d.used ?? 0);
    }).catch(() => {});
    fetch('/api/menu-scan').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setHistory(d);
    }).catch(() => {});
  }, [status]);

  useEffect(() => {
    if (phase !== 'scanning') return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[i]);
    }, 1800);
    return () => clearInterval(id);
  }, [phase]);

  const handleFile = useCallback(async (file: File) => {
    setPreviewUrl(URL.createObjectURL(file));
    const compressed = await compressImage(file);
    setImageData(compressed);
    setPhase('preview');
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const toggleTag = (tag: DietaryTag) =>
    setDietaryTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  const scan = async () => {
    if (!imageData) return;
    setPhase('scanning');
    setLoadingMsg(LOADING_MESSAGES[0]);
    try {
      const res = await fetch('/api/menu-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageData.base64, mimeType: imageData.mimeType, dietaryTags }),
      });
      const data = await res.json() as MenuScanResult & { error?: string; upgrade?: boolean };
      if (!res.ok) {
        setIsUpgrade(!!data.upgrade);
        setErrorMsg(data.error ?? 'Scan failed. Please try again.');
        setPhase('error');
        return;
      }
      setResult(data);
      setScansUsed(s => s + 1);
      // Prepend to local history so it appears immediately
      if (data.id) {
        setHistory(prev => [{
          id: data.id!,
          restaurant_name: data.restaurant_name ?? null,
          cuisine_type: data.cuisine_type ?? null,
          dietary_tags: dietaryTags,
          detected_language: data.detected_language,
          created_at: new Date().toISOString(),
          safe_count: data.safe?.length ?? 0,
          options_count: data.options?.length ?? 0,
          risky_count: data.risky?.length ?? 0,
          total_count: (data.safe?.length ?? 0) + (data.options?.length ?? 0) + (data.risky?.length ?? 0) + (data.unidentified?.length ?? 0),
        }, ...prev]);
      }
      setPhase('results');
    } catch {
      setErrorMsg('Connection error. Please check your signal and try again.');
      setPhase('error');
    }
  };

  const reset = () => {
    setPhase('idle');
    setPreviewUrl(null);
    setImageData(null);
    setResult(null);
    setErrorMsg(null);
    setIsUpgrade(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const loadHistoryItem = async (id: string, tags: string[]) => {
    setHistoryLoading(id);
    try {
      const data = await fetch(`/api/menu-scan/${id}`).then(r => r.json());
      if (data.error) return;
      setResult(data);
      setDietaryTags(tags as DietaryTag[]);
      setPreviewUrl(null);
      setImageData(null);
      setPhase('results');
    } finally {
      setHistoryLoading(null);
    }
  };

  const totalItems = result
    ? result.safe.length + result.options.length + result.risky.length + result.unidentified.length
    : 0;

  if (status === 'loading') return null;

  // ── Idle ──────────────────────────────────────────────────────────────────────

  const renderIdle = () => (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] px-6 pt-10 pb-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center mb-5">
        <Camera size={26} className="text-violet-600" />
      </div>
      <h1 className="text-xl font-bold text-gray-900 mb-1.5">Menu Scanner</h1>
      <p className="text-sm text-gray-500 leading-relaxed mb-6 max-w-xs">
        Point your camera at any menu — in any language — and get an instant breakdown of what you can eat.
      </p>

      {isPro === false && (
        <div className="mb-5 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-500 shadow-sm">
          {scansUsed} / 3 free scans used this month
        </div>
      )}

      <div className="w-full max-w-xs space-y-2.5">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 text-white font-semibold rounded-xl transition-colors"
        >
          <Camera size={18} /> Take Photo
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-xl border border-gray-200 transition-colors"
        >
          <Upload size={16} /> Upload from Library
        </button>
      </div>

      <p className="mt-6 text-xs text-gray-400 max-w-xs leading-relaxed">
        Works with printed menus, chalkboards, and handwritten menus in any language
      </p>

      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInputChange} />
      <input ref={fileInputRef}   type="file" accept="image/*,image/heic,image/webp" className="hidden" onChange={handleInputChange} />

      {/* History */}
      {history.length > 0 && (
        <div className="w-full max-w-xs mt-8 space-y-2.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide text-left">Recent Scans</p>
          {history.map(item => {
            const title = item.restaurant_name || item.cuisine_type || item.detected_language || 'Menu scan';
            const subtitle = item.restaurant_name && item.cuisine_type ? item.cuisine_type : null;
            const isLoading = historyLoading === item.id;
            return (
              <button
                key={item.id}
                onClick={() => loadHistoryItem(item.id, item.dietary_tags)}
                disabled={!!historyLoading}
                className="w-full bg-white rounded-xl border border-gray-100 p-3.5 text-left space-y-1.5 hover:border-violet-200 hover:shadow-sm transition-all disabled:opacity-60"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{title}</p>
                  <span className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
                    {isLoading ? (
                      <span className="text-violet-500 text-xs">Loading…</span>
                    ) : (
                      <><Clock size={10} />{new Date(item.created_at).toLocaleDateString()}</>
                    )}
                  </span>
                </div>
                {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {item.safe_count > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">
                      {item.safe_count} safe
                    </span>
                  )}
                  {item.options_count > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                      {item.options_count} options
                    </span>
                  )}
                  {item.risky_count > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">
                      {item.risky_count} avoid
                    </span>
                  )}
                </div>
                {item.dietary_tags?.length > 0 && (
                  <p className="text-xs text-gray-400">
                    {item.dietary_tags.map(t => DIETARY_LABELS[t as DietaryTag] ?? t).join(' · ')}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Preview ───────────────────────────────────────────────────────────────────

  const renderPreview = () => (
    <div className="min-h-[calc(100vh-52px)] flex flex-col">
      <div className="relative flex-shrink-0 bg-gray-100 mx-4 mt-4 rounded-xl overflow-hidden" style={{ aspectRatio: '4/3', maxWidth: '320px', alignSelf: 'center' }}>
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Menu preview" className="w-full h-full object-cover" />
        )}
        <button
          onClick={reset}
          className="absolute top-3 right-3 w-7 h-7 bg-white/90 hover:bg-white text-gray-600 rounded-full flex items-center justify-center shadow-sm transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* Dietary requirements — always expanded */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3.5 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">Dietary Requirements</span>
            {dietaryTags.length > 0 && (
              <span className="bg-violet-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {dietaryTags.length}
              </span>
            )}
          </div>
          <div className="px-4 pb-4 border-t border-gray-50 pt-3">
            <div className="flex flex-wrap gap-2">
              {ALL_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={clsx(
                    'px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                    dietaryTags.includes(tag)
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600'
                  )}
                >
                  {DIETARY_ICONS[tag]} {DIETARY_LABELS[tag]}
                </button>
              ))}
            </div>
            {dietaryTags.length === 0 && (
              <p className="mt-2.5 text-xs text-gray-400">No requirements selected — general allergen analysis will be performed</p>
            )}
          </div>
        </div>

        <button
          onClick={scan}
          disabled={!imageData}
          className="w-full flex items-center justify-center gap-2.5 py-3.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors"
        >
          <Sparkles size={16} /> Analyse Menu
        </button>

        <button onClick={reset} className="w-full text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-1">
          Choose a different image
        </button>
      </div>
    </div>
  );

  // ── Scanning ──────────────────────────────────────────────────────────────────

  const renderScanning = () => (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] px-6 text-center">
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt=""
          className="w-full max-w-xs rounded-xl object-cover mb-7 opacity-25 border border-gray-100"
          style={{ maxHeight: '180px' }}
        />
      )}
      <div className="flex gap-1.5 mb-5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-violet-500 animate-bounce"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
      <p className="text-base font-semibold text-gray-900 mb-1">{loadingMsg}</p>
      <p className="text-xs text-gray-400">Usually takes 5–10 seconds</p>
    </div>
  );

  // ── Results ───────────────────────────────────────────────────────────────────

  const renderResults = () => {
    if (!result) return null;
    const translated = result.translation_applied;
    const lang = result.detected_language;
    const confPill = {
      high:   { cls: 'bg-green-50 text-green-700 border-green-200',  label: 'High confidence' },
      medium: { cls: 'bg-amber-50 text-amber-700 border-amber-200',  label: 'Medium confidence' },
      low:    { cls: 'bg-red-50   text-red-700   border-red-200',    label: 'Low — verify all items' },
    }[result.confidence];

    return (
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-1 pb-10">
        {/* Summary card */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between gap-3 mb-1">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm">{totalItems} items analysed</p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {translated && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <Globe size={10} /> Translated from {lang}
                </span>
              )}
              {!translated && lang && lang !== 'Unknown' && (
                <span className="text-xs text-gray-400">{lang}</span>
              )}
              <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full border', confPill.cls)}>
                {confPill.label}
              </span>
            </div>
          </div>
          {imageData && (
            <button
              onClick={() => setPhase('preview')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600 transition-colors flex-shrink-0"
            >
              <RefreshCw size={11} /> Rescan
            </button>
          )}
        </div>

        {/* Cross-contamination warning */}
        {result.cross_contamination_warning && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-red-700 mb-0.5">Cross-Contamination Warning</p>
              <p className="text-xs text-red-600 leading-relaxed">{result.cross_contamination_warning}</p>
            </div>
          </div>
        )}

        {/* Menu-wide alerts */}
        {result.menu_wide_alerts.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 space-y-2">
            {result.menu_wide_alerts.map((alert, i) => (
              <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" /> {alert}
              </p>
            ))}
          </div>
        )}

        {/* Safe */}
        <SectionHeader
          icon={<CheckCircle size={14} className="text-green-600" />}
          label="Safe to Order"
          count={result.safe.length}
          countCls="bg-green-50 text-green-700 border-green-200"
        />
        <div className="space-y-2.5">
          {result.safe.map((dish, i) => <DishCard key={i} dish={dish} category="safe" />)}
        </div>

        {/* Options */}
        <SectionHeader
          icon={<AlertTriangle size={14} className="text-amber-600" />}
          label="Options Available — Ask Staff"
          count={result.options.length}
          countCls="bg-amber-50 text-amber-700 border-amber-200"
        />
        <div className="space-y-2.5">
          {result.options.map((dish, i) => <DishCard key={i} dish={dish} category="options" />)}
        </div>

        {/* Risky */}
        <SectionHeader
          icon={<XCircle size={14} className="text-red-600" />}
          label="Avoid"
          count={result.risky.length}
          countCls="bg-red-50 text-red-700 border-red-200"
        />
        <div className="space-y-2.5">
          {result.risky.map((dish, i) => <DishCard key={i} dish={dish} category="risky" />)}
        </div>

        {/* Unidentified */}
        <SectionHeader
          icon={<HelpCircle size={14} className="text-gray-500" />}
          label="Couldn't Assess — Ask Staff"
          count={result.unidentified.length}
          countCls="bg-gray-50 text-gray-600 border-gray-200"
        />
        <div className="space-y-2.5">
          {result.unidentified.map((dish, i) => <DishCard key={i} dish={dish} category="unidentified" />)}
        </div>

        {/* What to ask */}
        {result.what_to_ask.length > 0 && (
          <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 mt-2">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={14} className="text-violet-600" />
              <p className="text-sm font-semibold text-violet-900">What to ask your waiter</p>
            </div>
            <div className="space-y-2.5">
              {result.what_to_ask.map((q, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-violet-200 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-violet-800 leading-relaxed">"{q}"</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 leading-relaxed pt-2 pb-1">
          AI-generated results — always confirm with restaurant staff for serious allergies.
        </p>

        <button
          onClick={reset}
          className="w-full flex items-center justify-center gap-2 py-3 bg-white hover:bg-gray-50 text-gray-600 font-medium rounded-xl border border-gray-200 transition-colors"
        >
          <Camera size={15} /> Scan Another Menu
        </button>
      </div>
    );
  };

  // ── Error ─────────────────────────────────────────────────────────────────────

  const renderError = () => (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-52px)] px-6 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-4">
        <XCircle size={22} className="text-red-500" />
      </div>

      {isUpgrade ? (
        <>
          <h2 className="text-lg font-bold text-gray-900 mb-1.5">Monthly limit reached</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5 max-w-xs">
            Free accounts get 3 menu scans per month. Upgrade to Pro for unlimited scans.
          </p>
          <button
            onClick={() => router.push('/profile')}
            className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl transition-colors mb-3"
          >
            View upgrade options
          </button>
        </>
      ) : (
        <>
          <h2 className="text-lg font-bold text-gray-900 mb-1.5">Something went wrong</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-5 max-w-xs">
            {errorMsg ?? 'An error occurred. Please try again.'}
          </p>
          <button
            onClick={() => { setPhase('preview'); setErrorMsg(null); }}
            className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white font-semibold rounded-xl transition-colors mb-3"
          >
            Try again
          </button>
        </>
      )}

      <button onClick={reset} className="text-sm text-gray-400 hover:text-gray-600 transition-colors py-1">
        Start over
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      {phase === 'idle'     && renderIdle()}
      {phase === 'preview'  && renderPreview()}
      {phase === 'scanning' && renderScanning()}
      {phase === 'results'  && renderResults()}
      {phase === 'error'    && renderError()}
    </div>
  );
}
