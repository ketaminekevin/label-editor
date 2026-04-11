import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

// GET — list unresolved reports (flagged AI action)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await query(
    `SELECT rp.*, r.name AS restaurant_name, r.address, r.status AS restaurant_status,
            u.name AS reporter_name
     FROM reports rp
     JOIN restaurants r ON r.id = rp.restaurant_id
     LEFT JOIN users u ON u.id = rp.user_id
     WHERE rp.resolved_at IS NULL
     ORDER BY rp.created_at DESC
     LIMIT 100`
  );
  return NextResponse.json(rows);
}

// PATCH — resolve a report: dismiss | remove | restore
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { reportId, action } = await req.json() as { reportId: string; action: string };
  if (!reportId || !action) return NextResponse.json({ error: 'reportId and action required' }, { status: 400 });

  const report = await query<{ restaurant_id: string }>(
    `SELECT restaurant_id FROM reports WHERE id = $1`, [reportId]
  );
  if (!report.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { restaurant_id } = report[0];

  // Resolve the report
  await query(
    `UPDATE reports SET resolved_at = NOW(), resolved_by = $1 WHERE id = $2`,
    [session.user.id, reportId]
  );

  // Apply action to the restaurant
  if (action === 'remove') {
    await query(`UPDATE restaurants SET status = 'removed' WHERE id = $1`, [restaurant_id]);
  } else if (action === 'restore') {
    await query(`UPDATE restaurants SET status = 'active' WHERE id = $1`, [restaurant_id]);
  }
  // dismiss = no status change

  await query(
    `INSERT INTO activity_log (admin_id, action, target_type, target_id, detail)
     VALUES ($1, $2, 'report', $3, $4)`,
    [session.user.id, `report_${action}`, reportId, `Admin ${action}d report for restaurant ${restaurant_id}`]
  );

  return NextResponse.json({ ok: true });
}
