import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';
import { Scan } from '@/lib/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await query<Scan>(`SELECT * FROM scans WHERE id = $1`, [id]);
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rows[0].user_id !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
     GROUP BY sr.id, r.id
     ORDER BY sr.created_at`,
    [id]
  );

  return NextResponse.json({ ...rows[0], restaurants });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await query<Scan>(`SELECT * FROM scans WHERE id = $1`, [id]);
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (rows[0].user_id !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Delete private restaurants with no reviews that belong to this scan
  await query(
    `DELETE FROM restaurants
     WHERE id IN (
       SELECT sr.restaurant_id FROM scan_restaurants sr
       WHERE sr.scan_id = $1
     )
     AND visibility = 'private'
     AND discovered_by = $2
     AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.restaurant_id = restaurants.id)`,
    [id, session.user.id]
  );

  await query(`DELETE FROM scans WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
