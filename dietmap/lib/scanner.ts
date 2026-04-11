import { DietaryTag, DIETARY_LABELS } from './types';

// How each dietary requirement should be framed — medical vs lifestyle vs religious
const DIETARY_CONTEXT: Partial<Record<DietaryTag, { reason: string; phraseHint: string }>> = {
  gluten_free:      { reason: 'medical', phraseHint: 'I have a gluten intolerance or coeliac disease — eating gluten causes me serious harm. This is a medical requirement.' },
  nut_free:         { reason: 'medical', phraseHint: 'I have a nut allergy — this is a potentially life-threatening medical condition.' },
  shellfish_free:   { reason: 'medical', phraseHint: 'I have a shellfish allergy — this is a potentially life-threatening medical condition.' },
  egg_free:         { reason: 'medical', phraseHint: 'I have an egg allergy — this is a medical requirement.' },
  dairy_free:       { reason: 'medical', phraseHint: 'I am lactose intolerant or have a dairy allergy — dairy causes me serious discomfort or harm.' },
  soy_free:         { reason: 'medical', phraseHint: 'I have a soy allergy — this is a medical requirement.' },
  vegan:            { reason: 'lifestyle', phraseHint: 'I am vegan and do not eat any meat, fish, seafood, eggs, dairy, or honey. This is an ethical and lifestyle choice.' },
  vegetarian:       { reason: 'lifestyle', phraseHint: 'I am vegetarian and do not eat any meat or fish. This is an ethical and lifestyle choice.' },
  keto:             { reason: 'lifestyle', phraseHint: 'I follow a ketogenic diet and avoid all carbohydrates, sugars, and starches.' },
  low_fodmap:       { reason: 'medical', phraseHint: 'I have irritable bowel syndrome (IBS) and must follow a low-FODMAP diet, avoiding onions, garlic, wheat, and certain fruits.' },
  halal:            { reason: 'religious', phraseHint: 'I observe halal dietary requirements and only eat halal-certified meat. I cannot eat pork or alcohol.' },
  kosher:           { reason: 'religious', phraseHint: 'I observe kosher dietary laws — I cannot eat pork, shellfish, or mix meat with dairy.' },
};

