import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const lists = await query<{ id: string; name: string; color: string }>(
    `SELECT id, name, color FROM lists WHERE id = $1 AND user_id = $2`,
    [id, session.user.id]
  );
  if (!lists.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const restaurants = await query<Record<string, unknown>>(
    `SELECT r.id, r.name, r.address, r.cuisine_type, r.cover_photo_url,
            r.source, r.verified, r.price_level,
            ST_Y(r.location::geometry) AS lat,
            ST_X(r.location::geometry) AS lng,
            COUNT(DISTINCT rv.id) AS review_count,
            ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'id', dt.id, 'tag', dt.tag, 'safety_level', dt.safety_level,
              'confidence', dt.confidence, 'notes', dt.notes
            )) FILTER (WHERE dt.id IS NOT NULL), '[]') AS dietary_tags
     FROM restaurants r
     JOIN restaurant_lists rl ON rl.restaurant_id = r.id
     LEFT JOIN reviews rv ON rv.restaurant_id = r.id
     LEFT JOIN restaurant_dietary_tags dt ON dt.restaurant_id = r.id
     WHERE rl.list_id = $1
     GROUP BY r.id, rl.added_at
     ORDER BY rl.added_at DESC`,
    [id]
  );

  return NextResponse.json({ list: lists[0], restaurants });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const { name, color } = await req.json();

  const rows = await query<{ id: string }>(
    `UPDATE lists SET name = COALESCE($1, name), color = COALESCE($2, color), updated_at = now()
     WHERE id = $3 AND user_id = $4 RETURNING id`,
    [name ?? null, color ?? null, id, session.user.id]
  );
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ id: rows[0].id });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  await query(`DELETE FROM lists WHERE id = $1 AND user_id = $2`, [id, session.user.id]);
  return NextResponse.json({ ok: true });
}
