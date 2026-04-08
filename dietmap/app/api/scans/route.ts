import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';
import { buildScanPrompt, parseScanResponse } from '@/lib/scanner';
import { DietaryTag, Scan } from '@/lib/types';

export const maxDuration = 120;

const client = new Anthropic();

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
      `SELECT s.*, COUNT(sr.id)::int AS restaurant_count
       FROM scans s
       LEFT JOIN scan_restaurants sr ON sr.scan_id = s.id
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
    };

    const { destination, tripName, dietaryTags, lat, lng, travelDatesStart, travelDatesEnd } = body;
    if (!destination || !dietaryTags?.length) {
      return NextResponse.json({ error: 'destination and dietaryTags are required' }, { status: 400 });
    }

    // Create scan row
    const scanRows = await query<{ id: string }>(
      `INSERT INTO scans (user_id, destination, dietary_tags, travel_dates_start, travel_dates_end, status, result_summary)
       VALUES ($1, $2, $3::text[], $4, $5, 'processing', '')
       RETURNING id`,
      [userId, destination, dietaryTags, travelDatesStart ?? null, travelDatesEnd ?? null]
    );
    scanId = scanRows[0].id;

    if (!isPro) {
      await query(`UPDATE users SET scans_remaining = scans_remaining - 1 WHERE id = $1`, [userId]);
    }

    await log(scanId, `Scan started. Destination: ${destination}${lat != null ? ` (${lat.toFixed(4)}, ${lng?.toFixed(4)})` : ''}`);
    await log(scanId, `Dietary tags: ${dietaryTags.join(', ')}`);

    const prompt = buildScanPrompt(
      destination,
      dietaryTags as DietaryTag[],
      travelDatesStart,
      travelDatesEnd,
      lat,
      lng,
    );

    await log(scanId, 'Calling Anthropic API with web search...');

    // Retry up to 3 times on 529 overloaded
    let response: Anthropic.Message | null = null;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await log(scanId, `API attempt ${attempt}/3...`);
        response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          system: 'You are a dietary travel research assistant. Always respond with raw JSON only — no markdown, no code fences, no explanation text before or after the JSON object.',
          tools: [{ type: 'web_search_20250305' as const, name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }],
        });
        await log(scanId, `API attempt ${attempt} succeeded.`);
        lastErr = null;
        break;
      } catch (err: unknown) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const isOverloaded = lastErr.message.includes('overloaded') || lastErr.message.includes('529');
        await log(scanId, `API attempt ${attempt} failed: ${lastErr.message}`);
        if (!isOverloaded || attempt === 3) break;
        const wait = attempt * 15000;
        await log(scanId, `Overloaded — waiting ${wait / 1000}s before retry...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }

    if (!response) throw lastErr ?? new Error('All API attempts failed');

    await log(scanId, `Tokens used: input=${response.usage?.input_tokens} output=${response.usage?.output_tokens}`);
    await log(scanId, `Response blocks: ${response.content.map(b => b.type).join(', ')}`);

    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    await log(scanId, `Text content length: ${textContent.length} chars`);

    if (!textContent.trim()) {
      throw new Error('No text response from AI — only tool calls returned, no final JSON');
    }

    await log(scanId, 'Parsing JSON response...');
    const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    // Append raw response after log lines
    await query(
      `UPDATE scans SET result_summary = result_summary || $1 WHERE id = $2`,
      [`\n\n--- RAW RESPONSE ---\n${textContent.slice(0, 8000)}`, scanId]
    );

    const scanResult = parseScanResponse(textContent);
    await log(scanId, `Parsed OK. Restaurants: ${scanResult.restaurants?.length ?? 0}, safe dishes: ${(scanResult.safe_dishes as unknown[])?.length ?? 0}, danger foods: ${(scanResult.danger_foods as unknown[])?.length ?? 0}`);

    // Deduplicate within the AI's own response (same name + within 300m)
    const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dedupedList: NonNullable<typeof scanResult.restaurants> = [];
    for (const r of scanResult.restaurants ?? []) {
      if (!r.name || r.lat == null || r.lng == null) continue;
      const isDup = dedupedList.some(e => {
        const dlat = (e.lat - r.lat) * 111000;
        const dlng = (e.lng - r.lng) * 111000 * Math.cos(r.lat * Math.PI / 180);
        return Math.sqrt(dlat * dlat + dlng * dlng) < 300 && normName(e.name) === normName(r.name);
      });
      if (!isDup) dedupedList.push(r);
    }
    await log(scanId, `After dedup: ${dedupedList.length} unique restaurants (was ${scanResult.restaurants?.length ?? 0})`);

    // Upsert restaurants
    await log(scanId, 'Saving restaurants...');
    for (const r of dedupedList) {
      let restaurantId: string | null = null;

      const existing = await query<{ id: string }>(
        `SELECT id FROM restaurants
         WHERE visibility = 'public'
           AND ST_DWithin(location, ST_MakePoint($2, $3)::geography, 300)
           AND (
             LOWER(name) = LOWER($1)
             OR LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g')) = LOWER(REGEXP_REPLACE($1, '[^a-zA-Z0-9]', '', 'g'))
           )
         LIMIT 1`,
        [r.name, r.lng, r.lat]
      );

      if (existing.length) {
        restaurantId = existing[0].id;
      } else {
        const cuisineArr = Array.isArray(r.cuisine_type)
          ? r.cuisine_type
          : r.cuisine_type ? [r.cuisine_type] : [];

        const created = await query<{ id: string }>(
          `INSERT INTO restaurants
             (name, address, location, cuisine_type, visibility, discovered_by, added_by, source)
           VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5::text[], 'private', $6, $6, 'area_scan')
           RETURNING id`,
          [r.name, r.address ?? '', r.lng, r.lat, cuisineArr, userId]
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
           (scan_id, restaurant_id, ai_notes, ai_safety_confidence, recommended_dishes, warnings, source_urls)
         VALUES ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[])
         ON CONFLICT (scan_id, restaurant_id) DO NOTHING`,
        [
          scanId, restaurantId,
          r.notes ?? null,
          r.safety_confidence ?? null,
          r.recommended_dishes ?? [],
          r.warnings ?? [],
          r.source_urls ?? [],
        ]
      );
    }

    await log(scanId, 'Completing scan...');

    // Merge top-rated community restaurants from the database
    if (lat != null && lng != null) {
      try {
        const communityRows = await query<{ id: string }>(
          `SELECT r.id
           FROM restaurants r
           WHERE r.visibility = 'public'
             AND ST_DWithin(r.location, ST_MakePoint($1, $2)::geography, 10000)
             AND EXISTS (
               SELECT 1 FROM restaurant_dietary_tags rdt
               WHERE rdt.restaurant_id = r.id AND rdt.tag = ANY($3::text[])
             )
           ORDER BY (
             SELECT AVG(rv.rating) FROM reviews rv WHERE rv.restaurant_id = r.id
           ) DESC NULLS LAST,
           (
             SELECT COUNT(*) FROM reviews rv WHERE rv.restaurant_id = r.id
           ) DESC NULLS LAST
           LIMIT 15`,
          [lng, lat, dietaryTags]
        );
        let added = 0;
        for (const row of communityRows) {
          const res = await query(
            `INSERT INTO scan_restaurants (scan_id, restaurant_id)
             VALUES ($1, $2)
             ON CONFLICT (scan_id, restaurant_id) DO NOTHING`,
            [scanId, row.id]
          );
          if ((res as unknown as { rowCount: number }).rowCount > 0) added++;
        }
        await log(scanId, `Merged ${added} community restaurants (${communityRows.length} found nearby).`);
      } catch (communityErr) {
        await log(scanId, `Warning: community merge failed: ${communityErr instanceof Error ? communityErr.message : communityErr}`);
      }
    }

    // Create a list for this trip and bulk-add all restaurants to it
    const listName = (tripName || destination).slice(0, 100);
    try {
      const listRows = await query<{ id: string }>(
        `INSERT INTO lists (user_id, name, color) VALUES ($1, $2, '#2563EB') RETURNING id`,
        [userId, listName]
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
        scanResult.cuisine_notes ?? null,
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
