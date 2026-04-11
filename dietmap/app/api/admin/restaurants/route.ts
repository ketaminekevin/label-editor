import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query } from '@/lib/db';

async function logActivity(adminId: string, action: string, targetId: string, detail: string) {
  await query(
    `INSERT INTO activity_log (admin_id, action, target_type, target_id, detail)
     VALUES ($1, $2, 'restaurant', $3, $4)`,
    [adminId, action, targetId, detail]
  ).catch(() => {});
}

// GET — list restaurants for admin (supports ?status= filter and ?q= search)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? '';
  const q = searchParams.get('q') ?? '';

  let sql = `
    SELECT r.id, r.name, r.address, r.status, r.verified, r.report_count,
           r.source, r.created_at, r.ai_verdict,
           r.cuisine_type, r.visibility,
           u.name AS added_by_name, u.email AS added_by_email,
           COUNT(DISTINCT rv.id)::int AS review_count,
           ROUND(AVG(rv.rating)::numeric, 1) AS avg_rating
    FROM restaurants r
    LEFT JOIN users u ON u.id = r.added_by
    LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    WHERE 1=1`;
  const params: unknown[] = [];
  let i = 1;

  if (status) { sql += ` AND r.status = $${i++}`; params.push(status); }
  if (q) { sql += ` AND (LOWER(r.name) LIKE $${i} OR LOWER(r.address) LIKE $${i})`; params.push(`%${q.toLowerCase()}%`); i++; }

  sql += ` GROUP BY r.id, u.name, u.email ORDER BY r.created_at DESC LIMIT 200`;

  const rows = await query(sql, params);
  return NextResponse.json(rows);
}

// PATCH — approve, reject, restore, remove, verify
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, action } = await req.json() as { id: string; action: string };
  if (!id || !action) return NextResponse.json({ error: 'id and action required' }, { status: 400 });

  if (action === 'delete') {
    const r = await query<{ name: string }>(`SELECT name FROM restaurants WHERE id = $1`, [id]);
    await query(`DELETE FROM restaurants WHERE id = $1`, [id]);
    await logActivity(session.user.id, 'admin_delete', id, `Permanently deleted "${r[0]?.name ?? id}"`);
    return NextResponse.json({ ok: true, deleted: true });
  }

  const STATUS_MAP: Record<string, string> = {
    approve:  'active',
    restore:  'active',
    reject:   'removed',
    remove:   'removed',
    archive:  'removed',
    flag:     'flagged',
    pending:  'pending',
  };

  if (!STATUS_MAP[action]) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  await query(`UPDATE restaurants SET status = $1 WHERE id = $2`, [STATUS_MAP[action], id]);
  await logActivity(session.user.id, `admin_${action}`, id, `Admin set status to ${STATUS_MAP[action]}`);

  return NextResponse.json({ ok: true, status: STATUS_MAP[action] });
}
