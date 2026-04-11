import { DietaryTag, DIETARY_LABELS } from './types';

export interface MenuDish {
  original_name: string;
  english_name: string;
  description?: string;
  reason: string;
  confidence: 'hard' | 'conditional' | 'inferred';
  annotation?: string | null;
  hidden_risks?: string[];
}

export interface MenuScanResult {
  id?: string;
  restaurant_name?: string | null;
  cuisine_type?: string | null;
  detected_language: string;
  translation_applied: boolean;
  confidence: 'high' | 'medium' | 'low';
  menu_wide_alerts: string[];
  cross_contamination_warning?: string | null;
  safe: MenuDish[];
  options: MenuDish[];
  risky: MenuDish[];
  unidentified: MenuDish[];
  what_to_ask: string[];
}

const SEVERITY: Partial<Record<DietaryTag, string>> = {
  gluten_free: 'MEDICAL — coeliac disease or wheat allergy. Even trace amounts cause serious harm. Treat as a strict medical requirement.',
  nut_free: 'MEDICAL — potentially life-threatening anaphylaxis. Extremely strict.',
  shellfish_free: 'MEDICAL — potentially life-threatening anaphylaxis. Extremely strict.',
  egg_free: 'MEDICAL — egg allergy.',
  soy_free: 'MEDICAL — soy allergy.',
  dairy_free: 'MEDICAL or DIETARY — may include lactose intolerance or milk allergy.',
  halal: 'RELIGIOUS — no pork, no alcohol, must be halal-certified.',
  kosher: 'RELIGIOUS — strict kosher requirements including preparation method.',
  vegan: 'ETHICAL — absolutely no animal products including dairy, eggs, honey, gelatin.',
  vegetarian: 'DIETARY — no meat or fish. Dairy and eggs are acceptable.',
  keto: 'DIETARY — very low carbohydrate, high fat.',
  low_fodmap: 'MEDICAL — digestive condition. Avoid high-FODMAP foods.',
};

