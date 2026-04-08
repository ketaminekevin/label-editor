import { DietaryTag, DIETARY_LABELS } from './types';

export function buildScanPrompt(
  destination: string,
  dietaryTags: DietaryTag[],
  startDate?: string,
  endDate?: string,
  lat?: number,
  lng?: number,
): string {
  const dietaryDesc = dietaryTags
    .map(t => DIETARY_LABELS[t] ?? t.replace(/_/g, ' '))
    .join(', ');
  const dateContext = startDate && endDate
    ? `Travel dates: ${startDate} to ${endDate}.`
    : '';

  const hasCoords = lat != null && lng != null;
  const coordContext = hasCoords
    ? `COORDINATES: ${lat!.toFixed(5)}, ${lng!.toFixed(5)} — search within ~10km of this point using Google Maps.`
    : '';

  return `You are a dietary travel assistant. Find safe restaurants and food guidance for a traveller.

DESTINATION: ${destination}
${coordContext}
DIETARY REQUIREMENTS: ${dietaryDesc}
${dateContext}

Search for:
1. Restaurants within ~10km that accommodate these dietary needs${hasCoords ? ` — search Google Maps near ${lat!.toFixed(4)},${lng!.toFixed(4)} for "${dietaryDesc} restaurants"` : ''}
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
      "address": "Address or area",
      "lat": 0.0,
      "lng": 0.0,
      "cuisine_type": "Type",
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
      "english": "I cannot eat [restriction] due to a medical condition.",
      "local_language": "Translation in local language",
      "transliteration": "Phonetic pronunciation if non-Latin script",
      "context": "Show to your server when ordering"
    },
    {
      "english": "Does this dish contain [allergen]?",
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
- Find 5-10 restaurants. Keep all text fields concise (1-3 sentences max).
- SAFE DISHES: only include dishes that are genuinely common and easy to find at standard restaurants in this area. Do NOT include niche substitutes or specialty items a traveller would struggle to find. Each dish must be a staple of everyday local eating.
- PHRASE CARDS: include exactly 2 cards as shown above.
- Do NOT mention any other websites, apps, blogs, or travel services.
- Do NOT include source_urls in any field.
- For coordinates, your best estimate at street-block level is fine.`;
}

export interface RawScanResult {
  restaurants: Array<{
    name: string;
    address: string;
    lat: number;
    lng: number;
    cuisine_type: string | string[];
    price_level?: string;
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
