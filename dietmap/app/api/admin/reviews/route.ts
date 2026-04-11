import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin' && session.user.role !== 'moderator') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { reviewId, action, reportId } = await req.json() as {
    reviewId: string;
    action: 'remove' | 'restore' | 'dismiss';
    reportId?: string;
  };

  if (action === 'remove') {
    await query(`UPDATE reviews SET hidden = TRUE WHERE id = $1`, [reviewId]);
    await query(
      `INSERT INTO activity_log (admin_id, action, target_type, target_id, detail, stage)
       VALUES ($1, 'admin_review_removed', 'review', $2, 'Admin removed review', 'complete')`,
      [session.user.id, reviewId]
    ).catch(() => {});
    if (reportId) {
      await query(
        `UPDATE review_reports SET resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
        [session.user.id, reportId]
      ).catch(() => {});
    }
  } else if (action === 'restore') {
    await query(`UPDATE reviews SET hidden = FALSE WHERE id = $1`, [reviewId]);
    await query(
      `INSERT INTO activity_log (admin_id, action, target_type, target_id, detail, stage)
       VALUES ($1, 'admin_review_restored', 'review', $2, 'Admin restored review', 'complete')`,
      [session.user.id, reviewId]
    ).catch(() => {});
  } else if (action === 'dismiss') {
    if (reportId) {
      await query(
        `UPDATE review_reports SET resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
        [session.user.id, reportId]
      ).catch(() => {});
    }
  } else {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  // Return current review state
  const rev = await query<{ hidden: boolean }>(
    `SELECT hidden FROM reviews WHERE id = $1`, [reviewId]
  );

  return NextResponse.json({ ok: true, hidden: rev[0]?.hidden ?? false });
}
