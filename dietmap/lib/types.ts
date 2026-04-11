export type DietaryTag =
  | 'gluten_free'
  | 'dairy_free'
  | 'vegan'
  | 'vegetarian'
  | 'keto'
  | 'nut_free'
  | 'soy_free'
  | 'egg_free'
  | 'shellfish_free'
  | 'halal'
  | 'kosher'
  | 'low_fodmap';

export type SafetyLevel = 'dedicated' | 'careful' | 'has_options' | 'risky';

export const LIST_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
] as const;
export type ListColor = typeof LIST_COLORS[number];

export interface List {
  id: string;
  user_id: string;
  name: string;
  color: string;
  scan_id?: string | null;
  created_at: string;
  restaurant_count?: number;
  restaurant_ids?: string[];
}
export type ConfidenceLevel = 'llm_derived' | 'user_verified' | 'owner_verified';
export type SubscriptionTier = 'free' | 'premium';
export type RestaurantSource = 'user_added' | 'area_scan' | 'imported' | 'seed';

export interface DietaryTagRecord {
  id: number;
  restaurant_id: string;
  tag: DietaryTag;
  safety_level: SafetyLevel;
  confidence: ConfidenceLevel;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  google_place_id: string | null;
  phone: string | null;
  website: string | null;
  price_level: number | null;
  cuisine_type: string[];
  cover_photo_url: string | null;
  source: RestaurantSource;
  added_by: string | null;
  verified: boolean;
  visibility?: string;
  discovered_by?: string | null;
  // Scan notes — populated when fetched in the context of a scan
  scan_notes?: {
    ai_notes: string | null;
    ai_safety_confidence: 'high' | 'medium' | 'low' | null;
    recommended_dishes: string[];
    warnings: string[];
    scan_destination: string;
  } | null;
  created_at: string;
  updated_at: string;
  dietary_tags?: DietaryTagRecord[];
  review_count?: number;
  avg_rating?: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  subscription_tier: SubscriptionTier;
  account_tier: 'free' | 'pro';
  scans_remaining: number;
  dietary_profile: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

// ── AI Area Scanner types ─────────────────────────────────────────────────────

export interface PhraseCard {
  english: string;
  local_language: string;
  transliteration?: string;
  context: string;
}

export interface SafeDish {
  name: string;
  local_name?: string;
  description: string;
  safety_notes?: string;
  commonly_found_at?: string;
}

export interface DangerFood {
  name: string;
  local_name?: string;
  why_dangerous: string;
  commonly_found_in?: string;
}

export interface ScanRestaurant {
  id: string;
  scan_id: string;
  restaurant_id: string;
  ai_notes: string | null;
  ai_safety_confidence: 'high' | 'medium' | 'low' | null;
  recommended_dishes: string[];
  warnings: string[];
  source_urls: string[];
  menu_photo_urls: string[];
  created_at: string;
  // joined restaurant fields
  name: string;
  address: string;
  lat: number;
  lng: number;
  cuisine_type: string[];
  price_level: number | null;
  website: string | null;
  phone: string | null;
  visibility: string;
  source: string | null;
  avg_rating: number | null;
  review_count: number;
}

export interface Scan {
  id: string;
  user_id: string;
  destination: string;
  trip_name: string | null;
  country: string | null;
  dietary_tags: DietaryTag[];
  travel_dates_start: string | null;
  travel_dates_end: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result_summary: string | null;
  phrase_cards: PhraseCard[];
  safe_dishes: SafeDish[];
  danger_foods: DangerFood[];
  cuisine_notes: string | null;
  coverage_confidence: string | null;
  coverage_note: string | null;
  error_message: string | null;
  tokens_used: number;
  created_at: string;
  completed_at: string | null;
  restaurants?: ScanRestaurant[];
  restaurant_count?: number;
}

export interface ReviewDietarySafety {
  tag: DietaryTag;
  star_rating: number | null; // 1-5, null = unsure
  is_dedicated: boolean;
  notes?: string | null;
}

export interface Review {
  id: string;
  user_id: string;
  restaurant_id: string;
  rating: number;
  dietary_context: DietaryTag[];
  dietary_safety: ReviewDietarySafety[];
  body: string;
  safety_rating: number;
  photos: string[];
  created_at: string;
  updated_at: string;
  user?: { name: string; avatar_url: string | null };
  upvotes?: number;
  downvotes?: number;
  my_vote?: 1 | -1 | null;
}

// Safety level numeric score for averaging
export const SAFETY_SCORE: Record<SafetyLevel, number> = {
  dedicated:   3,
  careful:     2,
  has_options: 1,
  risky:       0,
};

export function scoreToSafetyLevel(score: number): SafetyLevel {
  if (score >= 2.5) return 'dedicated';
  if (score >= 1.5) return 'careful';
  if (score >= 0.5) return 'has_options';
  return 'risky';
}

// Distance unit helpers
export function kmToMiles(km: number): number {
  return km * 0.621371;
}
export function milesToKm(miles: number): number {
  return miles * 1.60934;
}
export function formatDistance(km: number, useMiles: boolean): string {
  if (useMiles) {
    const m = kmToMiles(km);
    return m < 10 ? `${m.toFixed(1)} mi` : `${Math.round(m)} mi`;
  }
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export const DIETARY_LABELS: Record<DietaryTag, string> = {
  gluten_free: 'Gluten Free',
  dairy_free: 'Dairy Free',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  keto: 'Keto',
  nut_free: 'Nut Free',
  soy_free: 'Soy Free',
  egg_free: 'Egg Free',
  shellfish_free: 'Shellfish Free',
  halal: 'Halal',
  kosher: 'Kosher',
  low_fodmap: 'Low FODMAP',
};

export const SAFETY_LABELS: Record<SafetyLevel, string> = {
  dedicated: 'Dedicated Facility',
  careful: 'Careful Handling',
  has_options: 'Has Options',
  risky: 'Risky',
};

export const SAFETY_COLORS: Record<SafetyLevel, string> = {
  dedicated: '#22c55e',
  careful: '#3b82f6',
  has_options: '#f59e0b',
  risky: '#ef4444',
};

export const DIETARY_ICONS: Record<DietaryTag, string> = {
  gluten_free: '🌾',
  dairy_free: '🥛',
  vegan: '🌱',
  vegetarian: '🥦',
  keto: '🥩',
  nut_free: '🥜',
  soy_free: '🫘',
  egg_free: '🥚',
  shellfish_free: '🦐',
  halal: '☪️',
  kosher: '✡️',
  low_fodmap: '🫁',
};
