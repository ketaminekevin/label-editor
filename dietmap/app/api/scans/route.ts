import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildScanPrompt, parseScanResponse } from '@/lib/scanner';
import { geocodeRestaurant, getPlacePhotos } from '@/lib/geocode';
import { DietaryTag, Scan } from '@/lib/types';

export const maxDuration = 120;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');

/** Write a progress note to result_summary so the frontend can poll it */
async function log(scanId: string, msg: string) {
  const ts = new Date().toISOString();
  console.log(`[scan ${scanId}] ${ts} ${msg}`);
  try {
    await query(
      `UPDATE scans SET result_summary = COALESCE(result_summary, '') || $1 WHERE id = $2`,
      [`\n[${ts}] ${msg}`, scanId]
    );
  } catch { /* non-fatal */ }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rows = await query<Scan>(
      `SELECT s.*,
              COUNT(DISTINCT LOWER(REGEXP_REPLACE(r.name, '[^a-zA-Z0-9]', '', 'g')))::int AS restaurant_count
       FROM scans s
       LEFT JOIN scan_restaurants sr ON sr.scan_id = s.id
       LEFT JOIN restaurants r ON r.id = sr.restaurant_id
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      [session.user.id]
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/scans error:', err);
    return NextResponse.json({ error: 'Failed to load scans' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let scanId: string | null = null;
  let isPro = false;
  let userId: string | null = null;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = session.user.id;

    const userRows = await query<{ account_tier: string; scans_remaining: number }>(
      `SELECT account_tier, scans_remaining FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    isPro = user.account_tier === 'pro';
    const hasCredits = user.scans_remaining > 0;
    if (!isPro && !hasCredits) {
      return NextResponse.json({ error: 'No scan credits remaining.' }, { status: 403 });
    }

    const body = await req.json() as {
      destination: string;
      tripName?: string;
      dietaryTags: string[];
      lat?: number;
      lng?: number;
      travelDatesStart?: string;
      travelDatesEnd?: string;
      searchLevels?: { high: boolean; medium: boolean; low: boolean };
      maxDistanceKm?: number;
    };

    const { destination, tripName, dietaryTags, lat, lng, travelDatesStart, travelDatesEnd, searchLevels, maxDistanceKm } = body;
    if (!destination || !dietaryTags?.length) {
      return NextResponse.json({ error: 'destination and dietaryTags are required' }, { status: 400 });
    }

    // Create scan row
    const scanRows = await query<{ id: string }>(
      `INSERT INTO scans (user_id, destination, trip_name, dietary_tags, travel_dates_start, travel_dates_end, status, result_summary)
       VALUES ($1, $2, $3, $4::text[], $5, $6, 'processing', '')
       RETURNING id`,
      [userId, destination, tripName ?? null, dietaryTags, travelDatesStart ?? null, travelDatesEnd ?? null]
    );
    scanId = scanRows[0].id;

    if (!isPro) {
      await query(`UPDATE users SET scans_remaining = scans_remaining - 1 WHERE id = $1`, [userId]);
    }

    await log(scanId, `Scan started. Destination: ${destination}${lat != null ? ` (${lat.toFixed(4)}, ${lng?.toFixed(4)})` : ''}`);
    await log(scanId, `Dietary tags: ${dietaryTags.join(', ')}`);

    const prompt1 = buildScanPrompt(
      destination,
      dietaryTags as DietaryTag[],
      travelDatesStart,
      travelDatesEnd,
      lat,
      lng,
      searchLevels,
      maxDistanceKm,
      false,
      1,
    );
    const prompt2 = buildScanPrompt(
      destination,
      dietaryTags as DietaryTag[],
      travelDatesStart,
      travelDatesEnd,
      lat,
      lng,
      searchLevels,
      maxDistanceKm,
      false,
      2,
    );

    await log(scanId, 'Calling Gemini API (2 parallel searches)...');

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are a dietary travel research assistant. Always respond with raw JSON only — no markdown, no code fences, no explanation text before or after the JSON object.',
      tools: [{ googleSearch: {} } as object],
    });

    async function callGemini(prompt: string, label: string): Promise<{ text: string; tokens: number }> {
      let lastErr: Error | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await log(scanId!, `[${label}] API attempt ${attempt}/3...`);
          const result = await model.generateContent(prompt);
          const candidate = result.response.candidates?.[0];
          const text = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
          const tokens = (result.response.usageMetadata?.promptTokenCount ?? 0) + (result.response.usageMetadata?.candidatesTokenCount ?? 0);
          if (text.trim()) {
            await log(scanId!, `[${label}] attempt ${attempt} succeeded. Tokens: ${tokens}`);
            return { text, tokens };
          }
        } catch (err: unknown) {
          lastErr = err instanceof Error ? err : new Error(String(err));
          await log(scanId!, `[${label}] attempt ${attempt} failed: ${lastErr.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000));
        }
      }
      throw lastErr ?? new Error(`No text response from Gemini [${label}]`);
    }

    // Run both searches in parallel
    const [res1, res2] = await Promise.allSettled([
      callGemini(prompt1, 'search1'),
      callGemini(prompt2, 'search2'),
    ]);

    let textContent = '';
    let tokensUsed = 0;

    if (res1.status === 'fulfilled') {
      textContent = res1.value.text;
      tokensUsed += res1.value.tokens;
    } else {
      await log(scanId, `Search 1 failed: ${res1.reason}`);
    }
    if (res2.status === 'fulfilled') {
      tokensUsed += res2.value.tokens;
    } else {
      await log(scanId, `Search 2 failed: ${res2.reason}`);
    }

    if (!textContent.trim()) {
      throw new Error('Both search attempts returned no content');
    }

    await log(scanId, `Combined tokens used: ${tokensUsed}`);
    await log(scanId, 'Parsing JSON responses...');

    // Append raw response for debugging
    await query(
      `UPDATE scans SET result_summary = result_summary || $1 WHERE id = $2`,
      [`\n\n--- RAW RESPONSE (search1) ---\n${textContent.slice(0, 4000)}`, scanId]
    );

    const scanResult = parseScanResponse(textContent);

    // Merge restaurants from search2 if it succeeded
    if (res2.status === 'fulfilled') {
      try {
        const scanResult2 = parseScanResponse(res2.value.text);
        const extra = scanResult2.restaurants ?? [];
        await log(scanId, `Search 2 returned ${extra.length} restaurants to merge`);
        await query(
          `UPDATE scans SET result_summary = result_summary || $1 WHERE id = $2`,
          [`\n\n--- RAW RESPONSE (search2) ---\n${res2.value.text.slice(0, 4000)}`, scanId]
        );
        scanResult.restaurants = [...(scanResult.restaurants ?? []), ...extra];
      } catch (parseErr) {
        await log(scanId, `Search 2 parse failed: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
      }
    }
    await log(scanId, `Parsed OK. Restaurants: ${scanResult.restaurants?.length ?? 0}, safe dishes: ${(scanResult.safe_dishes as unknown[])?.length ?? 0}, danger foods: ${(scanResult.danger_foods as unknown[])?.length ?? 0}`);

    // Filter out restaurants whose coordinates are implausibly far from the scan centre
    const distFromCentre = (rLat: number, rLng: number) => {
      if (lat == null || lng == null) return 0;
      const dlat = (rLat - lat) * 111000;
      const dlng = (rLng - lng) * 111000 * Math.cos(rLat * Math.PI / 180);
      return Math.sqrt(dlat * dlat + dlng * dlng);
    };
    const maxAllowedM = (maxDistanceKm ?? 10) * 1000 * 2; // 2× the search radius

    // Deduplicate within the AI's own response (same name + within 300m)
    const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
    const safeConfidence = (v: unknown) => (typeof v === 'string' && VALID_CONFIDENCE.has(v)) ? v : null;
    const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dedupedList: NonNullable<typeof scanResult.restaurants> = [];
    for (const r of scanResult.restaurants ?? []) {
      if (!r.name || r.lat == null || r.lng == null) continue;
      // Skip if the AI hallucinated coordinates far outside the search area
      if (lat != null && distFromCentre(r.lat, r.lng) > maxAllowedM) {
        await log(scanId, `Skipping "${r.name}" — coordinates too far from centre (${(distFromCentre(r.lat, r.lng) / 1000).toFixed(1)} km)`);
        continue;
      }
      const normWebsite = (u?: string | null) => u ? u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase() : null;
      const dist2d = (aLat: number, aLng: number, bLat: number, bLng: number) => {
        const dlat = (aLat - bLat) * 111000;
        const dlng = (aLng - bLng) * 111000 * Math.cos(bLat * Math.PI / 180);
        return Math.sqrt(dlat * dlat + dlng * dlng);
      };
      const isDup = dedupedList.some(e => {
        const d = dist2d(e.lat, e.lng, r.lat, r.lng);
        // Same website AND within 500m = same branch (not a chain location elsewhere)
        const ew = normWebsite(e.website); const rw = normWebsite(r.website);
        if (ew && rw && ew === rw && d < 500) return true;
        if (d >= 300) return false;
        // Exact normalized match OR one name contains the other (handles "Branch" / "Ponsonby" suffix variants)
        const n1 = normName(e.name); const n2 = normName(r.name);
        return n1 === n2 || n1.startsWith(n2) || n2.startsWith(n1);
      });
      if (!isDup) dedupedList.push(r);
    }
    await log(scanId, `After dedup: ${dedupedList.length} unique restaurants (was ${scanResult.restaurants?.length ?? 0})`);

    // Geocode each restaurant's address for accurate coordinates
    await log(scanId, 'Geocoding restaurant addresses...');
    const geocodedRaw = (lat != null && lng != null && scanId != null
      ? await Promise.all(dedupedList.map(async r => {
          const gc = await geocodeRestaurant(r.name, r.address ?? '', lat, lng);
          if (gc) {
            await log(scanId!, `Geocoded "${r.name}": (${gc.lat.toFixed(5)}, ${gc.lng.toFixed(5)})`);
            const photos = await getPlacePhotos(gc.placeId, 5);
            return { ...r, lat: gc.lat, lng: gc.lng, menu_photo_urls: photos.length ? photos : (r.menu_photo_urls ?? []) };
          }
          return r;
        }))
      : dedupedList
    ).filter(r => distFromCentre(r.lat, r.lng) <= maxAllowedM);

    // Dedup by coordinates after geocoding — same Google Places result = same business
    const normWebsite2 = (u?: string | null) => u ? u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').toLowerCase() : null;
    const geocodedList: typeof geocodedRaw = [];
    for (const r of geocodedRaw) {
      const isSameLocation = geocodedList.some(e => {
        const dlat = (e.lat - r.lat) * 111000;
        const dlng = (e.lng - r.lng) * 111000 * Math.cos(r.lat * Math.PI / 180);
        const d = Math.sqrt(dlat * dlat + dlng * dlng);
        // Same website AND within 500m = same branch (geocoded coords are accurate here)
        const ew = normWebsite2(e.website); const rw = normWebsite2(r.website);
        if (ew && rw && ew === rw && d < 500) return true;
        return d < 25; // within 25m = same business by location alone
      });
      if (isSameLocation) {
        await log(scanId, `Skipping "${r.name}" — same location as an existing entry`);
        continue;
      }
      geocodedList.push(r);
    }
    await log(scanId, `After coordinate dedup: ${geocodedList.length} restaurants`);

    // Upsert restaurants
    await log(scanId, 'Saving restaurants...');
    for (const r of geocodedList) {
      let restaurantId: string | null = null;

      // Match by name similarity OR very close proximity (catches name variants like "Prego" vs "Prego Restaurant")
      const existing = await query<{ id: string }>(
        `SELECT id FROM restaurants
         WHERE (visibility = 'public' OR discovered_by = $4)
           AND (
             -- Same website within 1km = same business (handles name variant duplicates)
             (website IS NOT NULL AND website = $5
              AND ST_DWithin(location, ST_MakePoint($2, $3)::geography, 1000))
             OR
             (ST_DWithin(location, ST_MakePoint($2, $3)::geography, 300)
               AND (
                 LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = LOWER(REGEXP_REPLACE($1, '[^a-zA-Z0-9]', '', 'g'))
                 OR LOWER(REGEXP_REPLACE($1, '[^a-zA-Z0-9 ]', '', 'g')) LIKE LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9 ]', '', 'g')) || '%'
                 OR LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9 ]', '', 'g')) LIKE LOWER(REGEXP_REPLACE($1, '[^a-zA-Z0-9 ]', '', 'g')) || '%'
               )
             )
             OR (ST_DWithin(location, ST_MakePoint($2, $3)::geography, 8)
                 AND LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = LOWER(REGEXP_REPLACE($1, '[^a-zA-Z0-9]', '', 'g')))
           )
         LIMIT 1`,
        [r.name, r.lng, r.lat, userId, r.website ?? null]
      );

      if (existing.length) {
        restaurantId = existing[0].id;
      } else {
        const cuisineArr = Array.isArray(r.cuisine_type)
          ? r.cuisine_type
          : r.cuisine_type ? [r.cuisine_type] : [];

        const created = await query<{ id: string }>(
          `INSERT INTO restaurants
             (name, address, location, cuisine_type, website, phone, visibility, discovered_by, added_by, source)
           VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5::text[], $6, $7, 'private', $8, $8, 'area_scan')
           RETURNING id`,
          [r.name, r.address ?? '', r.lng, r.lat, cuisineArr, r.website ?? null, r.phone ?? null, userId]
        );
        restaurantId = created[0].id;

        const VALID_TAGS = new Set([
          'gluten_free','dairy_free','vegan','vegetarian','keto',
          'nut_free','soy_free','egg_free','shellfish_free','halal','kosher','low_fodmap',
        ]);
        for (const tag of (r.dietary_tags ?? []).filter(t => VALID_TAGS.has(t))) {
          await query(
            `INSERT INTO restaurant_dietary_tags (restaurant_id, tag, safety_level, confidence)
             VALUES ($1, $2, 'has_options', 'llm_derived')
             ON CONFLICT (restaurant_id, tag) DO NOTHING`,
            [restaurantId, tag]
          );
        }
      }

      await query(
        `INSERT INTO scan_restaurants
           (scan_id, restaurant_id, ai_notes, ai_safety_confidence, recommended_dishes, warnings, source_urls, menu_photo_urls)
         VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8::text[])
         ON CONFLICT (scan_id, restaurant_id) DO NOTHING`,
        [
          scanId, restaurantId,
          r.notes ?? null,
          safeConfidence(r.safety_confidence),
          r.recommended_dishes ?? [],
          r.warnings ?? [],
          r.source_urls ?? [],
          r.menu_photo_urls ?? [],
        ]
      );
    }

    await log(scanId, 'Completing scan...');

    // Create a list for this trip and bulk-add all restaurants to it
    const listName = (tripName || destination).slice(0, 100);
    try {
      const listRows = await query<{ id: string }>(
        `INSERT INTO lists (user_id, name, color, scan_id) VALUES ($1, $2, '#2563EB', $3) RETURNING id`,
        [userId, listName, scanId]
      );
      if (listRows.length) {
        await query(
          `INSERT INTO restaurant_lists (list_id, restaurant_id)
           SELECT $1, sr.restaurant_id FROM scan_restaurants sr WHERE sr.scan_id = $2
           ON CONFLICT DO NOTHING`,
          [listRows[0].id, scanId]
        );
        await log(scanId, `Created list "${listName}" with restaurants.`);
      }
    } catch (listErr) {
      await log(scanId, `Warning: could not create list: ${listErr instanceof Error ? listErr.message : listErr}`);
    }

    await query(
      `UPDATE scans SET
         status = 'completed',
         phrase_cards = $1,
         safe_dishes = $2,
         danger_foods = $3,
         cuisine_notes = $4,
         coverage_confidence = $5,
         coverage_note = $6,
         tokens_used = $7,
         completed_at = NOW()
       WHERE id = $8`,
      [
        JSON.stringify(scanResult.phrase_cards ?? []),
        JSON.stringify(scanResult.safe_dishes ?? []),
        JSON.stringify(scanResult.danger_foods ?? []),
        Array.isArray(scanResult.cuisine_notes)
          ? (scanResult.cuisine_notes as string[]).join('\n')
          : (scanResult.cuisine_notes ?? null),
        scanResult.coverage_confidence ?? null,
        scanResult.coverage_note ?? null,
        tokensUsed,
        scanId,
      ]
    );

    await log(scanId, 'Done.');

    const finalScan = await query<Scan>(`SELECT * FROM scans WHERE id = $1`, [scanId]);
    const restaurants = await query(
      `SELECT sr.*, r.name, r.address,
         ST_Y(r.location::geometry) AS lat,
         ST_X(r.location::geometry) AS lng,
         r.cuisine_type, r.price_level, r.website, r.phone, r.visibility, r.source,
         ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating,
         COUNT(rv.id)::int AS review_count
       FROM scan_restaurants sr
       JOIN restaurants r ON r.id = sr.restaurant_id
       LEFT JOIN reviews rv ON rv.restaurant_id = r.id
       WHERE sr.scan_id = $1
       GROUP BY sr.id, r.id`,
      [scanId]
    );

    return NextResponse.json({ ...finalScan[0], restaurants });

  } catch (err) {
    let message = err instanceof Error ? err.message : 'Scan failed';
    if (message.includes('overloaded') || message.includes('529')) {
      message = 'AI service is temporarily busy — please try again in a minute.';
    }
    console.error('POST /api/scans fatal error:', message, err);

    if (scanId) {
      try {
        await log(scanId, `FATAL ERROR: ${message}`);
        await query(`UPDATE scans SET status = 'failed', error_message = $1 WHERE id = $2`, [message, scanId]);
        if (!isPro && userId) {
          await query(`UPDATE users SET scans_remaining = scans_remaining + 1 WHERE id = $1`, [userId]);
        }
      } catch (rollbackErr) {
        console.error('Rollback error:', rollbackErr);
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
