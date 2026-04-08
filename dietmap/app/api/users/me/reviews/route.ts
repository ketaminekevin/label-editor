import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json([], { status: 401 });

  const rows = await query<Record<string, unknown>>(
    `SELECT r.id, r.restaurant_id, r.rating,
            r.dietary_context, r.body, r.created_at, r.updated_at,
            res.name AS restaurant_name, res.cuisine_type AS restaurant_cuisine
     FROM reviews r
     JOIN restaurants res ON res.id = r.restaurant_id
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC`,
    [session.user.id]
  );
  return NextResponse.json(rows);
}