export function buildMenuScanPrompt(dietaryTags: string[]): string {
  const tagSection = dietaryTags.length > 0
    ? dietaryTags.map(t => {
        const label = DIETARY_LABELS[t as DietaryTag] ?? t;
        const severity = SEVERITY[t as DietaryTag] ?? 'dietary requirement';
        return `  - ${label}: ${severity}`;
      }).join('\n')
    : '  None specified — perform a general allergen analysis flagging the 14 major EU allergens.';

  return `You are a multilingual dietary safety expert analysing a restaurant menu photo on behalf of a user with specific dietary requirements.

USER REQUIREMENTS:
${tagSection}

YOUR TASK — follow every step:

STEP 1 — LANGUAGE
Identify the menu language. If not English, translate all dish names and descriptions to English in your output.

STEP 2 — EXTRACTION
Extract every identifiable dish or menu item. Do not skip items. If you cannot assess a dish, place it in "unidentified".

STEP 3 — ANALYSIS
Assess each dish using ALL of the following in order:
a) ANNOTATIONS — recognise worldwide dietary shorthand:
   GF=Gluten Free, GFO=Gluten Free Option, GFI=Gluten Free if requested, NGA=No Gluten Added
   DF=Dairy Free, V=Vegetarian, VE or VG=Vegan, N=Contains Nuts, P=Contains Peanuts
   H=Halal, K=Kosher — and any regional symbols using your local food culture knowledge.
b) LISTED INGREDIENTS — assess descriptions and ingredient lists directly.
c) CULTURAL KNOWLEDGE — infer likely ingredients even when not stated:
   Thai: fish sauce in most dishes, peanuts in satay/pad thai, soy sauce common
   Japanese: soy sauce (contains wheat) everywhere, miso contains soy, ramen broth often contains wheat
   French: butter/cream in most sauces, shellfish in bisques, alcohol in many dishes
   Chinese: soy sauce, oyster sauce, wheat noodles and dumpling wrappers very common
   Indian: ghee (dairy) common, nuts in curries and desserts
   Italian: Parmesan (dairy) common, gluten in nearly all pasta and bread
   Mexican: wheat flour tortillas, cheese common, lard sometimes used
   Mediterranean: sesame/tahini common, gluten in most breads and pastries
   Use your knowledge of that specific cuisine type to make an educated assessment.

IMPORTANT — TONE AND LANGUAGE BY RESTRICTION TYPE:
Use appropriate language that matches the nature of each restriction:
- MEDICAL ALLERGY/CONDITION (gluten_free/coeliac, nut_free, shellfish_free, egg_free, soy_free, low_fodmap): Write with the medical seriousness the condition deserves. For gluten_free specifically: this user likely has coeliac disease, where even trace gluten causes real harm — not a preference. When a dish needs confirmation or has conditions, briefly acknowledge the coeliac context (e.g. "for someone with coeliac disease, the key concern is..."). The cautious, thorough approach is exactly right for celiacs.
- HEALTH/LIFESTYLE (keto, dairy_free): Write practically without alarm. These are health or lifestyle choices. "Contains starchy noodles" not "DANGER: carbohydrates present."
- ETHICAL (vegan, vegetarian): Write matter-of-factly. "Contains egg" not "WARNING: animal product."
- RELIGIOUS (halal, kosher): Write with respect for religious observance — it is a matter of dietary law, not allergy. "Pork-based — not halal compliant" rather than clinical allergy language.

STEP 4 — HIDDEN RISKS
Flag non-obvious allergens:
- Soy sauce → contains wheat (gluten risk)
- Satay / peanut sauce → peanuts
- Miso → soy
- Worcestershire sauce → fish
- Caesar dressing → anchovies + egg
- Many stocks/gravies → may contain wheat, dairy, shellfish
- "Natural flavours" or "spices" → may conceal allergens
- Vegetarian dishes cooked in shared oil or on shared grill
- Pasta sauces with a butter finish
- Plant-based "meats" → often contain soy, gluten, or egg
- Ramen broths → often contain wheat or pork
- Vietnamese pho → often contains wheat in hoisin sauce

STEP 5 — CROSS-CONTAMINATION
Note any cross-contamination warnings visible on the menu (e.g. "prepared in a kitchen that handles nuts").

STEP 6 — WHAT TO ASK
Generate 2–5 specific, plain English phrases the user should say to their waiter — tailored exactly to this menu and these requirements. Make them direct and easy to point to or read out loud.

CLASSIFICATION:

category (which array each dish goes into):
  "safe" — safe for this user based on available information
  "options" — may be safe with a modification, or needs staff confirmation
  "risky" — contains or very likely contains something this user cannot eat
  "unidentified" — cannot assess from available information

confidence (certainty of assessment):
  "hard" — explicitly labelled with no caveats (e.g. "GF", "Vegan" stamp)
  "conditional" — conditional label (GFO, GFI, NGA) or requires modification
  "inferred" — no label; based on ingredients or cultural knowledge — verify with staff

OUTPUT — return ONLY this JSON, no other text, no code fences:
{
  "restaurant_name": "Restaurant name if visible on the menu, otherwise null",
  "cuisine_type": "Cuisine type (e.g. Italian, Japanese, Thai, Modern Australian, Mexican) — infer from menu if not stated",
  "detected_language": "English",
  "translation_applied": false,
  "confidence": "high",
  "menu_wide_alerts": [],
  "cross_contamination_warning": null,
  "safe": [
    {
      "original_name": "exact text as it appears on the menu",
      "english_name": "English translation, or same as original if already English",
      "description": "brief description if visible on the menu, or null",
      "reason": "1–2 sentence plain English explanation of why this is safe",
      "confidence": "hard | conditional | inferred",
      "annotation": "e.g. GF or V if present on menu, otherwise null",
      "hidden_risks": []
    }
  ],
  "options": [],
  "risky": [],
  "unidentified": [],
  "what_to_ask": []
}

RULES:
- If blurry, dark, or hard to read: set confidence "low", explain in menu_wide_alerts
- If no items identified: empty arrays, explain in menu_wide_alerts
- risky reason must name the specific problematic ingredient
- hidden_risks is always an array (empty if none)
- what_to_ask must always have at least 1 entry if dietary requirements are specified
- Include ALL visible dishes — completeness is critical for safety`;
}

export function parseMenuScanResponse(text: string): MenuScanResult {
  const defaults: MenuScanResult = {
    detected_language: 'Unknown',
    translation_applied: false,
    confidence: 'low',
    menu_wide_alerts: [],
    cross_contamination_warning: null,
    safe: [],
    options: [],
    risky: [],
    unidentified: [],
    what_to_ask: [],
  };

  const normalise = (raw: Partial<MenuScanResult>): MenuScanResult => ({
    ...defaults,
    ...raw,
    safe: Array.isArray(raw.safe) ? raw.safe : [],
    options: Array.isArray(raw.options) ? raw.options : [],
    risky: Array.isArray(raw.risky) ? raw.risky : [],
    unidentified: Array.isArray(raw.unidentified) ? raw.unidentified : [],
    menu_wide_alerts: Array.isArray(raw.menu_wide_alerts) ? raw.menu_wide_alerts : [],
    what_to_ask: Array.isArray(raw.what_to_ask) ? raw.what_to_ask : [],
  });

  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  try {
    return normalise(JSON.parse(cleaned) as Partial<MenuScanResult>);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return normalise(JSON.parse(cleaned.slice(start, end + 1)) as Partial<MenuScanResult>);
      } catch { /* fall through */ }
    }
    return {
      ...defaults,
      menu_wide_alerts: ['Could not read the AI response. Please try scanning again.'],
    };
  }
}
