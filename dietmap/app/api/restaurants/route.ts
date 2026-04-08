import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { Restaurant } from '@/lib/types';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;

  const { searchParams } = new URL(req.url);
  const dietary = searchParams.get('dietary')?.split(',').filter(Boolean) ?? [];
  const safety = searchParams.get('safety')?.split(',').filter(Boolean) ?? [];
  const allergyOnly = searchParams.get('allergy_safe') === '1';

  // Support both bbox (swLat/swLng/neLat/neLng) and legacy center+radius
  const swLat = parseFloat(searchParams.get('swLat') ?? '');
  const swLng = parseFloat(searchParams.get('swLng') ?? '');
  const neLat = parseFloat(searchParams.get('neLat') ?? '');
  const neLng = parseFloat(searchParams.get('neLng') ?? '');
  const useBbox = [swLat, swLng, neLat, neLng].every(n => !isNaN(n));

  const lat  = parseFloat(searchParams.get('lat')  ?? '0');
  const lng  = parseFloat(searchParams.get('lng')  ?? '0');
  const radius = parseFloat(searchParams.get('radius') ?? '10');

  const selectClause = `
    SELECT
      r.id, r.name, r.address,
      ST_Y(r.location::geometry) AS lat,
      ST_X(r.location::geometry) AS lng,
      r.phone, r.website, r.price_level,
      r.cuisine_type, r.cover_photo_url,
      r.source, r.verified, r.created_at, r.updated_at,
      COUNT(DISTINCT rv.id) AS review_count,
      ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating,
      json_agg(DISTINCT jsonb_build_object(
        'tag', dt.tag,
        'safety_level', dt.safety_level,
        'confidence', dt.confidence,
        'notes', dt.notes
      )) FILTER (WHERE dt.id IS NOT NULL) AS dietary_tags
    FROM restaurants r
    LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    LEFT JOIN restaurant_dietary_tags dt ON dt.restaurant_id = r.id
  `;

  let sql: string;
  let params: unknown[];
  let paramIdx: number;

  if (useBbox) {
    sql = selectClause + `WHERE r.location::geometry && ST_MakeEnvelope($1, $2, $3, $4, 4326)`;
    params = [swLng, swLat, neLng, neLat];
    paramIdx = 5;
  } else {
    sql = selectClause + `WHERE ST_DWithin(r.location, ST_MakePoint($1, $2)::geography, $3)`;
    params = [lng, lat, radius * 1000];
    paramIdx = 4;
  }

  // Visibility: show public + user's own private restaurants
  if (userId) {
    sql += ` AND (r.visibility = 'public' OR (r.visibility = 'private' AND r.discovered_by = $${paramIdx}::uuid))`;
    params.push(userId);
    paramIdx++;
  } else {
    sql += ` AND r.visibility = 'public'`;
  }

  if (dietary.length > 0) {
    sql += ` AND EXISTS (
      SELECT 1 FROM restaurant_dietary_tags dt2
      WHERE dt2.restaurant_id = r.id AND dt2.tag = ANY($${paramIdx}::text[])
    )`;
    params.push(dietary);
    paramIdx++;
  }

  if (allergyOnly || safety.length > 0) {
    const safeLevels = allergyOnly ? ['dedicated', 'careful'] : safety;
    sql += ` AND EXISTS (
      SELECT 1 FROM restaurant_dietary_tags dt3
      WHERE dt3.restaurant_id = r.id
        AND dt3.safety_level = ANY($${paramIdx}::text[])
        ${dietary.length > 0 ? `AND dt3.tag = ANY($${paramIdx - 1}::text[])` : ''}
    )`;
    params.push(safeLevels);
    paramIdx++;
  }

  sql += ` GROUP BY r.id ORDER BY r.verified DESC, avg_rating DESC NULLS LAST LIMIT 200`;

  const rows = await query<Restaurant>(sql, params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { name, address, lat, lng, phone, website, price_level, cuisine_type, dietary_tags } = body;

  if (!name || !address || lat == null || lng == null) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const rows = await query<{ id: string }>(
      `INSERT INTO restaurants (name, address, location, phone, website, price_level, cuisine_type, added_by)
       VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5, $6, $7, $8::text[], $9)
       RETURNING id`,
      [name, address, lng, lat, phone ?? null, website ?? null, price_level ?? null,
       cuisine_type ?? [], session.user.id]
    );
    const restaurantId = rows[0].id;

    if (dietary_tags && Array.isArray(dietary_tags)) {
      for (const dt of dietary_tags) {
        await query(
          `INSERT INTO restaurant_dietary_tags (restaurant_id, tag, safety_level, confidence, notes)
           VALUES ($1, $2, $3, 'user_verified', $4)
           ON CONFLICT (restaurant_id, tag) DO UPDATE
             SET safety_level = EXCLUDED.safety_level, notes = EXCLUDED.notes, updated_at = NOW()`,
          [restaurantId, dt.tag, dt.safety_level || 'has_options', dt.notes || null]
        );
      }
    }

    return NextResponse.json({ id: restaurantId }, { status: 201 });
  } catch (err) {
    console.error('POST /api/restaurants error:', err);
    const message = err instanceof Error ? err.message : 'Database error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