export function buildScanPrompt(
  destination: string,
  dietaryTags: DietaryTag[],
  startDate?: string,
  endDate?: string,
  lat?: number,
  lng?: number,
  searchLevels?: { high: boolean; medium: boolean; low: boolean },
  maxDistanceKm?: number,
  isRescan?: boolean,
  searchRound?: 1 | 2,
): string {
  const allowedLevels = searchLevels
    ? Object.entries(searchLevels).filter(([, v]) => v).map(([k]) => k)
    : ['high', 'medium', 'low'];
  const levelNote = allowedLevels.length < 3
    ? `IMPORTANT: Only include restaurants with safety_confidence of: ${allowedLevels.join(', ')}. If no restaurants exist at these levels, include a note in coverage_note explaining this and optionally include limited options restaurants if nothing else is available.`
    : '';
  const dietaryDesc = dietaryTags
    .map(t => DIETARY_LABELS[t] ?? t.replace(/_/g, ' '))
    .join(', ');

  // Build per-tag context for accurate phrase card generation
  const tagContextLines = dietaryTags
    .map(t => DIETARY_CONTEXT[t])
    .filter(Boolean)
    .map(c => `  - ${c!.phraseHint}`)
    .join('\n');
  const dateContext = startDate && endDate
    ? `Travel dates: ${startDate} to ${endDate}.`
    : '';

  const hasCoords = lat != null && lng != null;
  const radiusKm = maxDistanceKm ?? 10;
  const coordContext = hasCoords
    ? `COORDINATES: ${lat!.toFixed(5)}, ${lng!.toFixed(5)} — search within ~${radiusKm}km of this point using Google Maps.`
    : '';

  return `You are a dietary travel assistant. Find safe restaurants and food guidance for a traveller.

DESTINATION: ${destination}
${coordContext}
DIETARY REQUIREMENTS: ${dietaryDesc}
${dateContext}
${levelNote}
IMPORTANT — DIETARY CONTEXT (use this to write accurate phrase cards):
${tagContextLines || '  - Follow the user\'s stated dietary restrictions.'}
Phrase cards must reflect the TRUE nature of each restriction — lifestyle choices (vegan, keto) should NOT say "medical condition". Religious requirements (halal, kosher) should reference dietary laws. Medical conditions (allergies, intolerances, IBS) should communicate urgency appropriately.

Search for:
1. Restaurants within ~${radiusKm}km that accommodate these dietary needs${hasCoords ? ` — search Google Maps near ${lat!.toFixed(4)},${lng!.toFixed(4)} for "${dietaryDesc} restaurants"` : ''}
2. Local dishes naturally safe for these requirements
3. Common local dishes/ingredients to AVOID
4. How to communicate these needs in the local language

Search queries to use:
- Google Maps: "${destination} ${dietaryDesc} restaurant"
- "${destination} ${dietaryDesc} dining"
- "${destination} allergy friendly food"
- Travel blogs about eating with ${dietaryDesc} restrictions in ${destination}

Respond ONLY with valid JSON (no markdown, no backticks, no source URLs or website mentions):

{
  "restaurants": [
    {
      "name": "Name",
      "address": "Full street address — include street number, street name, and suburb (e.g. '136 Ponsonby Rd, Ponsonby')",
      "lat": 0.0,
      "lng": 0.0,
      "cuisine_type": "Type",
      "website": "https://... or null if not found",
      "phone": "+1234567890 or null if not found",
      "menu_photo_urls": ["https://... direct image URL from menu or review site, include date if visible"],
      "notes": "Why safe, what to order (1-2 sentences)",
      "safety_confidence": "high|medium|low",
      "recommended_dishes": ["dish"],
      "warnings": ["warning if any"],
      "dietary_tags": ["gluten_free"]
    }
  ],
  "safe_dishes": [
    {
      "name": "English name",
      "local_name": "Local script name",
      "description": "What it is and why safe (1 sentence)",
      "safety_notes": "Caveats if any",
      "commonly_found_at": "Where to find it"
    }
  ],
  "danger_foods": [
    {
      "name": "Name",
      "local_name": "Local name",
      "why_dangerous": "Reason (1 sentence)",
      "commonly_found_in": "Where"
    }
  ],
  "phrase_cards": [
    {
      "english": "Accurate English explanation of the restriction — use the dietary context above to frame it correctly (medical urgency for allergies, ethical for vegan, religious for halal/kosher, etc.)",
      "local_language": "Translation in local language",
      "transliteration": "Phonetic pronunciation if non-Latin script",
      "context": "Show to your server when ordering"
    },
    {
      "english": "Does this dish contain [allergen/ingredient]?",
      "local_language": "Translation",
      "transliteration": "Pronunciation if non-Latin script",
      "context": "Ask about specific dishes"
    }
  ],
  "cuisine_notes": "3-5 bullet points about eating safely here. Be practical and specific.",
  "coverage_confidence": "high|medium|low",
  "coverage_note": "One sentence on information reliability"
}

Rules:
- Keep all text fields concise (1-3 sentences max).
- SAFE DISHES: only include dishes that are genuinely common and easy to find at standard restaurants in this area. Do NOT include niche substitutes, rare cultural dishes, or specialty items a traveller would struggle to find. Each dish must be a staple of everyday local eating.
- WESTERN COUNTRIES (UK, USA, Australia, New Zealand, Canada, Western Europe, Scandinavia, etc.): dietary requirements like gluten-free, dairy-free, vegan are widely understood, clearly labelled on menus, and staff are trained to accommodate them. For these destinations: (a) safe_dishes should contain NO MORE than 2 practical items — only include something if it is genuinely non-obvious or surprising; leave the array empty if there is nothing truly worth noting. (b) danger_foods should highlight 1-2 common hidden pitfalls that even experienced travellers miss (e.g. soy sauce in marinades, malt vinegar, shared fryers). Do NOT list generic staples or traditional dishes that happen to be safe — the traveller can read the menu themselves.
- PHRASE CARDS: include exactly 2 cards as shown above.
- Do NOT mention any other websites, apps, blogs, or travel services in text fields.
- For website and phone: include only if you find the official restaurant website or phone number. Leave null if not confidently found.
- For menu_photo_urls: include only direct image URLs (jpg/png/webp) from review sites (Google Maps, TripAdvisor, Yelp). Leave empty array if none found. Note the photo date in the URL or caption if visible.
- ${isRescan
    ? 'Find 5–10 NEW restaurants not already found. Go beyond the obvious — look for hidden gems, smaller spots, or different neighbourhoods.'
    : searchRound === 2
      ? 'Find 10–15 restaurants. IMPORTANT: Focus specifically on residential neighbourhoods away from tourist areas, local food courts, hawker centres, and small family-run establishments that a typical tourist search would miss.'
      : 'Find 15–20 restaurants. Cast a wide net across different neighbourhoods and price points.'}
- For coordinates: provide your best estimate — addresses are what matter most for accuracy.
- Addresses MUST be complete street addresses (number + street + suburb), not just area names like "Ponsonby Central".`;
}

export interface RawScanResult {
  restaurants: Array<{
    name: string;
    address: string;
    lat: number;
    lng: number;
    cuisine_type: string | string[];
    price_level?: string;
    website?: string | null;
    phone?: string | null;
    menu_photo_urls?: string[];
    notes?: string;
    safety_confidence?: 'high' | 'medium' | 'low';
    recommended_dishes?: string[];
    warnings?: string[];
    source_urls?: string[];
    dietary_tags?: string[];
  }>;
  safe_dishes?: unknown[];
  danger_foods?: unknown[];
  phrase_cards?: unknown[];
  cuisine_notes?: string;
  coverage_confidence?: string;
  coverage_note?: string;
}

export function parseScanResponse(text: string): RawScanResult {
  // Log for debugging in Vercel function logs
  console.log('[scanner] raw response length:', text.length);
  console.log('[scanner] raw response preview:', text.slice(0, 300));

  // Strip markdown code fences
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Strategy 1: direct parse
  try {
    return JSON.parse(cleaned) as RawScanResult;
  } catch { /* fall through */ }

  // Strategy 2: find the outermost balanced { } block
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(firstBrace, i + 1);
          try {
            return JSON.parse(candidate) as RawScanResult;
          } catch { break; }
        }
      }
    }
  }

  // Strategy 3: last resort — first { to last }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as RawScanResult;
    } catch { /* fall through */ }
  }

  console.error('[scanner] unparseable response:', text.slice(0, 1000));
  throw new Error('Could not parse JSON from Claude response');
}
