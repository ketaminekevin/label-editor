import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin' && session.user.role !== 'moderator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [pendingRows, flaggedRows, activityRows] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM restaurants WHERE status = 'pending'`),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM reports WHERE resolved_at IS NULL`),
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM activity_log`),
  ]);

  return NextResponse.json({
    pending: parseInt(pendingRows[0]?.count ?? '0'),
    flagged: parseInt(flaggedRows[0]?.count ?? '0'),
    activity: parseInt(activityRows[0]?.count ?? '0'),
  });
}
