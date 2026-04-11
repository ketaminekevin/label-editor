import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');

// ── Types ─────────────────────────────────────────────────────────────────────

type RestaurantRow = {
  id: string;
  name: string;
  address: string;
  cuisine_type: string[];
  source: string;
  avg_rating: number | null;
  review_count: number;
  lat: number;
  lng: number;
  dietary_tags: string[];
  ai_notes: string | null;
  recommended_dishes: string[] | null;
  result_type: 'own_scan' | 'community' | 'other_pro';
};

// ── Unified three-tier search ─────────────────────────────────────────────────

async function searchRestaurants(
  userId: string,
  isPro: boolean,
  args: {
    query?: string;
    dietary_tags?: string[];
    lat?: number;
    lng?: number;
    radius_km?: number;
    min_rating?: number;
    limit?: number;
  }
): Promise<RestaurantRow[]> {
  const { query: q, dietary_tags, lat, lng, radius_km = 10, min_rating, limit = 10 } = args;

  const buildQuery = (tierWhere: string, tierLimit: string, resultType: string) => {
    const params: unknown[] = [];
    const conditions: string[] = [tierWhere];
    let idx = 1;

    // Text search across name, cuisine_type, ai_notes, recommended_dishes, and review text
    if (q) {
      conditions.push(`(
        r.name ILIKE $${idx}
        OR array_to_string(r.cuisine_type, ' ') ILIKE $${idx}
        OR EXISTS (
          SELECT 1 FROM scan_restaurants sr
          WHERE sr.restaurant_id = r.id
            AND (
              sr.ai_notes ILIKE $${idx}
              OR array_to_string(sr.recommended_dishes, ' ') ILIKE $${idx}
            )
        )
        OR EXISTS (
          SELECT 1 FROM reviews rv2
          WHERE rv2.restaurant_id = r.id AND rv2.body ILIKE $${idx}
        )
      )`);
      params.push(`%${q}%`); idx++;
    }
    if (lat != null && lng != null) {
      conditions.push(`ST_DWithin(r.location, ST_MakePoint($${idx}, $${idx+1})::geography, $${idx+2})`);
      params.push(lng, lat, radius_km * 1000); idx += 3;
    }
    if (dietary_tags?.length) {
      conditions.push(`EXISTS (SELECT 1 FROM restaurant_dietary_tags rdt WHERE rdt.restaurant_id = r.id AND rdt.tag = ANY($${idx}::text[]))`);
      params.push(dietary_tags); idx++;
    }

    const having = min_rating != null ? `HAVING ROUND(AVG(rv.rating)::numeric, 1) >= ${min_rating}` : '';

    const sql = `
      SELECT r.id, r.name, r.address, r.cuisine_type, r.source,
        ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
        ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating, COUNT(rv.id)::int AS review_count,
        ARRAY_AGG(DISTINCT rdt.tag) FILTER (WHERE rdt.tag IS NOT NULL) AS dietary_tags,
        (SELECT sr.ai_notes FROM scan_restaurants sr WHERE sr.restaurant_id = r.id AND sr.ai_notes IS NOT NULL LIMIT 1) AS ai_notes,
        (SELECT sr.recommended_dishes FROM scan_restaurants sr WHERE sr.restaurant_id = r.id AND sr.recommended_dishes IS NOT NULL LIMIT 1) AS recommended_dishes,
        '${resultType}'::text AS result_type
      FROM restaurants r
      LEFT JOIN reviews rv ON rv.restaurant_id = r.id
      LEFT JOIN restaurant_dietary_tags rdt ON rdt.restaurant_id = r.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY r.id
      ${having}
      ORDER BY avg_rating DESC NULLS LAST, review_count DESC
      ${tierLimit}
    `;
    return { sql, params };
  };

  const cap = Math.min(limit, 20);
  const t2 = buildQuery(`r.visibility = 'public'`, `LIMIT ${cap}`, 'community');

  if (!isPro) {
    // Free users: community only
    const communityRows = await query<RestaurantRow>(t2.sql, t2.params);
    const seen = new Set<string>();
    return communityRows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  }

  const t1 = buildQuery(`(r.visibility = 'private' AND r.discovered_by = '${userId}')`, `LIMIT ${cap}`, 'own_scan');
  const t3 = buildQuery(`(r.visibility = 'private' AND r.discovered_by != '${userId}')`, 'LIMIT 1', 'other_pro');

  const [ownRows, communityRows, otherRows] = await Promise.all([
    query<RestaurantRow>(t1.sql, t1.params),
    query<RestaurantRow>(t2.sql, t2.params),
    query<RestaurantRow>(t3.sql, t3.params),
  ]);

  // Merge, deduplicate by id — own_scan wins
  const seen = new Set<string>();
  const results: RestaurantRow[] = [];
  for (const r of [...ownRows, ...communityRows, ...otherRows]) {
    if (!seen.has(r.id)) { seen.add(r.id); results.push(r); }
  }
  return results;
}

