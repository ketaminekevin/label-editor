import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

// GET /api/admin/fix-addresses
// Reverse-geocodes all restaurants that have area-style addresses (not real street addresses).
// Call this once from the browser while logged in to backfill existing data.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return NextResponse.json({ error: 'No Mapbox token configured' }, { status: 500 });

  // Target restaurants whose address looks like an AI area description rather than a street address:
  // - empty address
  // - contains "area", "district", "region", "neighbourhood", "neighborhood"
  // - or is any area_scan restaurant (AI-added, likely got area descriptions)
  const restaurants = await query<{ id: string; name: string; address: string; lat: number; lng: number }>(
    `SELECT id, name, address,
       ST_Y(location::geometry) AS lat,
       ST_X(location::geometry) AS lng
     FROM restaurants
     WHERE address = ''
       OR address IS NULL
       OR source = 'area_scan'
       OR address ~* '\\y(area|district|region|neighbourhood|neighborhood)\\y'
     ORDER BY created_at DESC
     LIMIT 500`
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of restaurants) {
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${r.lng},${r.lat}.json?access_token=${token}&types=address,neighborhood,place&limit=1`
      );
      const data = await res.json() as { features?: Array<{ place_name?: string }> };
      const place = data.features?.[0];
      if (place?.place_name) {
        await query(`UPDATE restaurants SET address = $1, updated_at = NOW() WHERE id = $2`, [place.place_name, r.id]);
        updated++;
      } else {
        skipped++;
      }
    } catch {
      failed++;
    }
    // Avoid Mapbox rate limits (600 req/min free tier)
    await new Promise(resolve => setTimeout(resolve, 120));
  }

  return NextResponse.json({
    message: 'Done',
    total: restaurants.length,
    updated,
    skipped,
    failed,
  });
}
