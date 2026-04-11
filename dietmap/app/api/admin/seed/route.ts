import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

interface OSMElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const OSM_DIET_MAP: Record<string, string> = {
  'diet:vegan':       'vegan',
  'diet:vegetarian':  'vegetarian',
  'diet:gluten_free': 'gluten_free',
  'diet:halal':       'halal',
  'diet:kosher':      'kosher',
  'diet:dairy_free':  'dairy_free',
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { city } = await req.json() as { city: string };
  if (!city?.trim()) return NextResponse.json({ error: 'city required' }, { status: 400 });

  const log: string[] = [];

  // 1. Geocode via Nominatim
  log.push(`[..] Geocoding: "${city}"`);
  let geoData: { boundingbox: string[]; display_name: string }[] = [];
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'DietMap/1.0 (dietary mapping app)' } }
    );
    geoData = await geoRes.json();
  } catch (e) {
    log.push(`[!!] Nominatim request failed: ${e}`);
    return NextResponse.json({ log }, { status: 502 });
  }

  if (!geoData.length) {
    log.push(`[!!] No location found for "${city}"`);
    return NextResponse.json({ log, error: 'City not found' }, { status: 404 });
  }

  const place = geoData[0];
  const [swLat, neLat, swLng, neLng] = place.boundingbox.map(Number);
  log.push(`[OK] Location: ${place.display_name}`);
  log.push(`[OK] Bounds: SW(${swLat.toFixed(4)}, ${swLng.toFixed(4)}) → NE(${neLat.toFixed(4)}, ${neLng.toFixed(4)})`);

  // 2. Query Overpass
  log.push(`[..] Querying OpenStreetMap Overpass API…`);
  const overpassQuery = `[out:json][timeout:30];(node["amenity"~"restaurant|cafe|fast_food"]["name"](${swLat},${swLng},${neLat},${neLng});way["amenity"~"restaurant|cafe|fast_food"]["name"](${swLat},${swLng},${neLat},${neLng}););out center 1000;`;

  let elements: OSMElement[] = [];
  try {
    const ovRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: { 'Content-Type': 'text/plain', 'User-Agent': 'DietMap/1.0' },
    });
    if (!ovRes.ok) throw new Error(`HTTP ${ovRes.status}`);
    const ovData = await ovRes.json() as { elements: OSMElement[] };
    elements = ovData.elements ?? [];
  } catch (e) {
    log.push(`[!!] Overpass request failed: ${e}`);
    return NextResponse.json({ log }, { status: 502 });
  }

  log.push(`[OK] Overpass returned ${elements.length} venues`);
  if (elements.length === 0) {
    log.push(`[--] Nothing to insert.`);
    return NextResponse.json({ log, city: place.display_name, total: 0, inserted: 0, skipped: 0 });
  }

  // 3. Insert into DB
  let inserted = 0;
  let skipped = 0;
  const insertErrors: string[] = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (!lat || !lng || !name) continue;

    const osmId = `osm:${el.type}:${el.id}`;

    // Check if already seeded
    const existing = await query<{ id: string }>(
      'SELECT id FROM restaurants WHERE google_place_id = $1',
      [osmId]
    ).catch(() => [{ id: 'error' }]);
    if (existing.length) { skipped++; continue; }

    // Build address
    const addrParts = [
      el.tags?.['addr:housenumber'],
      el.tags?.['addr:street'],
      el.tags?.['addr:suburb'],
      el.tags?.['addr:city'] ?? el.tags?.['addr:town'],
    ].filter(Boolean);
    const address = addrParts.length > 0 ? addrParts.join(', ') : place.display_name.split(',').slice(-3).join(',').trim();

    const cuisine = el.tags?.cuisine
      ? el.tags.cuisine.split(';').map(s => s.trim()).filter(Boolean)
      : [];

    // Insert
    let restaurantId: string | null = null;
    try {
      const rows = await query<{ id: string }>(
        `INSERT INTO restaurants
           (name, address, location, cuisine_type, source, status, verified, google_place_id, website, phone)
         VALUES
           ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, 'seed', 'active', false, $6, $7, $8)
         RETURNING id`,
        [
          name, address, lng, lat, cuisine, osmId,
          el.tags?.website ?? null,
          el.tags?.phone ?? el.tags?.['contact:phone'] ?? null,
        ]
      );
      restaurantId = rows[0]?.id ?? null;
    } catch (e) {
      insertErrors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      skipped++;
      continue;
    }

    if (!restaurantId) { skipped++; continue; }
    inserted++;

    // Dietary tags from OSM
    for (const [osmTag, dietTag] of Object.entries(OSM_DIET_MAP)) {
      const val = el.tags?.[osmTag];
      if (val === 'yes' || val === 'only') {
        await query(
          `INSERT INTO restaurant_dietary_tags (restaurant_id, tag, safety_level, confidence, source)
           VALUES ($1, $2, 'has_options', 'llm_derived', 'osm')
           ON CONFLICT (restaurant_id, tag) DO NOTHING`,
          [restaurantId, dietTag]
        ).catch(() => {});
      }
    }
  }

  log.push(`[OK] Inserted ${inserted} new restaurants`);
  if (skipped > 0)        log.push(`[--] Skipped ${skipped} (already in database)`);
  if (insertErrors.length) {
    log.push(`[!!] ${insertErrors.length} insert error(s):`);
    insertErrors.slice(0, 10).forEach(e => log.push(`     ${e}`));
    if (insertErrors.length > 10) log.push(`     … and ${insertErrors.length - 10} more`);
  }
  if (inserted > 0 && !(await query<{ enabled: boolean }>(`SELECT enabled FROM feature_flags WHERE key = 'seed_data'`).then(r => r[0]?.enabled).catch(() => false))) {
    log.push(`[!!] Seed Data flag is OFF — restaurants are in the database but hidden from the map.`);
    log.push(`     Enable "Seed Data" in Feature Flags above to show them.`);
  } else if (inserted > 0) {
    log.push(`[OK] Done. Refresh the map to see the new pins.`);
  }

  return NextResponse.json({ log, city: place.display_name, total: elements.length, inserted, skipped });
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM restaurants
       WHERE source = 'seed'
         AND id NOT IN (SELECT DISTINCT restaurant_id FROM reviews)
       RETURNING id
     ) SELECT COUNT(*) AS count FROM deleted`
  );
  return NextResponse.json({ deleted: parseInt(result[0]?.count ?? '0') });
}