async function getRestaurantDetails(userId: string, args: { restaurant_id: string }) {
  const rows = await query<{
    id: string; name: string; address: string; cuisine_type: string[];
    website: string | null; phone: string | null; source: string;
    avg_rating: number | null; review_count: number; dietary_tags: string[];
  }>(
    `SELECT r.id, r.name, r.address, r.cuisine_type, r.website, r.phone, r.source,
       ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating, COUNT(rv.id)::int AS review_count,
       ARRAY_AGG(DISTINCT rdt.tag) FILTER (WHERE rdt.tag IS NOT NULL) AS dietary_tags
     FROM restaurants r
     LEFT JOIN reviews rv ON rv.restaurant_id = r.id
     LEFT JOIN restaurant_dietary_tags rdt ON rdt.restaurant_id = r.id
     WHERE r.id = $1 AND (r.visibility = 'public' OR r.discovered_by = $2)
     GROUP BY r.id`, [args.restaurant_id, userId]
  );
  if (!rows.length) return { error: 'Restaurant not found' };

  const reviews = await query<{ rating: number; body: string; created_at: string; user_name: string }>(
    `SELECT rv.rating, rv.body, rv.created_at, SPLIT_PART(u.name, ' ', 1) AS user_name
     FROM reviews rv JOIN users u ON u.id = rv.user_id
     WHERE rv.restaurant_id = $1 ORDER BY rv.created_at DESC LIMIT 5`, [args.restaurant_id]
  );
  return { ...rows[0], recent_reviews: reviews };
}

// ── Gemini function declarations ──────────────────────────────────────────────

const FUNCTION_DECLARATIONS = [
  {
    name: 'search_restaurants',
    description: 'Search for restaurants across the user\'s own trip scans, the community database, and other pro users\' discoveries. For dish-specific requests (e.g. "waffles"), pass the dish as the query so it matches against restaurant notes — combine with dietary_tags for dietary filtering.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text search on restaurant name, address, or AI notes (e.g. "waffle", "pizza"). Use this for dish-specific searches.' },
        dietary_tags: { type: 'array', items: { type: 'string' }, description: 'Dietary filter tags: gluten_free, dairy_free, vegan, vegetarian, keto, nut_free, soy_free, egg_free, shellfish_free, halal, kosher, low_fodmap' },
        lat: { type: 'number', description: 'Latitude for location-based search' },
        lng: { type: 'number', description: 'Longitude for location-based search' },
        radius_km: { type: 'number', description: 'Search radius in km (default 10)' },
        min_rating: { type: 'number', description: 'Minimum average star rating (1-5)' },
        limit: { type: 'number', description: 'Max results per tier (default 10, max 20)' },
      },
    },
  },
  {
    name: 'get_restaurant_details',
    description: 'Get full details and recent reviews for a specific restaurant.',
    parameters: {
      type: 'object',
      properties: {
        restaurant_id: { type: 'string', description: 'The restaurant UUID' },
      },
      required: ['restaurant_id'],
    },
  },
];

