import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { Restaurant } from '@/lib/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;

  const rows = await query<Restaurant & { visibility: string; discovered_by: string | null }>(
    `SELECT
       r.id, r.name, r.address,
       ST_Y(r.location::geometry) AS lat,
       ST_X(r.location::geometry) AS lng,
       r.google_place_id, r.phone, r.website, r.price_level,
       r.cuisine_type, r.cover_photo_url, r.source, r.added_by,
       r.verified, r.visibility, r.discovered_by, r.created_at, r.updated_at,
       COUNT(DISTINCT rv.id) AS review_count,
       ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating,
       COALESCE(json_agg(DISTINCT jsonb_build_object(
         'id', dt.id,
         'tag', dt.tag,
         'safety_level', dt.safety_level,
         'confidence', dt.confidence,
         'notes', dt.notes,
         'source', dt.source
       )) FILTER (WHERE dt.id IS NOT NULL), '[]') AS dietary_tags
     FROM restaurants r
     LEFT JOIN reviews rv ON rv.restaurant_id = r.id
     LEFT JOIN restaurant_dietary_tags dt ON dt.restaurant_id = r.id
     WHERE r.id = $1
     GROUP BY r.id`,
    [id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = rows[0];
  if (row.visibility === 'private' && row.discovered_by !== userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Attach scan notes if this is an AI-found restaurant and the user owns it
  let scan_notes = null;
  if (row.source === 'area_scan' && userId) {
    const scanRows = await query<{
      ai_notes: string | null;
      ai_safety_confidence: string | null;
      recommended_dishes: string[];
      warnings: string[];
      destination: string;
    }>(
      `SELECT sr.ai_notes, sr.ai_safety_confidence, sr.recommended_dishes, sr.warnings, s.destination
       FROM scan_restaurants sr
       JOIN scans s ON s.id = sr.scan_id
       WHERE sr.restaurant_id = $1 AND s.user_id = $2
       ORDER BY sr.created_at DESC
       LIMIT 1`,
      [id, userId]
    );
    if (scanRows.length) {
      const sr = scanRows[0];
      scan_notes = {
        ai_notes: sr.ai_notes,
        ai_safety_confidence: sr.ai_safety_confidence as 'high' | 'medium' | 'low' | null,
        recommended_dishes: sr.recommended_dishes ?? [],
        warnings: sr.warnings ?? [],
        scan_destination: sr.destination,
      };
    }
  }

  return NextResponse.json({ ...row, scan_notes });
}
