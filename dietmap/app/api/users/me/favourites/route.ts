import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { Restaurant } from '@/lib/types';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await query<Restaurant>(
    `SELECT r.id, r.name, r.address,
       ST_Y(r.location::geometry) AS lat,
       ST_X(r.location::geometry) AS lng,
       r.cuisine_type, r.cover_photo_url, r.verified,
       COALESCE(json_agg(DISTINCT jsonb_build_object(
         'tag', dt.tag, 'safety_level', dt.safety_level
       )) FILTER (WHERE dt.id IS NOT NULL), '[]') AS dietary_tags
     FROM favourites f
     JOIN restaurants r ON r.id = f.restaurant_id
     LEFT JOIN restaurant_dietary_tags dt ON dt.restaurant_id = r.id
     WHERE f.user_id = $1
     GROUP BY r.id
     ORDER BY f.created_at DESC`,
    [session.user.id]
  );
  return NextResponse.json(rows);
}
