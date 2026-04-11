import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);

  const rows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM menu_scans WHERE user_id = $1 AND created_at >= $2`,
    [session.user.id, d.toISOString()]
  );

  return NextResponse.json({ used: rows[0]?.count ?? 0, limit: 3 });
}
