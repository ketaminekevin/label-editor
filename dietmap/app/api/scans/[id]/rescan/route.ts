import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildScanPrompt, parseScanResponse } from '@/lib/scanner';
import { geocodeRestaurant, getPlacePhotos } from '@/lib/geocode';
import { DietaryTag } from '@/lib/types';

export const maxDuration = 120;

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY ?? '');

async function log(scanId: string, msg: string) {
  const ts = new Date().toISOString();
  console.log(`[rescan ${scanId}] ${ts} ${msg}`);
  try {
    await query(
      `UPDATE scans SET result_summary = COALESCE(result_summary, '') || $1 WHERE id = $2`,
      [`\n[${ts}] [rescan] ${msg}`, scanId]
    );
  } catch { /* non-fatal */ }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scan = await query<{
    id: string; user_id: string; destination: string; dietary_tags: DietaryTag[];
    travel_dates_start: string | null; travel_dates_end: string | null;
  }>(`SELECT id, user_id, destination, dietary_tags, travel_dates_start, travel_dates_end FROM scans WHERE id = $1`, [id]);

  if (!scan.length || scan[0].user_id !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Mark as processing so the frontend can poll and see live log
  await query(`UPDATE scans SET status = 'processing' WHERE id = $1`, [id]);
  await log(id, 'Find More started');

  try {
    const { destination, dietary_tags, travel_dates_start, travel_dates_end } = scan[0];
    const body = await req.json() as { lat?: number; lng?: number; searchLevels?: { high: boolean; medium: boolean; low: boolean }; maxDistanceKm?: number };

    // Get location from original scan if not provided
    let lat = body.lat;
    let lng = body.lng;
    if (lat == null || lng == null) {
      const rows = await query<{ lat: number; lng: number }>(
        `SELECT ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng
         FROM scan_restaurants sr JOIN restaurants r ON r.id = sr.restaurant_id
         WHERE sr.scan_id = $1 LIMIT 1`, [id]
      );
      if (rows.length) { lat = rows[0].lat; lng = rows[0].lng; }
    }
    await log(id, `Destination: ${destination}${lat != null ? ` (${lat.toFixed(4)}, ${lng?.toFixed(4)})` : ''}`);

    const prompt = buildScanPrompt(destination, dietary_tags, travel_dates_start ?? undefined, travel_dates_end ?? undefined, lat, lng, body.searchLevels, body.maxDistanceKm, true);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'You are a dietary travel research assistant. Always respond with raw JSON only — no markdown, no code fences, no explanation text before or after the JSON object.',
      tools: [{ googleSearch: {} } as object],
    });

    await log(id, 'Calling Gemini API...');
    let textContent = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await log(id, `API attempt ${attempt}/3...`);
        const result = await model.generateContent(prompt);
        const candidate = result.response.candidates?.[0];
        textContent = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
        if (textContent.trim()) {
          await log(id, `API attempt ${attempt} succeeded. Response length: ${textContent.length}`);
          break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await log(id, `API attempt ${attempt} failed: ${msg}`);
        if (attempt === 3) {
          await query(`UPDATE scans SET status = 'completed' WHERE id = $1`, [id]);
          return NextResponse.json({ error: 'AI service error — please try again.' }, { status: 503 });
        }
        await new Promise(r => setTimeout(r, attempt * 5000));
      }
    }
    if (!textContent.trim()) {
      await query(`UPDATE scans SET status = 'completed' WHERE id = $1`, [id]);
      return NextResponse.json({ error: 'AI service unavailable' }, { status: 503 });
    }

    await log(id, 'Parsing response...');
    const scanResult = parseScanResponse(textContent);
    await log(id, `Parsed OK. Restaurants in response: ${scanResult.restaurants?.length ?? 0}`);

    const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
    const safeConfidence = (v: unknown) => (typeof v === 'string' && VALID_CONFIDENCE.has(v)) ? v : null;
    const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const VALID_TAGS = new Set(['gluten_free','dairy_free','vegan','vegetarian','keto','nut_free','soy_free','egg_free','shellfish_free','halal','kosher','low_fodmap']);
    const maxAllowedM = (body.maxDistanceKm ?? 10) * 1000 * 2; // 2× the search radius

    let added = 0;
    for (let r of scanResult.restaurants ?? []) {
      if (!r.name || r.lat == null || r.lng == null) continue;
      // Geocode address for accurate coordinates, then distance-check
      if (lat != null && lng != null) {
        const gc = await geocodeRestaurant(r.name, r.address ?? '', lat, lng);
        if (gc) {
          const photos = await getPlacePhotos(gc.placeId, 5);
          r = { ...r, lat: gc.lat, lng: gc.lng, menu_photo_urls: photos.length ? photos : (r.menu_photo_urls ?? []) };
          await log(id, `Geocoded "${r.name}": (${gc.lat.toFixed(5)}, ${gc.lng.toFixed(5)})`);
        }
        const dlat = (r.lat - lat) * 111000;
        const dlng = (r.lng - lng) * 111000 * Math.cos(r.lat * Math.PI / 180);
        if (Math.sqrt(dlat * dlat + dlng * dlng) > maxAllowedM) {
          await log(id, `Skipping "${r.name}" — too far from centre after geocoding`);
          continue;
        }
      }
      let restaurantId: string | null = null;

      const existing = await query<{ id: string }>(
        `SELECT id FROM restaurants
         WHERE (visibility = 'public' OR discovered_by = $4)
           AND (
             (website IS NOT NULL AND website = $5
              AND ST_DWithin(location, ST_MakePoint($2, $3)::geography, 1000))
             OR
             (ST_DWithin(location, ST_MakePoint($2, $3)::geography, 300)
               AND (
                 LOWER(REGEXP_REPLACE(name,'[^a-zA-Z0-9]','','g')) = LOWER(REGEXP_REPLACE($1,'[^a-zA-Z0-9]','','g'))
                 OR LOWER(REGEXP_REPLACE($1,'[^a-zA-Z0-9 ]','','g')) LIKE LOWER(REGEXP_REPLACE(name,'[^a-zA-Z0-9 ]','','g')) || '%'
                 OR LOWER(REGEXP_REPLACE(name,'[^a-zA-Z0-9 ]','','g')) LIKE LOWER(REGEXP_REPLACE($1,'[^a-zA-Z0-9 ]','','g')) || '%'
               )
             )
             OR (ST_DWithin(location, ST_MakePoint($2, $3)::geography, 8)
                 AND LOWER(REGEXP_REPLACE(name,'[^a-zA-Z0-9]','','g')) = LOWER(REGEXP_REPLACE($1,'[^a-zA-Z0-9]','','g')))
           )
         LIMIT 1`, [r.name, r.lng, r.lat, session.user.id, r.website ?? null]
      );

      if (existing.length) {
        restaurantId = existing[0].id;
      } else {
        const cuisineArr = Array.isArray(r.cuisine_type) ? r.cuisine_type : r.cuisine_type ? [r.cuisine_type] : [];
        const created = await query<{ id: string }>(
          `INSERT INTO restaurants (name, address, location, cuisine_type, website, phone, visibility, discovered_by, added_by, source)
           VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5::text[], $6, $7, 'private', $8, $8, 'area_scan') RETURNING id`,
          [r.name, r.address ?? '', r.lng, r.lat, cuisineArr, r.website ?? null, r.phone ?? null, session.user.id]
        );
        restaurantId = created[0].id;
        for (const tag of (r.dietary_tags ?? []).filter(t => VALID_TAGS.has(t))) {
          await query(
            `INSERT INTO restaurant_dietary_tags (restaurant_id, tag, safety_level, confidence) VALUES ($1, $2, 'has_options', 'llm_derived') ON CONFLICT DO NOTHING`,
            [restaurantId, tag]
          );
        }
      }

      // Link to this scan (skip if already linked)
      const res = await query(
        `INSERT INTO scan_restaurants (scan_id, restaurant_id, ai_notes, ai_safety_confidence, recommended_dishes, warnings, source_urls, menu_photo_urls)
         VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8::text[]) ON CONFLICT (scan_id, restaurant_id) DO NOTHING`,
        [id, restaurantId, r.notes ?? null, safeConfidence(r.safety_confidence), r.recommended_dishes ?? [], r.warnings ?? [], r.source_urls ?? [], r.menu_photo_urls ?? []]
      );
      if ((res as unknown as { rowCount: number }).rowCount > 0 && normName(r.name)) added++;
    }

    await log(id, `Done. Added ${added} new restaurant(s) to this trip.`);

    // Restore completed status and bump the associated list's updated_at
    await query(`UPDATE scans SET status = 'completed' WHERE id = $1`, [id]);
    await query(`UPDATE lists SET updated_at = NOW() WHERE scan_id = $1`, [id]);

    // Return updated restaurant list
    const restaurants = await query(
      `SELECT sr.*, r.name, r.address,
         ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
         r.cuisine_type, r.price_level, r.website, r.phone, r.visibility, r.source,
         ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating, COUNT(rv.id)::int AS review_count
       FROM scan_restaurants sr JOIN restaurants r ON r.id = sr.restaurant_id
       LEFT JOIN reviews rv ON rv.restaurant_id = r.id
       WHERE sr.scan_id = $1 GROUP BY sr.id, r.id`, [id]
    );

    return NextResponse.json({ added, restaurants });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rescan failed';
    await log(id, `FATAL ERROR: ${message}`);
    await query(`UPDATE scans SET status = 'completed' WHERE id = $1`, [id]);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
