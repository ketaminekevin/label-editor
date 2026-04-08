import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

function privatiseName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await query<Record<string, unknown>>(
      `SELECT r.id, r.user_id, r.restaurant_id, r.rating,
              r.dietary_context, r.dietary_safety, r.body, r.photos,
              r.created_at, r.updated_at,
              u.name AS user_name, u.avatar_url AS user_avatar,
              COALESCE(v.upvotes, 0) AS upvotes,
              COALESCE(v.downvotes, 0) AS downvotes,
              mv.vote AS my_vote
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN (
         SELECT review_id,
           COUNT(*) FILTER (WHERE vote = 1)  AS upvotes,
           COUNT(*) FILTER (WHERE vote = -1) AS downvotes
         FROM review_votes GROUP BY review_id
       ) v ON v.review_id = r.id
       LEFT JOIN review_votes mv ON mv.review_id = r.id AND mv.user_id = $2
       WHERE r.restaurant_id = $1
       ORDER BY r.created_at DESC`,
      [id, userId]
    );
  } catch {
    // Fallback if review_votes table not yet created
    rows = await query<Record<string, unknown>>(
      `SELECT r.id, r.user_id, r.restaurant_id, r.rating,
              r.dietary_context, r.dietary_safety, r.body, r.photos,
              r.created_at, r.updated_at,
              u.name AS user_name, u.avatar_url AS user_avatar
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.restaurant_id = $1
       ORDER BY r.created_at DESC`,
      [id]
    );
  }

  const privatised = rows.map(r => ({
    ...r,
    dietary_safety: r.dietary_safety ?? [],
    photos: r.photos ?? [],
    user_name: r.user_name ? privatiseName(r.user_name as string) : 'Anonymous',
    upvotes:   Number(r.upvotes ?? 0),
    downvotes: Number(r.downvotes ?? 0),
    my_vote:   r.my_vote ?? null,
  }));

  return NextResponse.json(privatised);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const { rating, body, dietary_context, dietary_safety, photos } = await req.json();

  if (!rating || !body?.trim()) {
    return NextResponse.json({ error: 'Rating and review body are required' }, { status: 400 });
  }

  const rows = await query<{ id: string; created: boolean }>(
    `INSERT INTO reviews
       (user_id, restaurant_id, rating, body, dietary_context, dietary_safety, photos)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, restaurant_id) DO UPDATE
       SET rating = EXCLUDED.rating,
           body = EXCLUDED.body,
           dietary_context = EXCLUDED.dietary_context,
           dietary_safety = EXCLUDED.dietary_safety,
           photos = EXCLUDED.photos,
           updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [
      session.user.id, id, rating, body.trim(),
      dietary_context ?? [],
      JSON.stringify(dietary_safety ?? []),
      photos ?? [],
    ]
  );

  // If this restaurant was AI-discovered and just got its first community review, promote it
  if (rows[0].created) {
    await query(
      `UPDATE restaurants
       SET source = 'user_added', visibility = 'public', discovered_by = NULL
       WHERE id = $1 AND source = 'area_scan'`,
      [id]
    ).catch(() => {}); // non-fatal
  }

  return NextResponse.json({ id: rows[0].id }, { status: rows[0].created ? 201 : 200 });
}