function buildSystem(isPro: boolean, userDietaryTags: string[]) {
  const dietaryContext = userDietaryTags.length
    ? `The user's confirmed dietary restrictions are: ${userDietaryTags.join(', ')}. Always include these in dietary_tags when calling search_restaurants.`
    : 'The user has no confirmed dietary restrictions.';

  const tierNote = isPro
    ? 'Search covers: the user\'s own trip scan restaurants, the community database, and other pro users\' discoveries. Mark result_type="other_pro" with "(AI suggestion — not yet community verified)".'
    : 'Search covers the community restaurant database only.';

  return `You are a precise dietary restaurant assistant for DietMap. Your value is accuracy, not volume.

${dietaryContext}
${tierNote}

SEARCH RULES — follow these exactly:

1. FOOD QUERIES: When the user asks for a specific food (e.g. "waffles", "sushi", "pizza"), you MUST pass that food word as the "query" parameter. The search checks restaurant names, AI scan notes, recommended dishes, and user reviews. The returned restaurants have genuinely matched that food in their content — trust these results completely.

2. DIETARY FILTER: Always include the user's dietary restrictions in dietary_tags. This is a hard filter — only restaurants with matching tags are returned.

3. HARD RULE — NEVER pad results: If search_restaurants returns zero results, the answer is zero. Do NOT call search_restaurants again without the food query to get more restaurants. Do NOT suggest vaguely related restaurants. An empty result is correct and honest.

4. SHOWING RESULTS: Write one sentence intro (e.g. "Found 2 gluten-free waffle spots:"), list restaurant names only — the UI renders full detail cards. Then add one line: which restrictions were filtered, and note that suitability for unverified restrictions should be confirmed with staff.

5. ZERO RESULTS: Say exactly: "I couldn't find any [food] spots matching your dietary requirements in the database. You can run an AI scan to search the web for options." then append [SUGGEST_SEARCH] on a new line.

6. OFF-TOPIC (maths, news, medical, other apps): Answer briefly, then append [SUGGEST_SEARCH] on a new line.

7. Do NOT append [SUGGEST_SEARCH] when you returned restaurant results.

Use plain conversational text — no markdown, no bullet points, no bold.`;
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  const userRows = await query<{ account_tier: string }>(`SELECT account_tier FROM users WHERE id = $1`, [userId]);
  if (!userRows[0]) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const isPro = userRows[0].account_tier === 'pro';

  const { message, history = [], userDietaryTags = [] } = await req.json() as {
    message: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
    userDietaryTags?: string[];
  };

  // Convert history to Gemini format
  const geminiHistory = history.slice(-10).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const SYSTEM = buildSystem(isPro, userDietaryTags);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: SYSTEM,
    tools: [{ functionDeclarations: FUNCTION_DECLARATIONS } as object],
  });

  const chat = model.startChat({ history: geminiHistory });

  const foundRestaurants: RestaurantRow[] = [];

  // Agentic loop
  let result = await chat.sendMessage(message);

  for (let i = 0; i < 5; i++) {
    const parts = result.response.candidates?.[0]?.content?.parts ?? [];
    const fnCalls = parts.filter((p: { functionCall?: { name: string; args: unknown } }) => p.functionCall);
    if (!fnCalls.length) break;

    const fnResponses = [];
    for (const part of fnCalls as { functionCall: { name: string; args: Record<string, unknown> } }[]) {
      const { name, args } = part.functionCall;
      let output: unknown;
      try {
        if (name === 'search_restaurants') {
          const rows = await searchRestaurants(userId, isPro, args as Parameters<typeof searchRestaurants>[2]);
          output = rows;
          for (const r of rows) {
            if (!foundRestaurants.find(x => x.id === r.id)) foundRestaurants.push(r);
          }
        } else if (name === 'get_restaurant_details') {
          output = await getRestaurantDetails(userId, args as Parameters<typeof getRestaurantDetails>[1]);
        } else {
          output = { error: 'Unknown function' };
        }
      } catch (e) {
        output = { error: e instanceof Error ? e.message : 'Function error' };
      }
      fnResponses.push({ functionResponse: { name, response: { result: output } } });
    }

    result = await chat.sendMessage(fnResponses as never);
  }

  const text = result.response.candidates?.[0]?.content?.parts
    ?.filter((p: { text?: string }) => p.text)
    ?.map((p: { text?: string }) => p.text ?? '')
    ?.join('') ?? '';

  return NextResponse.json({ reply: text, restaurants: foundRestaurants });
}
