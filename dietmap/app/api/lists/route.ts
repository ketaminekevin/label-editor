import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json([], { status: 401 });

  const rows = await query<{
    id: string; name: string; color: string; scan_id: string | null; created_at: string;
    restaurant_count: number; restaurant_ids: string[];
  }>(
    `SELECT l.id, l.name, l.color, l.created_at,
            -- Resolve scan_id: use stored value or fall back to name-matching for legacy lists
            COALESCE(
              l.scan_id,
              (SELECT s.id FROM scans s
               WHERE s.user_id = l.user_id
                 AND (LOWER(s.trip_name) = LOWER(l.name) OR LOWER(s.destination) = LOWER(l.name))
               ORDER BY s.created_at DESC LIMIT 1)
            ) AS scan_id,
            CASE
              WHEN COALESCE(
                l.scan_id,
                (SELECT s.id FROM scans s
                 WHERE s.user_id = l.user_id
                   AND (LOWER(s.trip_name) = LOWER(l.name) OR LOWER(s.destination) = LOWER(l.name))
                 ORDER BY s.created_at DESC LIMIT 1)
              ) IS NOT NULL
              THEN (
                SELECT COUNT(DISTINCT LOWER(REGEXP_REPLACE(r.name, '[^a-zA-Z0-9]', '', 'g')))::int
                FROM scan_restaurants sr
                JOIN restaurants r ON r.id = sr.restaurant_id
                WHERE sr.scan_id = COALESCE(
                  l.scan_id,
                  (SELECT s.id FROM scans s
                   WHERE s.user_id = l.user_id
                     AND (LOWER(s.trip_name) = LOWER(l.name) OR LOWER(s.destination) = LOWER(l.name))
                   ORDER BY s.created_at DESC LIMIT 1)
                )
              )
              ELSE COUNT(rl.restaurant_id)::int
            END AS restaurant_count,
            COALESCE(array_agg(rl.restaurant_id) FILTER (WHERE rl.restaurant_id IS NOT NULL), '{}') AS restaurant_ids
     FROM lists l
     LEFT JOIN restaurant_lists rl ON rl.list_id = l.id
     WHERE l.user_id = $1
     GROUP BY l.id
     ORDER BY COALESCE(l.updated_at, l.created_at) DESC`,
    [session.user.id]
  );
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name, color } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const rows = await query<{ id: string; name: string; color: string; created_at: string }>(
    `INSERT INTO lists (user_id, name, color) VALUES ($1, $2, $3)
     RETURNING id, name, color, created_at`,
    [session.user.id, name.trim(), color ?? '#3b82f6']
  );
  return NextResponse.json(rows[0], { status: 201 });
}
